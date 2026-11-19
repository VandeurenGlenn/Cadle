import type { LineShape, Point, RectShape, Shape, StairRoute } from './types.js'
import { stairGeometry } from './stair-geometry.js'

const EPS = 1e-6
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: Point, n: number): Point => ({ x: a.x * n, y: a.y * n })
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const unit = (a: Point, b: Point): Point => mul(sub(b, a), 1 / distance(a, b))
const normal = (v: Point): Point => ({ x: -v.y, y: v.x })
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y
const xy = (p: Point): string => `${p.x} ${p.y}`
const path = (points: readonly Point[]): string => points.map((p, i) => `${i ? 'L' : 'M'} ${xy(p)}`).join(' ')
const boundsFor = (shape: RectShape) => ({
  x: Math.min(shape.start.x, shape.end.x), y: Math.min(shape.start.y, shape.end.y),
  width: Math.abs(shape.end.x - shape.start.x), height: Math.abs(shape.end.y - shape.start.y)
})

export const cleanStairRoute = (points: readonly Point[]): Point[] => {
  const result: Point[] = []
  for (const point of points) {
    if (result.length && distance(result[result.length - 1], point) < EPS) continue
    const a = result.at(-2), b = result.at(-1)
    if (a && b && Math.abs(cross(sub(b, a), sub(point, b))) < EPS &&
      (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) > 0) result.pop()
    result.push({ ...point })
  }
  return result
}

export const snapStairRoutePoint = (point: Point, previous?: Point): Point =>
  !previous ? point : Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y)
    ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y }

export const stairRouteError = (points: readonly Point[], width: number): string | null => {
  if (!Number.isFinite(width) || width <= 0) return 'Vul een geldige trapbreedte in.'
  if (points.length < 2) return 'Teken minstens een lijnstuk voor de trap.'
  if (points.length > 200) return 'Een traptraject mag maximaal 200 punten bevatten.'
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i])
    if (length < (i === 1 || i === points.length - 1 ? width / 2 : width)) {
      return 'Een lijnstuk is te kort voor de trapbreedte. Teken het langer of kies een smallere trap.'
    }
    if (i > 1) {
      const a = unit(points[i - 2], points[i - 1]), b = unit(points[i - 1], points[i])
      if (a.x * b.x + a.y * b.y < -0.99) return 'Keer niet op dezelfde lijn terug. Teken de bochten van de trap.'
    }
  }
  return null
}

export const sanitizeStairRoute = (value: unknown): StairRoute | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as { points?: unknown; width?: unknown }
  if (typeof raw.width !== 'number' || !Number.isFinite(raw.width) || raw.width <= 0 ||
    !Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 200) return undefined
  const points: Point[] = []
  for (const p of raw.points) {
    if (!p || typeof p !== 'object' || !('x' in p) || !('y' in p) ||
      typeof p.x !== 'number' || !Number.isFinite(p.x) || p.x < 0 || p.x > 1 ||
      typeof p.y !== 'number' || !Number.isFinite(p.y) || p.y < 0 || p.y > 1) return undefined
    points.push({ x: p.x, y: p.y })
  }
  if (cleanStairRoute(points).length < 2) return undefined
  return { points, width: raw.width }
}

const routeEdges = (points: readonly Point[], width: number): { left: Point[]; right: Point[] } => {
  const directions = points.slice(1).map((p, i) => unit(points[i], p))
  const offsets = points.map((_, i) => {
    const before = directions[Math.max(0, i - 1)], after = directions[Math.min(i, directions.length - 1)]
    const denominator = 1 + before.x * after.x + before.y * after.y
    return denominator < EPS ? mul(normal(before), width / 2)
      : mul(add(normal(before), normal(after)), width / 2 / denominator)
  })
  return {
    left: points.map((p, i) => add(p, offsets[i])),
    right: points.map((p, i) => sub(p, offsets[i]))
  }
}

export const createStairRoute = (id: string, input: readonly Point[], width: number): RectShape => {
  const points = cleanStairRoute(input)
  const error = stairRouteError(points, width)
  if (error) throw new Error(error)
  const edges = routeEdges(points, width), all = [...edges.left, ...edges.right]
  const x = Math.min(...all.map((p) => p.x)), y = Math.min(...all.map((p) => p.y))
  const w = Math.max(...all.map((p) => p.x)) - x, h = Math.max(...all.map((p) => p.y)) - y
  return { id, kind: 'rect', variant: 'stairs-route', start: { x, y }, end: { x: x + w, y: y + h },
    strokeWidth: 2, stairRoute: {
      points: points.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h })),
      width: width / Math.min(w, h)
    } }
}

