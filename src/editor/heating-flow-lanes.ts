import type { Point } from './model/types.js'
import { heatingLaneShift } from './heating-s-curve.js'
import { simplifyHeatingPath } from './heating-routing.js'

type Axis = 'x' | 'y'
const axisOf = (a: Point, b: Point): Axis | undefined =>
  Math.abs(a.x - b.x) < 1e-7 ? 'y' : Math.abs(a.y - b.y) < 1e-7 ? 'x' : undefined
const crossAxis = (axis: Axis): Axis => axis === 'x' ? 'y' : 'x'

/** Replace the square raster doglegs with two opposing radius-controlled arcs.
 * Candidate offsets let a bundle stagger its transitions at a shared door. */
export const smoothHeatingFlowLanes = (raw: Point[], radius: number, offset: number): Point[] => {
  const points = simplifyHeatingPath(raw).map((point) => ({ ...point }))
  const original = [...points]
  for (let i = 1; i + 2 < original.length; i++) {
    const [a, b, c, d] = original.slice(i - 1, i + 3)
    const axis = axisOf(a, b)
    if (!axis || axis !== axisOf(c, d) || axis === axisOf(b, c) || Math.abs(b[axis] - c[axis]) > 1e-7) continue
    const direction = Math.sign(b[axis] - a[axis])
    if (direction !== Math.sign(d[axis] - c[axis])) continue
    const cross = crossAxis(axis), shift = heatingLaneShift(radius, Math.abs(c[cross] - b[cross]))
    if (!shift) continue
    const before = Math.abs(b[axis] - points[i - 1][axis]) - (i > 1 ? radius : 0)
    const after = Math.abs(points[i + 2][axis] - c[axis]) - (i + 2 < points.length - 1 ? radius : 0)
    const low = shift.run / 2 - before, high = after - shift.run / 2
    if (low > high) continue
    const centre = Math.max(low, Math.min(high, offset))
    points[i] = { ...b, [axis]: b[axis] + direction * (centre - shift.run / 2 + shift.cut) }
    points[i + 1] = { ...c, [axis]: c[axis] + direction * (centre + shift.run / 2 - shift.cut) }
    i++
  }
  return points
}

const rayCoordinate = (a: Point, b: Point, axis: Axis, level: number) => {
  const delta = b[axis] - a[axis]
  if (Math.abs(delta) < 1e-7) return undefined
  const t = (level - a[axis]) / delta
  const cross = crossAxis(axis)
  return t >= 0 && t <= 1 ? a[cross] + (b[cross] - a[cross]) * t : undefined
}

/** Try moving one straight control leg to the lane selected by the common
 * flow. Both adjacent corners move together and the coil tangent stays fixed.
 * The caller still checks every resulting curve against the native floor. */
export function* alignHeatingFlowLegs(route: Point[], guide: Point[], radius: number, step: number): Generator<Point[]> {
  const firstAxis = route.length > 3 && guide.length > 3 ? axisOf(route[0], route[1]) : undefined
  if (firstAxis && firstAxis === axisOf(guide[0], guide[1]) &&
    crossAxis(firstAxis) === axisOf(route[1], route[2]) && crossAxis(firstAxis) === axisOf(guide[1], guide[2])) {
    const cross = crossAxis(firstAxis)
    // Move both legs of a doorway bend together. Moving only one leg can
    // make the elbow tighter or put it on the wrong side of a neighbour.
    if ((route[1][firstAxis] - route[0][firstAxis]) * (guide[1][firstAxis] - route[0][firstAxis]) > 0 &&
      (route[2][cross] - route[1][cross]) * (route[2][cross] - guide[1][cross]) > 0) {
      for (const offset of [0, step / 2, -step / 2]) {
        const across = guide[1][cross] + offset, along = guide[1][firstAxis] + offset
        yield [{ ...route[0], [cross]: across }, { ...route[1], [cross]: across, [firstAxis]: along },
          { ...route[2], [firstAxis]: along }, ...route.slice(3)]
      }
    }
  }
  for (let i = 0; i + 2 < route.length; i++) {
    const a = route[i], b = route[i + 1], axis = axisOf(a, b)
    if (!axis || Math.abs(b[axis] - a[axis]) < radius) continue
    const cross = crossAxis(axis), level = (a[axis] + b[axis]) / 2
    const matches = guide.slice(1).flatMap((p, j) => {
      const at = rayCoordinate(guide[j], p, axis, level)
      return at === undefined || Math.abs(at - a[cross]) > radius * 3 ? [] : [at]
    }).sort((x, y) => Math.abs(x - a[cross]) - Math.abs(y - a[cross]))
    const target = matches[0]
    if (target === undefined) continue
    for (const value of new Set([target, target - step / 2, target + step / 2])) {
      if (Math.abs(value - a[cross]) < 1e-7) continue
      const candidate = route.map((p, j) => j === i || j === i + 1 ? { ...p, [cross]: value } : p)
      yield candidate
    }
  }
}

/** Shift the line of approach to an inlet, retaining the two endpoint
 * tangents. The last leg must keep its original heading and endpoint. */
export function* shiftHeatingInletLane(route: Point[], radius: number, step: number): Generator<Point[]> {
  for (let i = route.length - 3; i > 0; i--) {
    const a = route[i], b = route[i + 1], axis = axisOf(a, b)
    if (!axis || Math.abs(b[axis] - a[axis]) < radius * 2 ||
      axisOf(route[i - 1], a) !== crossAxis(axis) || axisOf(b, route[i + 2]) !== crossAxis(axis)) continue
    const cross = crossAxis(axis)
    for (const shift of [step, -step, step * 2, -step * 2, step * 3, -step * 3, step / 2, -step / 2]) {
      const entry = a[cross] - route[i - 1][cross], exit = route[i + 2][cross] - b[cross]
      if (entry * (entry + shift) <= 0 || exit * (exit - shift) <= 0) continue
      yield route.map((p, j) => j === i || j === i + 1 ? { ...p, [cross]: p[cross] + shift } : p)
    }
  }
}
