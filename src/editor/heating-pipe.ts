import type { Point, RectShape } from './model/types.js'
import type { HeatingData } from './heating-plan.js'

export const heatingPipeData = (drawingScale: number): HeatingData => ({ kind: 'pipe', name: 'Buis', drawingScale, spacingMm: 150, edgeMm: 100, diameterMm: 16, circuits: 1, direction: 'horizontal', pipeRole: 'supply' })

export const createHeatingPipe = (id: string, points: Point[], data: HeatingData): RectShape => {
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - x, height = Math.max(...points.map((p) => p.y)) - y
  return { id, kind: 'rect', start: { x, y }, end: { x: x + width, y: y + height }, strokeWidth: 2,
    heating: { ...data, kind: 'pipe', points: points.map((p) => ({ x: width ? (p.x - x) / width : 0, y: height ? (p.y - y) / height : 0 })) } }
}