export const stairRoutePoints = (shape: RectShape): Point[] => {
  const { x, y, width: w, height: h } = boundsFor(shape)
  if (shape.stairRoute) return shape.stairRoute.points.map((p) => ({ x: x + p.x * w, y: y + p.y * h }))
  const flight = shape.variant === 'stairs-double-quarter-turn' ? Math.min(w / 3, h * 0.4) : Math.min(w, h) * 0.4
  if (shape.variant === 'stairs-quarter-turn') return [
    { x: x + flight / 2, y: y + h }, { x: x + flight / 2, y: y + flight / 2 }, { x: x + w, y: y + flight / 2 }
  ]
  if (shape.variant === 'stairs-double-quarter-turn') return [
    { x: x + flight / 2, y: y + h }, { x: x + flight / 2, y: y + flight / 2 },
    { x: x + w - flight / 2, y: y + flight / 2 }, { x: x + w - flight / 2, y: y + h }
  ]
  return [{ x: x + w / 2, y: y + h }, { x: x + w / 2, y }]
}

export const stairRouteWidth = (shape: RectShape): number => {
  const { width: w, height: h } = boundsFor(shape)
  if (shape.stairRoute) return shape.stairRoute.width * Math.min(w, h)
  if (shape.variant === 'stairs-straight') return w
  return shape.variant === 'stairs-double-quarter-turn' ? Math.min(w / 3, h * 0.4) : Math.min(w, h) * 0.4
}

const localPoint = (p: Point, shape: RectShape): Point => {
  const b = boundsFor(shape), cx = b.x + b.width / 2, cy = b.y + b.height / 2
  const angle = -(shape.rotation ?? 0) * Math.PI / 180, dx = p.x - cx, dy = p.y - cy
  return { x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * (shape.flipX ? -1 : 1),
    y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * (shape.flipY ? -1 : 1) }
}

type CutPlane = { normal: Point; offset: number }
type VisibleRoute = { points: Point[]; cut: boolean; plane?: CutPlane }

export const visibleStairRoute = (shape: RectShape, scene: readonly Shape[]): VisibleRoute => {
  const points = cleanStairRoute(stairRoutePoints(shape))
  if (shape.stairClipAtWalls === false) return { points, cut: false }
  const walls = scene.filter((s): s is LineShape => s.kind === 'wall' && !s.hidden).map((s) => ({
    start: localPoint(s.start, shape), end: localPoint(s.end, shape), thickness: s.strokeWidth ?? 8
  }))
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], v = sub(points[i], start)
    let first = Infinity
    let plane: CutPlane | undefined
    for (const wall of walls) {
      const w = sub(wall.end, wall.start), determinant = cross(v, w)
      if (Math.abs(determinant) < EPS) continue
      const delta = sub(wall.start, start), t = cross(delta, w) / determinant, u = cross(delta, v) / determinant
      if (t <= EPS || t > 1 + EPS || u <= EPS || u >= 1 - EPS) continue
      const wallLength = distance(wall.start, wall.end)
      const nearFace = Math.max(0, t - wall.thickness * wallLength / (2 * Math.abs(determinant)))
      if (nearFace < first) {
        first = nearFace
        const n = mul(normal(w), Math.sign(cross(w, sub(start, wall.start))) / wallLength)
        plane = { normal: n, offset: dot(n, wall.start) + wall.thickness / 2 }
      }
    }
    if (first !== Infinity) {
      const visible = cleanStairRoute([...points.slice(0, i), add(start, mul(v, first))])
      return { points: visible, cut: true, plane }
    }
  }
  return { points, cut: false }
}

