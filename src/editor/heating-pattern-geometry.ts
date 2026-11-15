import type { Point } from './model/types.js'
import { createHeatingPipe, heatingPipeData } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { heatingLaneShift } from './heating-s-curve.js'

type Settings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs; returnToEntrySide?: boolean }

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

/** A fillet at a re-entrant floor corner cuts across the excluded quadrant.
 * Move that corner into free floor and bridge the parallel legs with tangent
 * S-bends. The original endpoints and their directions stay fixed. Callers
 * still audit the complete rounded tube for clearance and self-intersection. */
export const clearHeatingConcaveTurns = (points: Point[], radius: number, inside: (point: Point) => boolean): Point[] | null => {
  const moved = points.map((point) => ({ ...point })), cuts = points.map(() => 0)
  let changed = false
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y)
    if (!before || !after) return null
    const u = { x: (b.x - a.x) / before, y: (b.y - a.y) / before }, v = { x: (c.x - b.x) / after, y: (c.y - b.y) / after }
    const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y)), angle = Math.acos(dot)
    cuts[i] = radius * Math.tan(angle / 2)
    if (Math.abs(dot) > 1e-6) continue
    const cross = u.x * v.y - u.y * v.x
    const from = { x: b.x - u.x * radius, y: b.y - u.y * radius }
    const centre = { x: from.x + v.x * radius, y: from.y + v.y * radius }
    const theta = Math.atan2(from.y - centre.y, from.x - centre.x)
    if (Array.from({ length: 11 }, (_, n) => {
      const turn = theta + cross * Math.PI / 2 * (n + 1) / 12
      return inside({ x: centre.x + radius * Math.cos(turn), y: centre.y + radius * Math.sin(turn) })
    }).every(Boolean)) continue
    moved[i] = { x: b.x + (u.x - v.x) * radius, y: b.y + (u.y - v.y) * radius }
    changed = true
  }
  if (!changed) return null
  const result: Point[] = [moved[0]]
  for (let i = 1; i < points.length; i++) {
    const a = moved[i - 1], b = moved[i], length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    const u = { x: (points[i].x - points[i - 1].x) / length, y: (points[i].y - points[i - 1].y) / length }, normal = { x: -u.y, y: u.x }
    const lateral = (b.x - a.x) * normal.x + (b.y - a.y) * normal.y
    if (Math.abs(lateral) > 1e-6) {
      const shift = heatingLaneShift(radius, Math.abs(lateral)), run = (b.x - a.x) * u.x + (b.y - a.y) * u.y - cuts[i - 1] - cuts[i]
      if (!shift || run < shift.run - 1e-6) return null
      const start = { x: a.x + u.x * (cuts[i - 1] + (run - shift.run) / 2), y: a.y + u.y * (cuts[i - 1] + (run - shift.run) / 2) }
      const end = { x: start.x + u.x * shift.run + normal.x * lateral, y: start.y + u.y * shift.run + normal.y * lateral }
      result.push({ x: start.x + u.x * shift.cut, y: start.y + u.y * shift.cut },
        { x: end.x - u.x * shift.cut, y: end.y - u.y * shift.cut })
    }
    result.push(b)
  }
  return result
}

export const heatingPairedEntries = (points: readonly Point[], spacingMm: number, scale: number, gridStep = 0) => {
  if (points.length < 3) return false
  const first = points[0], next = points[1], last = points.at(-1)!, previous = points.at(-2)!
  const ax = first.x - next.x, ay = first.y - next.y, bx = last.x - previous.x, by = last.y - previous.y
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by)
  return lengths > 1e-8 && (ax * bx + ay * by) / lengths >= .7 &&
    Math.hypot(first.x - last.x, first.y - last.y) <= drawingUnitsForMetres(2 * spacingMm / 1000, scale) + gridStep + 1e-6
}

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
        ...heatingPipeData(100), ...settings, drawingScale: scale, automatic: true, circuitId: 'spiral', pipeRole: 'loop'
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
  const pipe = createHeatingPipe('meander-check', opened, { ...heatingPipeData(100), ...settings, drawingScale: scale, automatic: true, circuitId: 'meander', pipeRole: 'loop' })
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

