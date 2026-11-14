import type { Point } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'

type Direction = { x: number; y: number }
const direction = (a: Point, b: Point): Direction => {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
}
const perpendicular = (a: Direction, b: Direction) => Math.abs(a.x * b.x + a.y * b.y) < 1e-6

/** Slide a shared approach run and its loose source tails together. Moving
 * either alone can leave the other parallel run less than one tube OD away.
 * The caller audits the complete rendered curves, original walls and pipes. */
export const shiftHeatingApproachLanes = (pair: readonly Point[][], scale: number, options: {
  sourceEnd: (point: Point) => boolean
  valid: (pair: Point[][]) => boolean
  checkpoint: () => void
  occupied?: readonly Point[][]
  separationMm?: number
}): Point[][] | null => {
  if (pair.length !== 2 || pair.some((points) => points.length < 4)) return null
  // Remove a short launch S only as a candidate: a grid-phase correction
  // near the source is unnecessary when a straight loose tail clears it.
  const normalise = (points: Point[]) => {
    if (points.length < 5) return points
    const a = direction(points[0], points[1]), b = direction(points[2], points[3])
    if (Math.abs(a.x * b.x + a.y * b.y - 1) > 1e-6 ||
      Math.hypot(points[2].x - points[0].x, points[2].y - points[0].y) > drawingUnitsForMetres(.4, scale)) return points
    const head = Math.abs(a.x) > .999 ? { ...points[0], y: points[2].y } : { ...points[0], x: points[2].x }
    return options.sourceEnd(head) ? [head, ...points.slice(3)] : points
  }
  const normalised = pair.map(normalise)
  const variants: Point[][][] = [pair.map((points) => points), normalised, [pair[0], normalised[1]], [normalised[0], pair[1]]]
  const seen = new Set<string>()
  for (const base of variants) {
    const key = JSON.stringify(base)
    if (seen.has(key)) continue
    seen.add(key)
    if (options.valid(base)) return base
    const source = base.map((points) => {
      const incoming = direction(points[0], points[1]), outgoing = direction(points[1], points[2])
      return perpendicular(incoming, outgoing) ? outgoing : null
    })
    if (source.some((value) => !value)) continue
    const shifts = [0, ...[20, 40, 60, 80, 100, 150, 200, 300, 400].flatMap((mm) => {
      const offset = drawingUnitsForMetres(mm / 1000, scale)
      return [offset, -offset]
    })]
    let evaluated = 0
    corners: for (let corner = 2; corner < Math.min(10, ...base.map((points) => points.length - 1)); corner++) {
      const outgoing = base.map((points, i) => {
        const u = direction(points[corner - 1], points[corner]), v = direction(points[corner], points[corner + 1])
        return perpendicular(u, v) && perpendicular(v, source[i]!) ? v : null
      })
      if (outgoing.some((value) => !value)) continue
      const alignedShifts = (axis: Direction, at: Point, along: Direction) => {
        if (!options.occupied?.length) return shifts
        const gap = drawingUnitsForMetres((options.separationMm ?? 20) / 1000, scale), candidates: number[] = []
        for (const points of options.occupied) for (let i = 1; i + 1 < points.length; i++) {
          const incoming = direction(points[i - 1], points[i])
          if (Math.abs(incoming.x * along.x + incoming.y * along.y) < .999) continue
          const offset = (points[i].x - at.x) * axis.x + (points[i].y - at.y) * axis.y
          for (const lane of [-2, -1, 1, 2]) if (Math.abs(offset + lane * gap) <= shifts.at(-2)! + 1e-6) candidates.push(offset + lane * gap)
        }
        const hints = [...new Map(candidates.map((value) => [Math.round(value * 1e6), value])).values()]
          .sort((a, b) => Math.abs(a) - Math.abs(b)).slice(0, 16)
        return [...new Map([...hints, ...shifts].map((value) => [Math.round(value * 1e6), value])).values()]
      }
      const approachShifts = alignedShifts(outgoing[0]!, base[0][corner], direction(base[0][corner - 1], base[0][corner]))
      const tailShifts = alignedShifts(source[0]!, base[0][0], direction(base[0][0], base[0][1]))
      for (const approach of approachShifts) for (const tail of tailShifts) {
        options.checkpoint()
        if (!approach && !tail) continue
        const candidates = base.map((points, i) => points.map((point, n) => ({ ...point,
          x: point.x + (n <= corner ? outgoing[i]!.x * approach : 0) + (n <= 1 ? source[i]!.x * tail : 0),
          y: point.y + (n <= corner ? outgoing[i]!.y * approach : 0) + (n <= 1 ? source[i]!.y * tail : 0) })))
        if (candidates.some((points) => !options.sourceEnd(points[0]))) continue
        if (++evaluated > (options.occupied?.length ? 1200 : 192)) break corners
        if (options.valid(candidates)) return candidates
      }
    }
  }
  return null
}
