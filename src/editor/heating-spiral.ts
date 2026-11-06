import type { Point } from './model/types.js'
import { createHeatingPipe, heatingDefaults } from './heating-plan.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres, drawingLengthMetres, type DrawingScale } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
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

export type HeatingSpiralField = { cells: number[]; roomName: string; roomKey?: string; areaM2: number; spacingMinMm: number; spacingMaxMm: number }
type Settings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }
type CellRect = { left: number; top: number; right: number; bottom: number }

/** Both arms wind inward in the same direction, one pitch apart. Reverse the
 * second arm at the centre to obtain one continuous counterflow double spiral. */
export const rectangularHeatingSpiral = (width: number, height: number, settings: Settings, scale: DrawingScale,
  checkpoint: () => void = () => {}): Point[] | null => {
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
  const transpose = height > width
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
  const free = new Uint8Array(size), distance = new Uint16Array(size).fill(65535), queue = new Int32Array(size)
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const clearance = Math.ceil(drawingUnitsForMetres(Math.max(.1, limits.minBendRadiusMm * .004), scale) / grid.step)
  const pitch = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
  let read = 0, write = 0
  for (let i = 0; i < size; i++) if (grid.wall[i]) { distance[i] = 0; queue[write++] = i }
  while (read < write) {
    if (read % 4096 === 0) checkpoint()
    const i = queue[read++], x = i % grid.width, y = Math.floor(i / grid.width)
    if (distance[i] >= clearance) continue
    for (const n of [x ? i - 1 : -1, x + 1 < grid.width ? i + 1 : -1, y ? i - grid.width : -1, y + 1 < grid.height ? i + grid.width : -1]) {
      if (n >= 0 && distance[n] > distance[i] + 1) { distance[n] = distance[i] + 1; queue[write++] = n }
    }
  }
  const cellArea = drawingLengthMetres(grid.step, scale) ** 2
  for (const room of grid.rooms) {
    checkpoint()
    let usable = 0, covered = 0
    for (const cell of room.cells) if (!grid.obstacle[cell] && !grid.loopObstacle[cell] && distance[cell] >= clearance) { free[cell] = 1; usable++ }
    const roomJobs: HeatingSpiralField[] = []
    const centre = grid.point(room.cells[Math.floor(room.cells.length / 2)])
    const leads = Math.min(55, 2 * drawingLengthMetres(Math.abs(centre.x - manifold.x) + Math.abs(centre.y - manifold.y), scale))
    const maxLoopM = Math.max(8, (Math.min(settings.diameterMm < 16 ? 70 : 90, limits.maxCircuitLengthM - limits.allowanceM) - leads) * budgetFactor)
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
      const count = Math.max(1, Math.ceil(area / (settings.spacingMm / 1000) / maxLoopM))
      const horizontal = (rect.right - rect.left >= rect.bottom - rect.top) !== Boolean(variant & 2)
      const first = horizontal ? rect.left : rect.top, last = horizontal ? rect.right : rect.bottom
      for (let part = 0; part < count; part++) {
        const start = first + Math.round((last - first) * part / count) + (part ? Math.ceil(pitch / 2) : 0)
        const end = first + Math.round((last - first) * (part + 1) / count) - (part + 1 < count ? Math.floor(pitch / 2) : 0)
        const box = { ...rect, ...(horizontal ? { left: start, right: end } : { top: start, bottom: end }) }
        const path = rectangularHeatingSpiral((box.right - box.left) * grid.step, (box.bottom - box.top) * grid.step, settings, scale, checkpoint)
        if (!path) continue
        const origin = grid.point(box.top * grid.width + box.left)
        const vertices = path.map((p) => grid.index({ x: origin.x + ((variant & 1) ? (box.right - box.left) * grid.step - p.x : p.x), y: origin.y + p.y }))
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
        const job: HeatingSpiralField = { cells, roomName: room.name, ...(room.roomKey ? { roomKey: room.roomKey } : {}), areaM2: area / count,
          spacingMinMm: settings.spacingMm, spacingMaxMm: settings.spacingMm }
        roomJobs.push(job)
        for (const cell of cells) occupied.add(cell)
      }
    }
    for (const cell of room.cells) free[cell] = 0
    const uncoveredM2 = Math.max(0, usable - covered) * cellArea
    if (uncoveredM2 > Math.max(.05, usable * cellArea * .05)) throw new Error(`${room.name}: ${uncoveredM2.toFixed(1)} m² past niet in een slakkenhuis met R${limits.minBendRadiusMm}. Deel deze ruimte op of pas de vrije vloeroppervlakte aan.`)
    jobs.push(...roomJobs)
  }
  if (!jobs.length) throw new Error('Geen vrij vloeroppervlak gevonden voor een slakkenhuis met deze buigradius en legafstand.')
  return { jobs, occupied }
}
