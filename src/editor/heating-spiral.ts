import type { Point } from './model/types.js'
import { createHeatingPipe, heatingDefaults, heatingManifoldSize } from './heating-plan.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres, drawingLengthMetres, type DrawingScale } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { heatingRoomKey, heatingWallDistances, measureHeatingCoverage } from './heating-coverage.js'
import type { HeatingGrid } from './heating-routing.js'
import { balancedHeatingCuts } from './heating-field-balance.js'

/** Two tangent S-bends widen a tight return into a semicircle of the required
 * radius. All six corners have the same radius; straight runs retain their pitch. */
export const openHeatingTurns = (points: Point[], radius: number, pipeDiameter = radius / 5): Point[] => {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1], d = points[i + 2]
    if (a && c && d) {
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, wx = d.x - c.x, wy = d.y - c.y
      const before = Math.hypot(ux, uy), gap = Math.hypot(vx, vy), after = Math.hypot(wx, wy), delta = radius - gap / 2
      if (gap > 0 && delta > 1e-6 && gap - 2 * delta > pipeDiameter + 1e-6 &&
        Math.abs(ux * vx + uy * vy) < 1e-6 && Math.abs(wx * vx + wy * vy) < 1e-6 && ux * wx + uy * wy < 0) {
        const theta = Math.acos(1 - delta / (2 * radius)), run = 2 * radius * Math.sin(theta), cut = radius * Math.tan(theta / 2)
        if (before > radius + run && after > radius + run) {
          const u = { x: ux / before, y: uy / before }, v = { x: vx / gap, y: vy / gap }
          for (const [base, along, across] of [
            [b, radius + run - cut, 0], [b, radius + cut, -delta], [b, 0, -delta],
            [c, 0, delta], [c, radius + cut, delta], [c, radius + run - cut, 0]
          ] as [Point, number, number][]) result.push({ x: base.x - u.x * along + v.x * across, y: base.y - u.y * along + v.y * across })
          i++; continue
        }
      }
    }
    result.push(points[i])
  }
  return result
}

export type HeatingSpiralField = { doorAligned?: boolean; packingGroup?: string; points?: Point[]; fieldBox?: { left: number; right: number; top: number; bottom: number }; rectangular?: boolean; cells: number[]; sourceMask?: number; pattern?: 'spiral' | 'meander' | 'mixed'; roomName: string; roomKey?: string; roomMembers?: { key: string; name: string }[]; areaM2: number; spacingMinMm: number; spacingMaxMm: number }
type Settings = { leadAllowances?: Readonly<Record<string, number>>; returnToEntrySide?: boolean; leadDistances?: Int32Array; leadStubMm?: number; entryGroups?: ReadonlyMap<string, number>; connectionBounds?: { x: number; y: number; width: number; height: number }; balanceLoads?: boolean; nativeRoom?: Int32Array; nativeRoomAreas?: ReadonlyMap<number, number>; preferMeanderRoomKeys?: readonly string[]; connectionMode?: 'ports' | 'zone'; deferCoverage?: boolean; reserveAccess?: boolean; loopBudgetByRoom?: Readonly<Record<string, number>>; diameterMm: number; spacingMm: number; edgeMm?: number; capacity?: number; manifoldSide?: 'auto' | 'top' | 'bottom'; design?: HeatingDesignInputs }
type CellRect = { left: number; top: number; right: number; bottom: number }

/** Both arms wind inward in the same direction, one pitch apart. Reverse the
 * second arm at the centre to obtain one continuous counterflow double spiral. */
