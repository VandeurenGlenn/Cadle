import { shapeBounds } from '../model/model.js'
import type { Point, Shape } from '../model/types.js'

const scaleShape = (shape: Shape, scale: number, offsetX: number, offsetY: number): Shape => {
  const point = ({ x, y }: Point): Point => ({ x: x * scale + offsetX, y: y * scale + offsetY })
  const bindingLabelOffset = shape.bindingLabelOffset
    ? { bindingLabelOffset: { x: shape.bindingLabelOffset.x * scale, y: shape.bindingLabelOffset.y * scale } }
    : {}

  if ('start' in shape) {
    return {
      ...shape,
      start: point(shape.start),
      end: point(shape.end),
      ...(shape.scale ? { scale: shape.scale * scale } : {}),
      ...bindingLabelOffset
    }
  }
  if (shape.kind === 'image') {
    return {
      ...shape,
      position: point(shape.position),
      width: shape.width * scale,
      height: shape.height * scale,
      ...bindingLabelOffset
    }
  }
  return {
    ...shape,
    position: point(shape.position),
    scale: (shape.scale ?? 1) * scale,
    ...bindingLabelOffset
  }
}

export const scaleShapesBetweenPages = (
  shapes: readonly Shape[],
  scale: number,
  offsetX: number,
  offsetY: number
): Shape[] => shapes.map((shape) => scaleShape(shape, scale, offsetX, offsetY))

export const fitLegacyGroundPlanToPrintArea = (
  shapes: readonly Shape[],
  page: { width: number; height: number; widthMm: number; heightMm: number; marginMm: number }
): { shapes: Shape[]; changed: boolean; scale: number } => {
  if (shapes.length < 10) return { shapes: [...shapes], changed: false, scale: 1 }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of shapes) {
    if (shape.hidden) continue
    const bounds = shapeBounds(shape)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
  if (!Number.isFinite(contentWidth) || !Number.isFinite(contentHeight) || contentWidth <= 0 || contentHeight <= 0) {
    return { shapes: [...shapes], changed: false, scale: 1 }
  }

  const marginX = (page.marginMm / page.widthMm) * page.width
  const marginY = (page.marginMm / page.heightMm) * page.height
  const printableWidth = Math.max(1, page.width - marginX * 2)
  const printableHeight = Math.max(1, page.height - marginY * 2)
  const scale = Math.min(printableWidth / contentWidth, printableHeight / contentHeight)
  if (scale < 1.15 || scale > 2.5) return { shapes: [...shapes], changed: false, scale: 1 }

  const offsetX = marginX + (printableWidth - contentWidth * scale) / 2 - minX * scale
  const offsetY = marginY + (printableHeight - contentHeight * scale) / 2 - minY * scale
  return { shapes: scaleShapesBetweenPages(shapes, scale, offsetX, offsetY), changed: true, scale }
}
