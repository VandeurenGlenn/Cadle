import type { PdfVectorLine } from './pdf-vector-conversion.js'

type Point = { x: number; y: number }

const projection = (point: Point, line: PdfVectorLine) => {
  const dx = line.x2 - line.x1
  const dy = line.y2 - line.y1
  const squared = dx * dx + dy * dy
  const position = squared ? Math.max(0, Math.min(1, ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / squared)) : 0
  const projected = { x: line.x1 + dx * position, y: line.y1 + dy * position }
  return { point: projected, distance: Math.hypot(point.x - projected.x, point.y - projected.y), position }
}

const angleDifference = (left: PdfVectorLine, right: PdfVectorLine) => {
  const difference = Math.abs(Math.atan2(left.y2 - left.y1, left.x2 - left.x1) - Math.atan2(right.y2 - right.y1, right.x2 - right.x1)) % Math.PI
  return Math.min(difference, Math.PI - difference)
}

export const detectPdfScanOpenings = (
  detailedLines: readonly PdfVectorLine[],
  wallLines: readonly PdfVectorLine[],
  page: { width: number; height: number }
): PdfVectorLine[] => {
  const minimum = Math.min(page.width, page.height) * 0.018
  const maximum = Math.min(page.width, page.height) * 0.15
  const tolerance = Math.max(3, Math.min(page.width, page.height) * 0.009)
  const suggestions: PdfVectorLine[] = []
  for (const candidate of detailedLines) {
    const length = Math.hypot(candidate.x2 - candidate.x1, candidate.y2 - candidate.y1)
    if (length < minimum || length > maximum || candidate.lineWidth >= 1.5) continue
    let best: { wallIndex: number; hinge: Point; distance: number; angle: number } | null = null
    for (let wallIndex = 0; wallIndex < wallLines.length; wallIndex += 1) {
      const wall = wallLines[wallIndex]
      if (wall.lineWidth < 1.5) continue
      const start = projection({ x: candidate.x1, y: candidate.y1 }, wall)
      const end = projection({ x: candidate.x2, y: candidate.y2 }, wall)
      const hinge = start.distance <= end.distance ? start : end
      const free = start.distance <= end.distance ? end : start
      const angle = angleDifference(candidate, wall)
      if (hinge.distance > tolerance || free.distance < length * 0.45 || angle < Math.PI / 7 || angle > Math.PI * 6 / 7) continue
      if (!best || hinge.distance < best.distance) best = { wallIndex, hinge: hinge.point, distance: hinge.distance, angle }
    }
    if (!best) continue
    const wall = wallLines[best.wallIndex]
    const wallLength = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    if (!wallLength) continue
    const ux = (wall.x2 - wall.x1) / wallLength
    const uy = (wall.y2 - wall.y1) / wallLength
    const half = length / 2
    suggestions.push({
      x1: best.hinge.x - ux * half,
      y1: best.hinge.y - uy * half,
      x2: best.hinge.x + ux * half,
      y2: best.hinge.y + uy * half,
      lineWidth: Math.max(1, candidate.lineWidth),
      reviewKind: 'door',
      boundWallIndex: best.wallIndex,
      reviewPending: true
    })
  }

  // Two short parallel strokes close to the same wall are a conservative
  // window suggestion. They remain review items instead of auto-confirming.
  for (let leftIndex = 0; leftIndex < detailedLines.length; leftIndex += 1) {
    const left = detailedLines[leftIndex]
    const leftLength = Math.hypot(left.x2 - left.x1, left.y2 - left.y1)
    if (leftLength < minimum || leftLength > maximum || left.lineWidth >= 1.5) continue
    for (let rightIndex = leftIndex + 1; rightIndex < detailedLines.length; rightIndex += 1) {
      const right = detailedLines[rightIndex]
      const rightLength = Math.hypot(right.x2 - right.x1, right.y2 - right.y1)
      if (rightLength < minimum || rightLength > maximum || Math.abs(leftLength - rightLength) > maximum * 0.18) continue
      if (angleDifference(left, right) > Math.PI / 45) continue
      const leftMid = { x: (left.x1 + left.x2) / 2, y: (left.y1 + left.y2) / 2 }
      const rightMid = { x: (right.x1 + right.x2) / 2, y: (right.y1 + right.y2) / 2 }
      if (Math.hypot(leftMid.x - rightMid.x, leftMid.y - rightMid.y) > tolerance * 4) continue
      const middle = { x: (leftMid.x + rightMid.x) / 2, y: (leftMid.y + rightMid.y) / 2 }
      const wallIndex = wallLines.findIndex((wall) => wall.lineWidth >= 1.5 && projection(middle, wall).distance <= tolerance * 1.5 && angleDifference(left, wall) <= Math.PI / 30)
      if (wallIndex < 0) continue
      const wall = wallLines[wallIndex]
      const first = projection({ x: left.x1, y: left.y1 }, wall).point
      const second = projection({ x: left.x2, y: left.y2 }, wall).point
      suggestions.push({ ...left, x1: first.x, y1: first.y, x2: second.x, y2: second.y, reviewKind: 'window', boundWallIndex: wallIndex, reviewPending: true })
      break
    }
  }
  return suggestions.filter((candidate, index, all) => all.findIndex((other) =>
    other.reviewKind === candidate.reviewKind && Math.hypot((other.x1 + other.x2) / 2 - (candidate.x1 + candidate.x2) / 2, (other.y1 + other.y2) / 2 - (candidate.y1 + candidate.y2) / 2) < tolerance
  ) === index).slice(0, 200)
}