const buildRectangularHeatingSpiral = (width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void = () => {}, entryAxis?: 'x' | 'y'): Point[] | null => {
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
  const transpose = entryAxis ? entryAxis === 'y' : height > width
  const w = transpose ? height : width, h = transpose ? width : height
  let left = 0, top = 0, right = w, bottom = h
  const a: Point[] = [{ x: 0, y: 0 }], b: Point[] = [{ x: 0, y: pitch }]
  let best: Point[] | null = null
  for (let sideIndex = 0; sideIndex < 2000; sideIndex++) {
    checkpoint()
    if (right - left < pitch || bottom - top < pitch) break
    const side = sideIndex % 4
    const endA = side === 0 ? { x: right, y: top } : side === 1 ? { x: right, y: bottom } : side === 2 ? { x: left, y: bottom } : { x: left, y: top }
    const endB = side === 0 ? { x: right - pitch, y: top + pitch } : side === 1 ? { x: right - pitch, y: bottom - pitch }
      : side === 2 ? { x: left + pitch, y: bottom - pitch } : { x: left + pitch, y: top + pitch }
    const across = side % 2 ? right - left : bottom - top
    if (across <= 3 * pitch + 1e-6) {
      const centreB = side % 2 ? { x: endB.x, y: endA.y } : { x: endA.x, y: endB.y }
      const raw = [...a, endA, centreB, ...[...b].reverse()].filter((p, i, all) => !i || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-7)
      const pipe = createHeatingPipe('spiral-check', openHeatingTurns(raw, radius, diameter), {
        ...heatingDefaults('pipe'), ...settings, drawingScale: scale, automatic: true, circuitId: 'spiral', pipeRole: 'loop'
      })
      const geometry = heatingPipeGeometry(pipe)
      if (geometry.bends.every((bend) => bend.radiusMm + .1 >= heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm) &&
        geometry.pieces.every((piece) => [piece.a, piece.b].every((p) => p.x >= -1e-6 && p.y >= -1e-6 && p.x <= w + 1e-6 && p.y <= h + 1e-6)) &&
        !checkHeatingPlan([pipe], [], settings.design, [], { checkpoint, stopOnConflict: true }).errors) best = raw
    }
    a.push(endA); b.push(endB)
    if (side === 0 && sideIndex > 0) left += 2 * pitch
    if (side === 1) top += 2 * pitch
    if (side === 2) right -= 2 * pitch
    if (side === 3) bottom -= 2 * pitch
  }
  if (!best && !entryAxis) return rectangularHeatingSpiral(width, height, settings, scale, checkpoint, 'x') ?? rectangularHeatingSpiral(width, height, settings, scale, checkpoint, 'y')
  return best?.map(({ x, y }) => transpose ? { x: y, y: x } : { x, y }) ?? null
}

/** A local alternative for narrow or awkward fields. The widened return bends
 * stay inside the same available rectangle; no smaller bend radius is assumed. */
const buildRectangularHeatingMeander = (width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void = () => {}, entryAxis?: 'x' | 'y'): Point[] | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
  const transpose = entryAxis ? entryAxis === 'y' : height > width
  const w = transpose ? height : width, h = transpose ? width : height
  if (w < diameter || h < 0) return null
  const overshoot = Math.max(0, radius - pitch / 2)
  let rows = h >= pitch + 2 * overshoot ? Math.floor((h - 2 * overshoot) / pitch + 1e-7) + 1 : 1
  if (settings.returnToEntrySide && rows > 1 && rows % 2) rows--
  if (rows > 1000) return null
  const y = (h - (rows - 1) * pitch) / 2, raw: Point[] = []
  for (let row = 0; row < rows; row++) {
    checkpoint()
    raw.push({ x: row % 2 ? w : 0, y: y + row * pitch }, { x: row % 2 ? 0 : w, y: y + row * pitch })
  }
  const opened = openHeatingTurns(raw, radius, diameter)
  const pipe = createHeatingPipe('meander-check', opened, { ...heatingDefaults('pipe'), ...settings, drawingScale: scale, automatic: true, circuitId: 'meander', pipeRole: 'loop' })
  const geometry = heatingPipeGeometry(pipe)
  if (geometry.bends.some((bend) => bend.radiusMm + .1 < limits.minBendRadiusMm) ||
    geometry.pieces.some((piece) => [piece.a, piece.b].some((p) => p.x < -1e-6 || p.y < -1e-6 || p.x > w + 1e-6 || p.y > h + 1e-6)) ||
    checkHeatingPlan([pipe], [], settings.design, [], { checkpoint, stopOnConflict: true }).errors) return null
  return raw.map(({ x, y }) => transpose ? { x: y, y: x } : { x, y })
}

const patternCache = new Map<string, Point[] | null>()
const cachedRectangle = (kind: 'spiral' | 'meander', width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void, axis?: 'x' | 'y'): Point[] | null => {
  checkpoint()
  const radius = heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm
  const key = `${kind}:${width}:${height}:${settings.spacingMm}:${settings.diameterMm}:${radius}:${scale}:${axis ?? 'auto'}:${settings.returnToEntrySide ? 1 : 0}`
  let points = patternCache.get(key)
  if (!patternCache.has(key)) {
    points = (kind === 'spiral' ? buildRectangularHeatingSpiral : buildRectangularHeatingMeander)(width, height, settings, scale, checkpoint, axis)
    patternCache.set(key, points)
    if (patternCache.size > 512) patternCache.delete(patternCache.keys().next().value!)
  }
  return points?.map((point) => ({ ...point })) ?? null
}
export const rectangularHeatingSpiral = (width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void = () => {}, axis?: 'x' | 'y') => cachedRectangle('spiral', width, height, settings, scale, checkpoint, axis)
export const rectangularHeatingMeander = (width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void = () => {}, axis?: 'x' | 'y') => cachedRectangle('meander', width, height, settings, scale, checkpoint, axis)

