import type { Point, Shape } from '../model/types.js'

/** Resolve physical wall geometry before the grid. Radius is in screen pixels,
 * so endpoint and T-junction snapping feel the same at every zoom level. */
export const snapWallPoint = (raw: Point, shapes: readonly Shape[], gridPoint: Point, options: {
  zoom?: number; enabled?: boolean; start?: Point; orthogonal?: boolean
} = {}): { point: Point; snapped: boolean } => {
  if (options.enabled === false) return { point: raw, snapped: false }
  const radius = 10 / Math.max(.1, options.zoom ?? 1), start = options.start
  const dx = start ? raw.x - start.x : 0, dy = start ? raw.y - start.y : 0
  const axis = start ? options.orthogonal ? (Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical')
    : Math.abs(dy) < radius && Math.abs(dx) > 2 * Math.abs(dy) ? 'horizontal'
      : Math.abs(dx) < radius && Math.abs(dy) > 2 * Math.abs(dx) ? 'vertical' : null : null
  const onAxis = (p: Point, strict = Boolean(options.orthogonal)) => !strict || !axis ||
    Math.abs(axis === 'horizontal' ? p.y - start!.y : p.x - start!.x) < 1e-6
  const isChainStart = (p: Point) => start && Math.hypot(p.x - start.x, p.y - start.y) < 1e-6
  const walls = shapes.filter((shape) => shape.kind === 'wall' && !shape.hidden &&
    Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y) > 1e-6)
  let best: Point | null = null, distance = radius
  for (const wall of walls) {
    if (wall.kind !== 'wall') continue
    for (const point of [wall.start, wall.end]) {
      if (isChainStart(point)) continue
      const d = Math.hypot(point.x - raw.x, point.y - raw.y)
      if (onAxis(point) && d <= distance) { best = point; distance = d }
    }
  }
  if (best) return { point: { ...best }, snapped: true }
  distance = radius
  for (const wall of walls) {
    if (wall.kind !== 'wall') continue
    const wx = wall.end.x - wall.start.x, wy = wall.end.y - wall.start.y
    const t = axis === 'horizontal' && Math.abs(wy) > 1e-9 ? (start!.y - wall.start.y) / wy
      : axis === 'vertical' && Math.abs(wx) > 1e-9 ? (start!.x - wall.start.x) / wx
        : ((raw.x - wall.start.x) * wx + (raw.y - wall.start.y) * wy) / (wx * wx + wy * wy)
    if (t < 0 || t > 1) continue
    const point = { x: wall.start.x + wx * t, y: wall.start.y + wy * t }, d = Math.hypot(point.x - raw.x, point.y - raw.y)
    if (!isChainStart(point) && onAxis(point, true) && d <= distance) { best = point; distance = d }
  }
  if (best) return { point: best, snapped: true }
  return { point: axis === 'horizontal' ? { x: gridPoint.x, y: start!.y }
    : axis === 'vertical' ? { x: start!.x, y: gridPoint.y } : gridPoint, snapped: false }
}
