import type { LineShape, Point } from '../model/types.js'

type SegmentProjection = { point: Point; distance: number }

const projectPointToSegment = (point: Point, start: Point, end: Point): SegmentProjection => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return { point: { ...start }, distance: Math.hypot(point.x - start.x, point.y - start.y) }
  }

  const position = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const projection = { x: start.x + position * dx, y: start.y + position * dy }
  return { point: projection, distance: Math.hypot(point.x - projection.x, point.y - projection.y) }
}

export const bindOpeningToNearestWall = (
  opening: LineShape,
  walls: readonly LineShape[],
  tolerance = 12
): LineShape => {
  const midpoint = {
    x: (opening.start.x + opening.end.x) / 2,
    y: (opening.start.y + opening.end.y) / 2
  }
  let best: { wall: LineShape; start: Point; end: Point; score: number } | null = null

  for (const wall of walls) {
    const start = projectPointToSegment(opening.start, wall.start, wall.end)
    const end = projectPointToSegment(opening.end, wall.start, wall.end)
    const middle = projectPointToSegment(midpoint, wall.start, wall.end)
    if (start.distance > tolerance || end.distance > tolerance || middle.distance > tolerance) continue
    if (Math.hypot(end.point.x - start.point.x, end.point.y - start.point.y) < 2) continue

    const score = start.distance + end.distance + middle.distance
    if (!best || score < best.score) best = { wall, start: start.point, end: end.point, score }
  }

  const bound = { ...opening }
  if (!best) {
    delete bound.wallId
    return bound
  }

  bound.start = best.start
  bound.end = best.end
  bound.wallId = best.wall.id
  return bound
}