export const rectangularHeatingField = (width: number, height: number, settings: Settings, scale: number,
  checkpoint: () => void = () => {}, entryAxis?: 'x' | 'y', preferMeander = false) => {
  for (const pattern of preferMeander ? ['meander', 'spiral'] as const : ['spiral', 'meander'] as const) {
    const points = (pattern === 'spiral' ? rectangularHeatingSpiral : rectangularHeatingMeander)(width, height, settings, scale, checkpoint, entryAxis)
    if (points) return { points, pattern }
  }
  return null
}

/** Largest rectangle of free cells, found in one histogram pass. Repeating after
 * removal decomposes orthogonal rooms around cabinets without crossing them. */
const largestRectangle = (free: Uint8Array, grid: HeatingGrid, bounds: CellRect, checkpoint: () => void): CellRect | null => {
  const width = bounds.right - bounds.left + 1, heights = new Int32Array(width)
  let best: CellRect | null = null, area = 0
  for (let y = bounds.top; y <= bounds.bottom; y++) {
    checkpoint()
    const stack: number[] = []
    for (let x = 0; x <= width; x++) {
      if (x < width) heights[x] = free[y * grid.width + bounds.left + x] ? heights[x] + 1 : 0
      const h = x < width ? heights[x] : 0
      while (stack.length && heights[stack.at(-1)!] > h) {
        const column = stack.pop()!, left = stack.length ? stack.at(-1)! + 1 : 0, candidate = heights[column] * (x - left)
        if (candidate > area) {
          area = candidate; best = { left: bounds.left + left, right: bounds.left + x - 1, top: y - heights[column] + 1, bottom: y }
        }
      }
      stack.push(x)
    }
  }
  return best
}

