import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'
import type { Point, Shape } from '../model/types.js'

export const DRAWING_SCALES = [50, 100] as const
export type DrawingScale = typeof DRAWING_SCALES[number]
export const DEFAULT_DRAWING_SCALE: DrawingScale = 50
export const isDrawingScale = (value: unknown): value is DrawingScale => value === 50 || value === 100
export const drawingLengthMetres = (length: number, scale: number): number => length / PAPER_WORLD_UNITS_PER_MM * scale / 1000
export const drawingUnitsForMetres = (metres: number, scale: number): number => metres * 1000 * PAPER_WORLD_UNITS_PER_MM / scale
export const drawingScaleLabel = (scale: number): string => `1:${new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 2 }).format(scale)}`

/** Change construction geometry while keeping annotations and devices readable on paper. */
export const scaleGroundPlanGeometry = (shapes: readonly Shape[], factor: number): Shape[] => {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1 || !shapes.length) return [...shapes]
  const anchors = shapes.flatMap((shape): Point[] => {
    if ('start' in shape) return [shape.start, shape.end]
    if (shape.kind === 'image') return [
      { x: shape.position.x - shape.width / 2, y: shape.position.y - shape.height / 2 },
      { x: shape.position.x + shape.width / 2, y: shape.position.y + shape.height / 2 }
    ]
    return [shape.position]
  })
  const center = {
    x: (Math.min(...anchors.map((point) => point.x)) + Math.max(...anchors.map((point) => point.x))) / 2,
    y: (Math.min(...anchors.map((point) => point.y)) + Math.max(...anchors.map((point) => point.y))) / 2
  }
  const point = (value: Point): Point => ({ x: center.x + (value.x - center.x) * factor, y: center.y + (value.y - center.y) * factor })
  return shapes.map((shape): Shape => {
    if ('start' in shape) return { ...shape, start: point(shape.start), end: point(shape.end),
      ...(shape.kind === 'line' && shape.connection?.via ? { connection: { ...shape.connection, via: shape.connection.via.map(point) } } : {}) }
    if (shape.kind === 'image') return { ...shape, position: point(shape.position), width: shape.width * factor, height: shape.height * factor }
    return { ...shape, position: point(shape.position) }
  })
}

export const rescaleGroundPlan = (shapes: readonly Shape[], from: DrawingScale, to: DrawingScale): Shape[] =>
  scaleGroundPlanGeometry(shapes, from / to)
