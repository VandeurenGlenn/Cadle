import type { Point } from './model/types.js'
import { heatingLaneShift } from './heating-s-curve.js'
import { simplifyHeatingPath } from './heating-routing.js'

type Axis = 'x' | 'y'
const axisOf = (a: Point, b: Point): Axis | undefined =>
  Math.abs(a.x - b.x) < 1e-7 ? 'y' : Math.abs(a.y - b.y) < 1e-7 ? 'x' : undefined
const crossAxis = (axis: Axis): Axis => axis === 'x' ? 'y' : 'x'

/** Shift an orthogonal guide to a parallel lane. Adjacent turns meet at the
 * intersection of the shifted runs, leaving the same approach headings. */
export const offsetHeatingFlowGuide = (points: readonly Point[], offset: number): Point[] | undefined => {
  const normals = points.slice(1).map((p, i) => {
    const a = points[i], axis = axisOf(a, p)
    return axis ? { axis: crossAxis(axis), sign: (axis === 'x' ? 1 : -1) * Math.sign(p[axis] - a[axis]) } : undefined
  })
  if (normals.some((normal) => !normal)) return
  const shifted = points.map((point, index) => {
    const p = { ...point }
    for (const normal of [normals[index - 1], normals[index]])
      if (normal) p[normal.axis] = point[normal.axis] + normal.sign * offset
    return p
  })
  if (shifted.slice(1).some((p, i) => {
    const a = points[i], b = points[i + 1], axis = crossAxis(normals[i]!.axis)
    return (p[axis] - shifted[i][axis]) * (b[axis] - a[axis]) <= 0
  })) return
  return shifted
}

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

/** Start the final lane change on the straight approach when the raster
 * made the last jog too close to the coil. Keep the coil's entry tangent. */
export function* roundHeatingFlowInlet(route: Point[], radius: number): Generator<Point[]> {
  const points = simplifyHeatingPath(route)
  if (points.length < 4) return
  const end = points.at(-1)!, before = points.at(-2)!, axis = axisOf(before, end)
  if (!axis) return
  const cross = crossAxis(axis), direction = Math.sign(end[axis] - before[axis])
  for (let i = points.length - 4; i >= Math.max(0, points.length - 9); i--) {
    const a = points[i], b = points[i + 1], lateral = Math.abs(end[cross] - a[cross])
    if (axisOf(a, b) !== axis || (b[axis] - a[axis]) * direction <= 0 || lateral < 1e-7 || lateral > radius * 4) continue
    if (points.slice(i + 1).some((p, n) => (p[axis] - points[i + n][axis]) * direction < -1e-7)) continue
    const angles = lateral >= radius ? [Math.PI / 4, Math.PI / 3] : []
    const shifts = [heatingLaneShift(radius, lateral), ...angles.map((angle) => {
      const cut = radius * Math.tan(angle / 2)
      return { cut, run: 2 * cut + lateral / Math.tan(angle) }
    })]
    for (const shift of shifts) if (shift) for (const margin of [radius / 4, radius / 2, radius, radius * 1.5]) {
      const exit = end[axis] - direction * margin, entry = exit - direction * shift.run
      if ((entry - a[axis]) * direction < (i ? radius : 0)) continue
      yield [...points.slice(0, i + 1), { ...a, [axis]: entry + direction * shift.cut },
        { ...end, [axis]: exit - direction * shift.cut }, end]
    }
  }
}

const rayCoordinate = (a: Point, b: Point, axis: Axis, level: number) => {
  const delta = b[axis] - a[axis]
  if (Math.abs(delta) < 1e-7) return undefined
  const t = (level - a[axis]) / delta
  const cross = crossAxis(axis)
  return t >= 0 && t <= 1 ? a[cross] + (b[cross] - a[cross]) * t : undefined
}

/** Follow the shared doorway trunk, then rejoin an independently proved
 * distal approach at its first substantial transverse turn. */
export function* alignHeatingFlowTrunk(route: Point[], guide: Point[], radius: number, step: number): Generator<Point[]> {
  const mouth = guide.findIndex((a, i) => i > 0 && i + 1 < guide.length &&
    Math.hypot(a.x - guide[i + 1].x, a.y - guide[i + 1].y) >= radius * 12)
  if (mouth < 1) return
  const bend = guide[mouth], trunk = axisOf(bend, guide[mouth + 1])
  if (!trunk) return
  const cross = crossAxis(trunk)
  if (axisOf(guide[mouth - 1], bend) !== cross) return
  const direction = Math.sign(guide[mouth + 1][trunk] - bend[trunk])
  const pivot = route.findIndex((a, i) => i > 0 && i + 2 < route.length &&
    (a[trunk] - bend[trunk]) * direction >= radius * 12 && axisOf(a, route[i + 1]) === cross &&
    Math.abs(route[i + 1][cross] - a[cross]) >= radius * 2)
  if (pivot < 0) return
  const distal = route[pivot], next = route[pivot + 1]
  const travel = Math.sign(next[cross] - distal[cross])
  if ((next[cross] - bend[cross]) * travel < radius * 2) return
  const start = { ...bend, [cross]: route[0][cross] }
  if ((bend[cross] - start[cross]) * Math.sign(bend[cross] - guide[mouth - 1][cross]) < radius) return
  for (const [lane, station] of [[0, 0], [-step, 0], [step, 0], [0, -step], [0, step],
    [-step / 2, -step], [step / 2, step], [-step / 2, step], [step / 2, -step]]) {
    const phase = distal[trunk] + station
    if (station && axisOf(next, route[pivot + 2]) !== trunk) continue
    const y = bend[cross] + lane
    yield [start, { ...bend, [cross]: y }, { ...distal, [trunk]: phase, [cross]: y },
      { ...next, [trunk]: phase }, ...route.slice(pivot + 2)]
  }
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