export const buildHeatingSpiralFields = (grid: HeatingGrid, settings: Settings, scale: DrawingScale, manifold: Point,
  budgetFactor = 1, variant = 0, checkpoint: () => void = () => {}) => {
  const jobs: HeatingSpiralField[] = [], occupied = new Set<number>(), size = grid.width * grid.height
  const free = new Uint8Array(size), distance = heatingWallDistances(grid)
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const lengths = new Map<string, { path: Point[]; axis: 'x' | 'y'; pattern: 'spiral' | 'meander'; loopM: number }[]>()
  const optionsFor = (w: number, h: number) => {
    const key = `${w}:${h}`, cached = lengths.get(key)
    if (cached) return cached
    const result: { path: Point[]; axis: 'x' | 'y'; pattern: 'spiral' | 'meander'; loopM: number }[] = []
    for (const axis of ['x', 'y'] as const) for (const pattern of ['spiral', 'meander'] as const) {
      let originalLength = -1
      for (const returnToEntrySide of pattern === 'meander' ? [false, true] : [false]) {
        const selected = { ...settings, returnToEntrySide }
        const path = (pattern === 'spiral' ? rectangularHeatingSpiral : rectangularHeatingMeander)(w, h, selected, scale, checkpoint, axis)
        if (!path || returnToEntrySide && path.length === originalLength) continue
        originalLength = path.length
        const pipe = createHeatingPipe('field-cost', openHeatingTurns(path, drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
          { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop' })
        result.push({ path, axis, pattern, loopM: drawingLengthMetres(heatingPipeGeometry(pipe).length, scale) })
      }
    }
    lengths.set(key, result); return result
  }
  const sourceHalf = drawingUnitsForMetres(.25, scale), sourceBody = heatingManifoldSize(settings.capacity ?? 12, scale, grid.step)
  const region = settings.connectionBounds
  let roomLeadAllowance = 0
  const leadCost = (p: Point) => (settings.leadDistances ? (() => {
    const cell = grid.index(p), distance = cell >= 0 ? settings.leadDistances[cell] : -1
    return distance < 0 ? Infinity : drawingLengthMetres(distance * grid.step, scale) + (settings.leadStubMm ?? 0) / 1000
  })() : drawingLengthMetres(region ? Math.max(0, region.x - p.x, p.x - region.x - region.width) + Math.max(0, region.y - p.y, p.y - region.y - region.height) : settings.connectionMode === 'zone'
    ? Math.max(0, Math.abs(p.x - manifold.x) - sourceHalf) + Math.max(0, Math.abs(p.y - manifold.y) - sourceHalf)
    : Math.abs(p.y - manifold.y - (settings.manifoldSide === 'top' ? 0 : sourceBody.height)) + Math.max(0, manifold.x - p.x, p.x - manifold.x - sourceBody.width), scale)) + roomLeadAllowance / 2
  const clearance = Math.ceil(drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale) / grid.step)
  const pitch = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
  const cellArea = drawingLengthMetres(grid.step, scale) ** 2
  for (const room of grid.rooms) {
    checkpoint()
    roomLeadAllowance = settings.leadAllowances?.[heatingRoomKey(room)] ?? 0
    const preferMeander = settings.preferMeanderRoomKeys?.includes(heatingRoomKey(room)) === true
    let usable = 0, covered = 0
    let accessSide = -1, bestDoor = Infinity
    if (settings.reserveAccess && (room.members?.length ?? 0) < 2) for (const cell of room.cells) {
      if (!grid.door[cell]) continue
      const p = grid.point(cell), score = Math.abs(p.x - manifold.x) + Math.abs(p.y - manifold.y)
      if (score >= bestDoor) continue
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      const edges = [x - room.minX, room.maxX - x, y - room.minY, room.maxY - y]
      accessSide = edges.indexOf(Math.min(...edges)); bestDoor = score
    }
    const entryGroups = settings.entryGroups?.get(heatingRoomKey(room)) ?? 1
    const laneMm = grid.step * scale / 8
    const requestedAccessCells = Math.ceil(drawingUnitsForMetres(((settings.edgeMm ?? 100) + 2 * limits.minBendRadiusMm + (settings.entryGroups ? entryGroups * 2 * Math.max(laneMm, settings.diameterMm * 1.2) : 0)) / 1000, scale) / grid.step)
    // An entrance reservation must not erase a narrow heated strip. Keep at
    // least one laying row; its supply/return can provide the adjoining runs.
    const accessSpan = accessSide < 2 ? room.maxX - room.minX : room.maxY - room.minY
    const accessCells = Math.min(requestedAccessCells, Math.max(clearance, accessSpan - clearance))
    for (const cell of room.cells) {
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      const edge = accessSide < 0 ? Infinity : [x - room.minX, room.maxX - x, y - room.minY, room.maxY - y][accessSide]
      if (!grid.obstacle[cell] && !grid.loopObstacle[cell] && distance[cell] >= clearance && edge >= accessCells) { free[cell] = 1; usable++ }
    }
    const roomJobs: HeatingSpiralField[] = []
    const rectangleJobs = new Map<number, HeatingSpiralField[]>(), reservedJoins: { field: number; part: number; remainder: number }[] = []
    const doorPoints = room.cells.filter((cell) => grid.door[cell]).map(grid.point)
    const centre = grid.point(room.cells[Math.floor(room.cells.length / 2)])
    const leads = Math.min(55, 2 * drawingLengthMetres(Math.abs(centre.x - manifold.x) + Math.abs(centre.y - manifold.y), scale))
    const maxLoopM = Math.max(8, (Math.min(settings.diameterMm < 16 ? 70 : limits.maxCircuitLengthM, limits.maxCircuitLengthM - limits.allowanceM) - leads) * budgetFactor * (settings.loopBudgetByRoom?.[heatingRoomKey(room)] ?? 1))
    const rectangles: { box: CellRect; served: number }[] = []
    for (let field = 0; field < 64; field++) {
      const rect = largestRectangle(free, grid, { left: room.minX, right: room.maxX, top: room.minY, bottom: room.maxY }, checkpoint)
      if (!rect) break
      let served = 0
      // Leave one laying interval between neighbouring fields, rather than a
      // single raster cell. Their edge runs heat this shared strip as well.
      for (let y = Math.max(room.minY, rect.top - pitch + 1); y <= Math.min(room.maxY, rect.bottom + pitch - 1); y++) {
        for (let x = Math.max(room.minX, rect.left - pitch + 1); x <= Math.min(room.maxX, rect.right + pitch - 1); x++) {
          const cell = y * grid.width + x
          if (free[cell]) { served++; free[cell] = 0 }
        }
      }
      rectangles.push({ box: rect, served })
    }
    for (let field = 0; field < rectangles.length; field++) {
      const { box: rect, served } = rectangles[field], area = served * cellArea
      const nativeAt = (box: CellRect) => settings.nativeRoom?.[Math.round((box.top + box.bottom) / 2) * grid.width + Math.round((box.left + box.right) / 2)]
      const native = nativeAt(rect)
      let localAccessSide = accessSide
      // A shared zone can contain a small room with a different doorway side.
      // Split that room toward its own door, rather than hiding one half behind
      // a long closed edge of the neighbouring half.
      if (localAccessSide < 0 && native !== undefined && (settings.nativeRoomAreas?.get(native) ?? Infinity) <= 12) {
        const cells = room.cells.filter((cell) => settings.nativeRoom![cell] === native)
        const xs = cells.map((cell) => cell % grid.width), ys = cells.map((cell) => Math.floor(cell / grid.width))
        const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
        let closest = Infinity
        for (const cell of cells) if (grid.door[cell]) {
          const p = grid.point(cell), cost = leadCost(p)
          if (cost >= closest) continue
          const x = cell % grid.width, y = Math.floor(cell / grid.width), edges = [Math.abs(x - left), Math.abs(right - x), Math.abs(y - top), Math.abs(bottom - y)]
          localAccessSide = edges.indexOf(Math.min(...edges)); closest = cost
        }
      }
      const entrySide = area > 3 ? localAccessSide : -1
      let count = Math.max(1, Math.ceil(area / (settings.spacingMm / 1000) / maxLoopM))
      // Try the real complete spiral before splitting an area estimate into
      // fields and joining them again. The estimate includes strips already
      // heated by edge runs, and its arbitrary flood-fill midpoint can greatly
      // overestimate the leads. Unnecessary splitting creates entrance barriers.
      const fullWidth = (rect.right - rect.left - (rect.right - rect.left) % pitch) * grid.step
      const fullHeight = (rect.bottom - rect.top - (rect.bottom - rect.top) % pitch) * grid.step
      const fullField = rectangularHeatingField(fullWidth, fullHeight, settings, scale, checkpoint, undefined, preferMeander)
      const full = fullField?.points
      let fullLoopM = area / (settings.spacingMm / 1000)
      if (full) {
        const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
        const pipe = createHeatingPipe('full-field', openHeatingTurns(full, radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
          { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop' })
        const loopM = drawingLengthMetres(heatingPipeGeometry(pipe).length, scale)
        fullLoopM = loopM
        const origin = grid.point(rect.top * grid.width + rect.left)
        let minLeads = Infinity
        for (const flipX of [false, true]) for (const flipY of [false, true]) {
          const world = (p: Point) => ({ x: origin.x + (flipX ? fullWidth - p.x : p.x), y: origin.y + (flipY ? fullHeight - p.y : p.y) })
          minLeads = Math.min(minLeads, leadCost(world(full[0])) + leadCost(world(full.at(-1)!)))
        }
        const available = Math.max(8, Math.min(settings.diameterMm < 16 ? 70 : limits.maxCircuitLengthM, limits.maxCircuitLengthM - limits.allowanceM - minLeads) * budgetFactor * (settings.loopBudgetByRoom?.[heatingRoomKey(room)] ?? 1))
        count = Math.max(1, Math.ceil(loopM / available))
      }
      // Split across the approach strip: every field then has its own opening
      // onto that strip instead of hiding later fields behind closed spirals.
      const horizontal = localAccessSide >= 0 ? localAccessSide >= 2 : (rect.right - rect.left >= rect.bottom - rect.top) !== Boolean(variant & 4)
      const first = horizontal ? rect.left : rect.top, last = horizontal ? rect.right : rect.bottom
      const remainders = settings.balanceLoads ? rectangles.slice(field + 1).map((part, index) => ({ ...part, rectangle: field + 1 + index })).filter((part) => {
        const other = nativeAt(part.box), gap = Math.max(0, rect.left - part.box.right, part.box.left - rect.right) + Math.max(0, rect.top - part.box.bottom, part.box.top - rect.bottom)
        return part.served * cellArea <= 3 && gap * drawingLengthMetres(grid.step, scale) <= 1.5 &&
          (native === undefined || other === native || (other !== undefined && (settings.nativeRoomAreas?.get(other) ?? Infinity) <= 2))
      }).map((part) => ({ box: part.box, rectangle: part.rectangle, lengthM: part.served * cellArea / (settings.spacingMm / 1000) })) : []
      const source = grid.index(manifold), sourceCells = { x: source % grid.width, y: Math.floor(source / grid.width) }
      const spillSide = remainders.length ? remainders.reduce((sum, part) => sum + (horizontal ? part.box.left + part.box.right : part.box.top + part.box.bottom) / 2, 0) / remainders.length >= (first + last) / 2 : false
      const neighbour = rectangles.slice(0, field).some(({ box }) => (Math.max(0, rect.left - box.right, box.left - rect.right) + Math.max(0, rect.top - box.bottom, box.top - rect.bottom)) * drawingLengthMetres(grid.step, scale) <= 1.5)
      const partition = (parts: number) => balancedHeatingCuts(rect, parts, horizontal, fullLoopM, pitch, drawingLengthMetres(grid.step, scale), sourceCells,
        drawingUnitsForMetres(.25, scale) / grid.step, remainders, (part, index) => {
          const box = { ...part }
          if (horizontal) { box.left += index ? Math.ceil(pitch / 2) : 0; box.right -= index + 1 < parts ? Math.floor(pitch / 2) : 0 }
          else { box.top += index ? Math.ceil(pitch / 2) : 0; box.bottom -= index + 1 < parts ? Math.floor(pitch / 2) : 0 }
          const extraX = (box.right - box.left) % pitch, extraY = (box.bottom - box.top) % pitch
          box.left += Math.floor(extraX / 2); box.right -= Math.ceil(extraX / 2); box.top += Math.floor(extraY / 2); box.bottom -= Math.ceil(extraY / 2)
          const w = (box.right - box.left) * grid.step, h = (box.bottom - box.top) * grid.step, origin = grid.point(box.top * grid.width + box.left)
          const totals: { pattern: string; totalM: number }[] = []
          for (const option of optionsFor(w, h)) for (const flipX of [false, true]) for (const flipY of [false, true]) {
            if (entrySide === 0 && (option.axis !== 'x' || flipX) || entrySide === 1 && (option.axis !== 'x' || !flipX) ||
              entrySide === 2 && (option.axis !== 'y' || flipY) || entrySide === 3 && (option.axis !== 'y' || !flipY)) continue
            const world = (p: Point) => ({ x: origin.x + (flipX ? w - p.x : p.x), y: origin.y + (flipY ? h - p.y : p.y) })
            totals.push({ pattern: option.pattern, totalM: option.loopM + leadCost(world(option.path[0])) + leadCost(world(option.path.at(-1)!)) + limits.allowanceM })
          }
          const feasible = totals.filter((option) => option.totalM <= limits.maxCircuitLengthM), preferred = feasible.filter((option) => option.pattern === (preferMeander ? 'meander' : 'spiral'))
          return Math.min(Infinity, ...(preferred.length ? preferred : feasible.length ? feasible : totals).map((option) => option.totalM))
        }, parts === 2 && neighbour && remainders.length ? { atEnd: spillSide, maxM: limits.maxCircuitLengthM - 1.5 } : undefined)
      let cuts = Array.from({ length: count + 1 }, (_, i) => first + (last - first) * i / count)
      let splitForRemainder = false
      if (settings.balanceLoads) {
        let balanced = partition(count)
        // A large rectangle may fit alone while its adjoining recess does not.
        // Include that load before choosing the split, so the recess can join a
        // smaller local field instead of crossing another circuit's inlet.
        while (remainders.length && native !== undefined && (settings.nativeRoomAreas?.get(native) ?? Infinity) <= 12 && balanced.maxM > limits.maxCircuitLengthM - .25 && count < 4 && last - first >= (count + 1) * pitch * 2) {
          count++; balanced = partition(count); splitForRemainder = true
        }
        for (let fewer = count - 1; fewer >= 1; fewer--) {
          const proposal = partition(fewer)
          if (proposal.maxM > limits.maxCircuitLengthM - .25) break
          count = fewer; balanced = proposal
        }
        cuts = balanced.cuts
      }
      if (splitForRemainder && count > 1 && remainders.length) {
        const spans = cuts.slice(1).map((end, i) => end - cuts[i]), part = spans.indexOf(Math.min(...spans))
        const middle = (cuts[part] + cuts[part + 1]) / 2
        const remainder = [...remainders].sort((a, b) => Math.abs((horizontal ? a.box.left + a.box.right : a.box.top + a.box.bottom) / 2 - middle) - Math.abs((horizontal ? b.box.left + b.box.right : b.box.top + b.box.bottom) / 2 - middle))[0]
        reservedJoins.push({ field, part, remainder: remainder.rectangle })
      }
      for (let part = 0; part < count; part++) {
        const start = Math.round(cuts[part]) + (part ? Math.ceil(pitch / 2) : 0)
        const end = Math.round(cuts[part + 1]) - (part + 1 < count ? Math.floor(pitch / 2) : 0)
        const box = { ...rect, ...(horizontal ? { left: start, right: end } : { top: start, bottom: end }) }
        // Centre complete laying intervals in the field. A fractional last
        // interval can leave a tiny centre pocket that cannot turn at R80.
        // The outer adjustment is bounded by half an interval on either side.
        const extraX = (box.right - box.left) % pitch, extraY = (box.bottom - box.top) % pitch
        box.left += Math.floor(extraX / 2); box.right -= Math.ceil(extraX / 2)
        box.top += Math.floor(extraY / 2); box.bottom -= Math.ceil(extraY / 2)
        const width = (box.right - box.left) * grid.step, height = (box.bottom - box.top) * grid.step
        const origin = grid.point(box.top * grid.width + box.left)
        const entries: { path: Point[]; pattern: 'spiral' | 'meander'; flipX: boolean; flipY: boolean; doorAligned: boolean; score: number; totalM: number }[] = []
        for (const field of optionsFor(width, height)) {
          const { path, axis } = field
          for (const flipX of [false, true]) for (const flipY of [false, true]) {
            if (entrySide === 0 && (axis !== 'x' || flipX) || entrySide === 1 && (axis !== 'x' || !flipX) ||
              entrySide === 2 && (axis !== 'y' || flipY) || entrySide === 3 && (axis !== 'y' || !flipY)) continue
            const convert = (p: Point) => ({ x: origin.x + (flipX ? width - p.x : p.x), y: origin.y + (flipY ? height - p.y : p.y) })
            const a = convert(path[0]), b = convert(path[1]), last = convert(path.at(-1)!)
            const length = Math.hypot(a.x - b.x, a.y - b.y), dx = (a.x - b.x) / length, dy = (a.y - b.y) / length
            let reach = 0, blocked = false
            for (let n = 1; n <= Math.max(grid.width, grid.height); n++) {
              reach = n * grid.step
              const cell = grid.index({ x: a.x + dx * reach, y: a.y + dy * reach })
              if (cell < 0 || grid.wall[cell] || grid.room[cell] !== room.id) break
              if (grid.obstacle[cell]) { blocked = true; break }
            }
            const mid = { x: (a.x + last.x) / 2, y: (a.y + last.y) / 2 }
            const doors = doorPoints.length ? doorPoints : [manifold]
            const access = Math.min(...doors.map((p) => Math.abs(p.x - mid.x) + Math.abs(p.y - mid.y)))
            let inletPenalty = 0
            const nativeEntry = settings.nativeRoom && native !== undefined && (settings.nativeRoomAreas?.get(native) ?? Infinity) <= 12 && (room.members?.length ?? 0) > 1
            if (nativeEntry) {
              for (const [end, near] of [[a, b], [last, convert(path.at(-2)!)]]) {
                const length = Math.hypot(end.x - near.x, end.y - near.y)
                for (let n = 1; n <= Math.max(grid.width, grid.height); n++) {
                  const cell = grid.index({ x: end.x + (end.x - near.x) / length * n * grid.step, y: end.y + (end.y - near.y) / length * n * grid.step })
                  if (cell < 0 || settings.nativeRoom![cell] !== native) {
                    if (cell < 0 || !grid.door[cell]) inletPenalty += drawingUnitsForMetres(10, scale)
                    break
                  }
                }
              }
            }
            entries.push({ path, pattern: field.pattern, flipX, flipY, doorAligned: Boolean(nativeEntry && !inletPenalty), totalM: field.loopM + leadCost(a) + leadCost(last) + limits.allowanceM, score: access + inletPenalty + (blocked ? drawingUnitsForMetres(20, scale) : 0) })
          }
        }
        const feasible = entries.filter((entry) => entry.totalM <= limits.maxCircuitLengthM)
        const allowed = feasible.length ? feasible : entries
        const preferred = allowed.filter((entry) => entry.pattern === (preferMeander ? 'meander' : 'spiral'))
        const candidates = preferred.length ? preferred : allowed
        candidates.sort((a, b) => a.score - b.score)
        const entry = candidates[variant % candidates.length]
        if (!entry) continue
        const path = entry.path.map((p) => ({ ...p }))
        // Keep the requested wall offset along the spiral, but give the two
        // connection ends one raster cell of tangent clearance. Otherwise R80
        // rounds to a 100 mm lead on the 25 mm grid and ends exactly in a wall.
        for (const [end, near] of [[0, 1], [path.length - 1, path.length - 2]]) {
          const a = path[end], b = path[near], length = Math.hypot(b.x - a.x, b.y - a.y)
          if (length > grid.step * 2) path[end] = { x: a.x + (b.x - a.x) / length * grid.step, y: a.y + (b.y - a.y) / length * grid.step }
        }
        const vertices = path.map((p) => grid.index({ x: origin.x + (entry.flipX ? width - p.x : p.x), y: origin.y + (entry.flipY ? height - p.y : p.y) }))
        const cells = [vertices[0]]
        for (const end of vertices.slice(1)) {
          const start = cells.at(-1)!
          if (start === end) continue
          const step = start % grid.width === end % grid.width ? Math.sign(end - start) * grid.width : Math.sign(end - start)
          const length = (end - start) / step
          if (!Number.isInteger(length) || length > size || (step !== 1 && step !== -1 && Math.abs(step) !== grid.width)) throw new Error(`${room.name}: ongeldig leidingtraject.`)
          for (let n = 1; n <= length; n++) cells.push(start + n * step)
        }
        // Allocation gaps are occupied by the neighbouring circuit's edge runs.
        covered += served / count
        const job: HeatingSpiralField = { doorAligned: entry.doorAligned, fieldBox: { ...box }, rectangular: true, cells, pattern: entry.pattern, roomName: room.name, roomKey: heatingRoomKey(room), areaM2: area / count,
          ...(room.members ? { roomMembers: room.members } : {}),
          spacingMinMm: settings.spacingMm, spacingMaxMm: settings.spacingMm }
        roomJobs.push(job)
        const family = rectangleJobs.get(field) ?? []; family[part] = job; rectangleJobs.set(field, family)
        for (const cell of cells) occupied.add(cell)
      }
    }
    for (const { field, part, remainder } of reservedJoins) {
      const connector = rectangleJobs.get(field)?.[part], neighbour = rectangleJobs.get(remainder)?.[0]
      if (!connector || !neighbour || connector.packingGroup || neighbour.packingGroup) continue
      connector.packingGroup = neighbour.packingGroup = `${heatingRoomKey(room)}:${field}:${part}`
    }
    for (const cell of room.cells) free[cell] = 0
    const uncoveredM2 = Math.max(0, usable - covered) * cellArea
    if (!settings.deferCoverage && uncoveredM2 > Math.max(.05, usable * cellArea * .05)) {
      const pipes = roomJobs.map((job, i) => {
        const points = job.cells.map(grid.point).filter((p, j, all) => !j || j === all.length - 1 || Math.abs((p.x - all[j - 1].x) * (all[j + 1].y - p.y) - (p.y - all[j - 1].y) * (all[j + 1].x - p.x)) > 1e-7)
        return createHeatingPipe(`remainder-${i}`, openHeatingTurns(points, drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), drawingUnitsForMetres(settings.diameterMm / 1000, scale)), { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: `field-${i}` })
      })
      const measured = measureHeatingCoverage({ ...grid, rooms: [room] }, pipes, scale, settings.spacingMm, settings.edgeMm, checkpoint).coverage.rooms[0]
      if (measured.gapM2 > Math.max(.1, measured.eligibleM2 * .05)) throw new Error(`${room.name}: ${measured.gapM2.toFixed(1)} m² blijft buiten het legpatroon met R${limits.minBendRadiusMm}. Controleer de vrije vloer en de doorgang.`)
    }
    jobs.push(...roomJobs)
  }
  if (!jobs.length && !settings.deferCoverage) throw new Error('Geen vrij vloeroppervlak gevonden voor een veilig legpatroon met deze buigradius en legafstand.')
  return { jobs, occupied }
}

/** Rebuild a raw rectangle with another entry axis before joining it. Mirrors
 * alone cannot turn a west-facing pair into a north-facing pair in a recess. */
export const heatingRectangleVariants = (field: HeatingSpiralField, grid: HeatingGrid, settings: Settings, scale: DrawingScale, checkpoint: () => void): number[][] => {
  if (!field.rectangular || !field.fieldBox) return []
  const box = field.fieldBox, width = (box.right - box.left) * grid.step, height = (box.bottom - box.top) * grid.step
  const origin = grid.point(box.top * grid.width + box.left), variants: number[][] = [], seen = new Set<string>()
  for (const axis of ['x', 'y'] as const) for (const returning of field.pattern === 'meander' ? [false, true] : [false]) {
    const path = (field.pattern === 'meander' ? rectangularHeatingMeander : rectangularHeatingSpiral)(width, height, { ...settings, returnToEntrySide: returning }, scale, checkpoint, axis)
    if (!path) continue
    for (const [end, near] of [[0, 1], [path.length - 1, path.length - 2]]) {
      const p = path[end], q = path[near], length = Math.hypot(q.x - p.x, q.y - p.y)
      if (length > grid.step * 2) path[end] = { x: p.x + (q.x - p.x) / length * grid.step, y: p.y + (q.y - p.y) / length * grid.step }
    }
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const vertices = path.map((p) => grid.index({ x: origin.x + (flipX ? width - p.x : p.x), y: origin.y + (flipY ? height - p.y : p.y) }))
      const key = vertices.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      const cells = [vertices[0]]
      for (const end of vertices.slice(1)) {
        const start = cells.at(-1)!
        if (start === end) continue
        const stride = start % grid.width === end % grid.width ? Math.sign(end - start) * grid.width : Math.sign(end - start)
        for (let n = 1, length = (end - start) / stride; n <= length; n++) cells.push(start + stride * n)
      }
      variants.push(cells)
    }
  }
  return variants
}
