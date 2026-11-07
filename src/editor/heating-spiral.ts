import type { Point } from './model/types.js'
import { createHeatingPipe, heatingDefaults, heatingManifoldSize } from './heating-plan.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres, drawingLengthMetres, type DrawingScale } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { heatingRoomKey, heatingWallDistances, measureHeatingCoverage } from './heating-coverage.js'
import type { HeatingGrid } from './heating-routing.js'

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

export type HeatingSpiralField = { cells: number[]; roomName: string; roomKey?: string; roomMembers?: { key: string; name: string }[]; areaM2: number; spacingMinMm: number; spacingMaxMm: number }
type Settings = { deferCoverage?: boolean; reserveAccess?: boolean; loopBudgetByRoom?: Readonly<Record<string, number>>; diameterMm: number; spacingMm: number; edgeMm?: number; capacity?: number; design?: HeatingDesignInputs }
type CellRect = { left: number; top: number; right: number; bottom: number }

/** Both arms wind inward in the same direction, one pitch apart. Reverse the
 * second arm at the centre to obtain one continuous counterflow double spiral. */
export const rectangularHeatingSpiral = (width: number, height: number, settings: Settings, scale: DrawingScale,
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
        ...heatingDefaults('pipe', scale), ...settings, automatic: true, circuitId: 'spiral', pipeRole: 'loop'
      })
      const geometry = heatingPipeGeometry(pipe)
      if (geometry.bends.every((bend) => bend.radiusMm + .1 >= heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm) &&
        !checkHeatingPlan([pipe], [], settings.design, [], { checkpoint, stopOnConflict: true }).errors) best = raw
    }
    a.push(endA); b.push(endB)
    if (side === 0 && sideIndex > 0) left += 2 * pitch
    if (side === 1) top += 2 * pitch
    if (side === 2) right -= 2 * pitch
    if (side === 3) bottom -= 2 * pitch
  }
  return best?.map(({ x, y }) => transpose ? { x: y, y: x } : { x, y }) ?? null
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
  const clearance = Math.ceil(drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale) / grid.step)
  const pitch = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
  const cellArea = drawingLengthMetres(grid.step, scale) ** 2
  for (const room of grid.rooms) {
    checkpoint()
    let usable = 0, covered = 0
    let accessSide = -1, bestDoor = Infinity
    if (settings.reserveAccess) for (const cell of room.cells) {
      if (!grid.door[cell]) continue
      const p = grid.point(cell), score = Math.abs(p.x - manifold.x) + Math.abs(p.y - manifold.y)
      if (score >= bestDoor) continue
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      const edges = [x - room.minX, room.maxX - x, y - room.minY, room.maxY - y]
      accessSide = edges.indexOf(Math.min(...edges)); bestDoor = score
    }
    const accessCells = Math.ceil(drawingUnitsForMetres(((settings.edgeMm ?? 100) + 2 * limits.minBendRadiusMm) / 1000, scale) / grid.step)
    for (const cell of room.cells) {
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      const edge = accessSide < 0 ? Infinity : [x - room.minX, room.maxX - x, y - room.minY, room.maxY - y][accessSide]
      if (!grid.obstacle[cell] && !grid.loopObstacle[cell] && distance[cell] >= clearance && edge >= accessCells) { free[cell] = 1; usable++ }
    }
    const roomJobs: HeatingSpiralField[] = []
    const doorPoints = room.cells.filter((cell) => grid.door[cell]).map(grid.point)
    const centre = grid.point(room.cells[Math.floor(room.cells.length / 2)])
    const leads = Math.min(55, 2 * drawingLengthMetres(Math.abs(centre.x - manifold.x) + Math.abs(centre.y - manifold.y), scale))
    const maxLoopM = Math.max(8, (Math.min(settings.diameterMm < 16 ? 70 : limits.maxCircuitLengthM, limits.maxCircuitLengthM - limits.allowanceM) - leads) * budgetFactor * (settings.loopBudgetByRoom?.[heatingRoomKey(room)] ?? 1))
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
      const area = served * cellArea
      let count = Math.max(1, Math.ceil(area / (settings.spacingMm / 1000) / maxLoopM))
      // Try the real complete spiral before splitting an area estimate into
      // fields and joining them again. The estimate includes strips already
      // heated by edge runs, and its arbitrary flood-fill midpoint can greatly
      // overestimate the leads. Unnecessary splitting creates entrance barriers.
      const fullWidth = (rect.right - rect.left - (rect.right - rect.left) % pitch) * grid.step
      const fullHeight = (rect.bottom - rect.top - (rect.bottom - rect.top) % pitch) * grid.step
      const full = rectangularHeatingSpiral(fullWidth, fullHeight, settings, scale, checkpoint)
      if (full) {
        const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
        const pipe = createHeatingPipe('full-field', openHeatingTurns(full, radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
          { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop' })
        const loopM = drawingLengthMetres(heatingPipeGeometry(pipe).length, scale)
        const size = heatingManifoldSize(settings.capacity ?? 12, scale, grid.step), origin = grid.point(rect.top * grid.width + rect.left)
        const lead = (p: Point) => Math.abs(p.y - manifold.y - size.height) + Math.max(0, manifold.x - p.x, p.x - manifold.x - size.width)
        let minLeads = Infinity
        for (const flipX of [false, true]) for (const flipY of [false, true]) {
          const world = (p: Point) => ({ x: origin.x + (flipX ? fullWidth - p.x : p.x), y: origin.y + (flipY ? fullHeight - p.y : p.y) })
          minLeads = Math.min(minLeads, drawingLengthMetres(lead(world(full[0])) + lead(world(full.at(-1)!)), scale))
        }
        const available = Math.max(8, Math.min(settings.diameterMm < 16 ? 70 : limits.maxCircuitLengthM, limits.maxCircuitLengthM - limits.allowanceM - minLeads) * budgetFactor * (settings.loopBudgetByRoom?.[heatingRoomKey(room)] ?? 1))
        count = Math.max(1, Math.ceil(loopM / available))
      }
      const horizontal = (rect.right - rect.left >= rect.bottom - rect.top) !== Boolean(variant & 4)
      const first = horizontal ? rect.left : rect.top, last = horizontal ? rect.right : rect.bottom
      for (let part = 0; part < count; part++) {
        const start = first + Math.round((last - first) * part / count) + (part ? Math.ceil(pitch / 2) : 0)
        const end = first + Math.round((last - first) * (part + 1) / count) - (part + 1 < count ? Math.floor(pitch / 2) : 0)
        const box = { ...rect, ...(horizontal ? { left: start, right: end } : { top: start, bottom: end }) }
        // Centre complete laying intervals in the field. A fractional last
        // interval can leave a tiny centre pocket that cannot turn at R80.
        // The outer adjustment is bounded by half an interval on either side.
        const extraX = (box.right - box.left) % pitch, extraY = (box.bottom - box.top) % pitch
        box.left += Math.floor(extraX / 2); box.right -= Math.ceil(extraX / 2)
        box.top += Math.floor(extraY / 2); box.bottom -= Math.ceil(extraY / 2)
        const width = (box.right - box.left) * grid.step, height = (box.bottom - box.top) * grid.step
        const origin = grid.point(box.top * grid.width + box.left)
        const entries: { path: Point[]; flipX: boolean; flipY: boolean; score: number }[] = []
        for (const axis of ['x', 'y'] as const) {
          const path = rectangularHeatingSpiral(width, height, settings, scale, checkpoint, axis)
          if (!path) continue
          for (const flipX of [false, true]) for (const flipY of [false, true]) {
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
            entries.push({ path, flipX, flipY, score: access + 2 * reach + (blocked ? drawingUnitsForMetres(20, scale) : 0) })
          }
        }
        entries.sort((a, b) => a.score - b.score)
        const entry = entries[variant % entries.length]
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
          if (!Number.isInteger(length) || length > size || (step !== 1 && step !== -1 && Math.abs(step) !== grid.width)) throw new Error(`${room.name}: ongeldig slakkenhuistraject.`)
          for (let n = 1; n <= length; n++) cells.push(start + n * step)
        }
        // Allocation gaps are occupied by the neighbouring circuit's edge runs.
        covered += served / count
        const job: HeatingSpiralField = { cells, roomName: room.name, roomKey: heatingRoomKey(room), areaM2: area / count,
          ...(room.members ? { roomMembers: room.members } : {}),
          spacingMinMm: settings.spacingMm, spacingMaxMm: settings.spacingMm }
        roomJobs.push(job)
        for (const cell of cells) occupied.add(cell)
      }
    }
    for (const cell of room.cells) free[cell] = 0
    const uncoveredM2 = Math.max(0, usable - covered) * cellArea
    if (!settings.deferCoverage && uncoveredM2 > Math.max(.05, usable * cellArea * .05)) {
      const pipes = roomJobs.map((job, i) => {
        const points = job.cells.map(grid.point).filter((p, j, all) => !j || j === all.length - 1 || Math.abs((p.x - all[j - 1].x) * (all[j + 1].y - p.y) - (p.y - all[j - 1].y) * (all[j + 1].x - p.x)) > 1e-7)
        return createHeatingPipe(`remainder-${i}`, openHeatingTurns(points, drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), drawingUnitsForMetres(settings.diameterMm / 1000, scale)), { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: `field-${i}` })
      })
      const measured = measureHeatingCoverage({ ...grid, rooms: [room] }, pipes, scale, settings.spacingMm, settings.edgeMm, checkpoint).coverage.rooms[0]
      if (measured.gapM2 > Math.max(.1, measured.eligibleM2 * .05)) throw new Error(`${room.name}: ${measured.gapM2.toFixed(1)} m² blijft buiten de getekende slakkenhuizen met R${limits.minBendRadiusMm}. Controleer de vrije vloer en de doorgang.`)
    }
    jobs.push(...roomJobs)
  }
  if (!jobs.length && !settings.deferCoverage) throw new Error('Geen vrij vloeroppervlak gevonden voor een slakkenhuis met deze buigradius en legafstand.')
  return { jobs, occupied }
}
