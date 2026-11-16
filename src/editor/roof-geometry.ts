import type { Point, RoofPattern, RoofVariant } from './model/types.js'

export const DEFAULT_ROOF_FILL = '#b8b8b8'
export const DEFAULT_ROOF_STROKE = '#3b2c20'
export const DEFAULT_ROOF_STROKE_WIDTH = 2

export const isRoofVariant = (value: unknown): value is RoofVariant =>
  value === 'roof-left' || value === 'roof-straight' || value === 'roof-right'

export const oppositeRoofVariant = (variant: RoofVariant): RoofVariant =>
  variant === 'roof-left' ? 'roof-right' : variant === 'roof-right' ? 'roof-left' : 'roof-straight'

export const isRoofPattern = (value: unknown): value is RoofPattern =>
  value === 'none' || value === 'tiles' || value === 'slates' || value === 'standing-seam'

export type RoofBounds = { x: number; y: number; width: number; height: number }

export type RoofSegment = { start: Point; end: Point }

export type RoofGeometry = {
  junction: Point
  ridgeEnd: Point
  segments: readonly RoofSegment[]
}

/**
 * Creates a top-view hipped roof end. The hip lines stay at 45 degrees while
 * there is enough width; narrow footprints safely collapse the ridge at the
 * rectangle centre instead of letting the lines cross.
 */
export const roofGeometry = (bounds: RoofBounds, variant: RoofVariant): RoofGeometry => {
  const x = bounds.x
  const y = bounds.y
  const width = Math.max(0, bounds.width)
  const height = Math.max(0, bounds.height)
  const right = x + width
  const bottom = y + height
  const middleY = y + height / 2
  const hipInset = Math.min(width / 2, height / 2)
  if (variant === 'roof-straight') {
    const junction = { x, y: middleY }
    const ridgeEnd = { x: right, y: middleY }
    return {
      junction,
      ridgeEnd,
      segments: [{ start: junction, end: ridgeEnd }]
    }
  }
  const points = variant === 'roof-left'
    ? {
        cornerA: { x, y },
        cornerB: { x, y: bottom },
        junction: { x: x + hipInset, y: middleY },
        ridgeEnd: { x: right, y: middleY }
      }
    : {
        cornerA: { x: right, y },
        cornerB: { x: right, y: bottom },
        junction: { x: right - hipInset, y: middleY },
        ridgeEnd: { x, y: middleY }
      }

  return {
    junction: points.junction,
    ridgeEnd: points.ridgeEnd,
    segments: [
      { start: points.cornerA, end: points.junction },
      { start: points.cornerB, end: points.junction },
      { start: points.junction, end: points.ridgeEnd }
    ]
  }
}

export const roofPathData = (geometry: RoofGeometry): string =>
  geometry.segments
    .map(({ start, end }) => `M ${start.x} ${start.y} L ${end.x} ${end.y}`)
    .join(' ')

const boundedDivisions = (length: number, target: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, Math.round(length / target)))

/** Decorative top-view roofing lines, already clipped to the rectangular roof bounds. */
export const roofPatternPathData = (bounds: RoofBounds, pattern: RoofPattern): string => {
  if (pattern === 'none' || bounds.width <= 0 || bounds.height <= 0) return ''
  const left = bounds.x
  const top = bounds.y
  const right = left + bounds.width
  const bottom = top + bounds.height
  const commands: string[] = []

  if (pattern === 'standing-seam') {
    const columns = boundedDivisions(bounds.width, 26, 2, 30)
    const columnWidth = bounds.width / columns
    for (let column = 1; column < columns; column += 1) {
      const x = left + column * columnWidth
      commands.push(`M ${x} ${top} L ${x} ${bottom}`)
    }
    return commands.join(' ')
  }

  const targetRowHeight = pattern === 'tiles' ? 22 : 14
  const rows = boundedDivisions(bounds.height, targetRowHeight, 2, 30)
  const rowHeight = bounds.height / rows
  const cellWidth = rowHeight * (pattern === 'tiles' ? 1.65 : 1.9)

  for (let row = 1; row < rows; row += 1) {
    const y = top + row * rowHeight
    commands.push(`M ${left} ${y} L ${right} ${y}`)
  }
  for (let row = 0; row < rows; row += 1) {
    const y1 = top + row * rowHeight
    const y2 = Math.min(bottom, y1 + rowHeight)
    const offset = row % 2 === 0 ? 0 : cellWidth / 2
    for (let x = left + offset + cellWidth; x < right - 0.01; x += cellWidth) {
      commands.push(`M ${x} ${y1} L ${x} ${y2}`)
    }
  }
  return commands.join(' ')
}
