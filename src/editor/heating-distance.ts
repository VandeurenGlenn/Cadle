import type { Point } from './model/types.js'

export const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

