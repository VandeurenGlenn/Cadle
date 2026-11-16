import type { Point, RoofVariant } from './model/types.js'

export const DEFAULT_ROOF_FILL = '#b8b8b8'
export const DEFAULT_ROOF_STROKE = '#3b2c20'
export const DEFAULT_ROOF_STROKE_WIDTH = 2

export const isRoofVariant = (value: unknown): value is RoofVariant =>
  value === 'roof-left' || value === 'roof-right'

export const oppositeRoofVariant = (variant: RoofVariant): RoofVariant =>
  variant === 'roof-left' ? 'roof-right' : 'roof-left'

export type RoofBounds = { x: number; y: number; width: number; height: number }

export type RoofSegment = { start: Point; end: Point }

export type RoofGeometry = {
  junction: Point
  ridgeEnd: Point
  segments: readonly [RoofSegment, RoofSegment, RoofSegment]
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
