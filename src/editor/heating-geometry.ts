import type { Point, RectShape } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { heatingDesignLimits } from './heating-design.js'

export type PipePiece = { a: Point; b: Point; primitive: number; offset: number }
export type PipeGeometry = { path: string; length: number; localPoints: Point[]; points: Point[]; pieces: PipePiece[]; bends: { point: Point; radiusMm: number }[] }

/** One source for the rendered curves, actual curve lengths and geometric validation. */
export const heatingPipeGeometry = (shape: RectShape): PipeGeometry => {
  const data = shape.heating!, x = Math.min(shape.start.x, shape.end.x), y = Math.min(shape.start.y, shape.end.y)
  const width = Math.abs(shape.end.x - shape.start.x), height = Math.abs(shape.end.y - shape.start.y)
  const points = (data.points ?? []).map((p) => ({ x: x + p.x * width, y: y + p.y * height }))
  const pieces: PipePiece[] = [], bends: PipeGeometry['bends'] = []
  if (!points.length) return { path: '', length: 0, localPoints: points, points, pieces, bends }
  let path = `M ${points[0].x} ${points[0].y}`, cursor = points[0], length = 0, primitive = 0
  const line = (to: Point) => {
    const distance = Math.hypot(to.x - cursor.x, to.y - cursor.y)
    if (distance > 1e-8) { pieces.push({ a: cursor, b: to, primitive: primitive++, offset: length }); length += distance; path += ` L ${to.x} ${to.y}` }
    cursor = to
  }
  const limit = heatingDesignLimits(data.diameterMm, data.design).minBendRadiusMm
  const desired = drawingUnitsForMetres(Math.max(limit / 1000, data.pipeRole === 'loop' ? Math.min(.1, data.spacingMm / 2000) : 0), data.drawingScale)
  // Allocate tangent lengths per shared segment. Endpoint segments have their full
  // length available; neighbouring fillets share only the segment between them.
  const cuts = points.map(() => 0)
  if (data.automatic) for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1], u = Math.hypot(p.x - a.x, p.y - a.y), v = Math.hypot(b.x - p.x, b.y - p.y)
    if (!u || !v) continue
    const dot = Math.max(-1, Math.min(1, ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (u * v)))
    if (Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-8) cuts[i] = desired * Math.tan(Math.acos(dot) / 2)
  }
  for (let i = 1; i < points.length; i++) {
    const available = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y), used = cuts[i - 1] + cuts[i]
    if (used > available && used > 0) { const factor = available / used; cuts[i - 1] *= factor; cuts[i] *= factor }
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], p = points[i], b = points[i + 1]
    const before = Math.hypot(p.x - a.x, p.y - a.y), after = Math.hypot(b.x - p.x, b.y - p.y)
    if (!before || !after) { line(p); continue }
    const ux = (p.x - a.x) / before, uy = (p.y - a.y) / before, vx = (b.x - p.x) / after, vy = (b.y - p.y) / after
    const cross = ux * vy - uy * vx, dot = Math.max(-1, Math.min(1, ux * vx + uy * vy))
    if (Math.abs(cross) < 1e-8) { line(p); if (dot < 0) bends.push({ point: p, radiusMm: 0 }); continue }
    const angle = Math.acos(dot), tangent = Math.tan(angle / 2)
    const radius = data.automatic ? cuts[i] / tangent : 0
    bends.push({ point: p, radiusMm: radius * data.drawingScale / 8 })
    if (radius < 1e-8) { line(p); continue }
    const cut = radius * tangent, from = { x: p.x - ux * cut, y: p.y - uy * cut }, to = { x: p.x + vx * cut, y: p.y + vy * cut }
    line(from)
    const sign = cross > 0 ? 1 : -1, centre = { x: from.x - uy * radius * sign, y: from.y + ux * radius * sign }
    const startAngle = Math.atan2(from.y - centre.y, from.x - centre.x), count = Math.max(4, Math.ceil(angle / (Math.PI / 24)))
    for (let n = 1; n <= count; n++) {
      const theta = startAngle + sign * angle * n / count
      const end = n === count ? to : { x: centre.x + Math.cos(theta) * radius, y: centre.y + Math.sin(theta) * radius }
      pieces.push({ a: cursor, b: end, primitive, offset: length + radius * angle * (n - 1) / count }); cursor = end
    }
    primitive++; length += radius * angle
    path += ` A ${radius} ${radius} 0 0 ${sign > 0 ? 1 : 0} ${to.x} ${to.y}`
  }
  if (points.length > 1) line(points.at(-1)!)
  const cx = x + width / 2, cy = y + height / 2, radians = (shape.rotation ?? 0) * Math.PI / 180
  const transform = (p: Point): Point => {
    const dx = (p.x - cx) * (shape.flipX ? -1 : 1), dy = (p.y - cy) * (shape.flipY ? -1 : 1)
    return { x: cx + dx * Math.cos(radians) - dy * Math.sin(radians), y: cy + dx * Math.sin(radians) + dy * Math.cos(radians) }
  }
  return { path, length, localPoints: points, points: points.map(transform), pieces: pieces.map((p) => ({ ...p, a: transform(p.a), b: transform(p.b) })),
    bends: bends.map((bend) => ({ ...bend, point: transform(bend.point) })) }
}