export const stairRouteGeometry = (points: readonly Point[], width: number, cut = false, plane?: CutPlane) => {
  if (points.length < 2) return { outline: '', treads: '', arrow: '', breakLine: '' }
  const { left, right } = routeEdges(points, width), treads: string[] = []
  const clippedLine = (a: Point, b: Point): string => {
    if (!plane) return path([a, b])
    const da = dot(plane.normal, a) - plane.offset, db = dot(plane.normal, b) - plane.offset
    if (da < -EPS && db < -EPS) return ''
    if (da >= -EPS && db >= -EPS) return path([a, b])
    const intersection = add(a, mul(sub(b, a), da / (da - db)))
    return path([da < -EPS ? intersection : a, db < -EPS ? intersection : b])
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], direction = unit(a, b), n = normal(direction)
    const start = i > 1 ? width / 2 : 0
    const end = distance(a, b) - (i < points.length - 1 ? width / 2 : 0)
    const count = Math.max(1, Math.min(200, Math.round((end - start) / (width / 4))))
    if (end > start) for (let j = 0; j <= count; j++) {
      const center = add(a, mul(direction, start + (end - start) * j / count))
      const treadStart = add(center, mul(n, width / 2)), treadEnd = sub(center, mul(n, width / 2))
      const nearCut = i === points.length - 1 || (i === points.length - 2 && distance(center, b) <= width / 2 + EPS)
      treads.push(nearCut ? clippedLine(treadStart, treadEnd) : path([treadStart, treadEnd]))
    }
    if (i < points.length - 1) treads.push(i === points.length - 2 ? clippedLine(left[i], right[i]) : path([left[i], right[i]]))
  }
  const last = points.length - 1, direction = unit(points[last - 1], points[last])
  const inset = Math.min(width / 4, distance(points[last - 1], points[last]) / 3)
  const tip = sub(points[last], mul(direction, inset)), head = Math.min(width / 7, inset)
  const arrowPoints = [add(points[0], mul(unit(points[0], points[1]), Math.min(width / 4, distance(points[0], points[1]) / 3))),
    ...points.slice(1, -1), tip]
  const n = normal(direction), base = sub(tip, mul(direction, head))
  const cappedSide = (side: Point[]): Point[] => {
    if (!plane) return side
    const prefix = side.slice(0, -1), lastPoint = side[side.length - 1]
    const previous = prefix[prefix.length - 1], before = prefix.at(-2)
    if (before && dot(plane.normal, previous) < plane.offset - EPS &&
      Math.abs(dot(plane.normal, sub(previous, before))) > EPS) {
      prefix.pop()
      return [...prefix, add(before, mul(sub(previous, before),
        (plane.offset - dot(plane.normal, before)) / dot(plane.normal, sub(previous, before))))]
    }
    const denominator = dot(plane.normal, direction)
    const cap = Math.abs(denominator) > EPS
      ? add(lastPoint, mul(direction, (plane.offset - dot(plane.normal, lastPoint)) / denominator))
      : add(lastPoint, mul(plane.normal, plane.offset - dot(plane.normal, lastPoint)))
    return [...prefix, cap]
  }
  const outlineLeft = cappedSide(left), outlineRight = cappedSide(right)
  return {
    outline: `${path([...outlineLeft, ...outlineRight.reverse()])} Z`,
    treads: treads.join(' '),
    arrow: `${path(arrowPoints)} ${clippedLine(add(base, mul(n, head)), tip)} ${clippedLine(tip, sub(base, mul(n, head)))}`,
    breakLine: cut ? [-1, 1].map((side) => {
      const center = sub(points[last], mul(direction, Math.min(width / 5, distance(points[last - 1], points[last]) / 2)))
      const offset = mul(n, side * width / 5)
      const size = Math.min(width / 10, distance(points[last - 1], points[last]) / 4)
      return clippedLine(add(add(center, offset), mul(direction, size)), sub(add(center, mul(n, side * width / 5 + width / 8)), mul(direction, size)))
    }).join(' ') : ''
  }
}

export const stairShapeGeometry = (shape: RectShape, scene: readonly Shape[] = []) => {
  if (shape.variant === 'stairs-spiral') return { ...stairGeometry(boundsFor(shape), shape.variant), breakLine: '' }
  const visible = visibleStairRoute(shape, scene)
  if (shape.variant === 'stairs-route' || visible.cut) return stairRouteGeometry(visible.points, stairRouteWidth(shape), visible.cut, visible.plane)
  return { ...stairGeometry(boundsFor(shape), shape.variant === 'stairs-quarter-turn' || shape.variant === 'stairs-double-quarter-turn'
    ? shape.variant : 'stairs-straight'), breakLine: '' }
}
