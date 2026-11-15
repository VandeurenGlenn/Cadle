import type { Point } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'

/** Extend a straight loose tip across the source threshold without adding a
 * bend. The caller validates every candidate against the complete real scene. */
export const bringHeatingSourceEndInside = <T extends Point>(points: readonly T[], diameterMm: number, scale: number,
  options: { inside: (point: Point) => boolean; valid: (points: T[]) => boolean; checkpoint: () => void }): T[] | null => {
  if (!points.length) return null
  if (options.inside(points[0])) return points.map((p) => ({ ...p }))
  if (points.length < 2) return null
  const [head, next] = points, length = Math.hypot(head.x - next.x, head.y - next.y)
  if (!length) return null
  for (let advanceMm = diameterMm; advanceMm <= 200; advanceMm += Math.max(1, diameterMm / 2)) {
    options.checkpoint()
    const advance = drawingUnitsForMetres(advanceMm / 1000, scale)
    const end = { ...head, x: head.x + (head.x - next.x) / length * advance,
      y: head.y + (head.y - next.y) / length * advance }
    if (!options.inside(end)) continue
    const candidate = [end, ...points.slice(1).map((p) => ({ ...p }))]
    if (options.valid(candidate)) return candidate
  }
  return null
}
