import { lineMetrics, shapeBounds } from '../model/model.js'
import { resizedSymbolStrokeWidth } from '../model/symbol-scale.js'
import type { Point, Shape } from '../model/types.js'
import { pageLayout } from './page-layout.js'
import { oneWireLayoutBounds } from './onewire-connections.js'

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
    ...(shape.kind === 'symbol' &&
    typeof shape.strokeWidth === 'number'
      ? { strokeWidth: resizedSymbolStrokeWidth(shape, shape.scale * scale) }
      : {}),
    ...bindingLabelOffset
  }
}

export const scaleShapesBetweenPages = (
  shapes: readonly Shape[],
  scale: number,
  offsetX: number,
  offsetY: number
): Shape[] => shapes.map((shape) => scaleShape(shape, scale, offsetX, offsetY))

export const fitShapesToContentArea = (
  shapes: readonly Shape[],
  area: { x: number; y: number; width: number; height: number },
  padding = 24
): { shapes: Shape[]; changed: boolean } => {
  const boxes = shapes.filter((shape) => !shape.hidden).map((shape) => {
    const bounds = shape.kind === 'text' ? oneWireLayoutBounds(shape) : shapeBounds(shape)
    if (shape.kind !== 'door' && shape.kind !== 'gate') return bounds
    const { length, nx, ny } = lineMetrics(shape)
    const reach = length * (shape.kind === 'gate' ? 0.5 : 1) * (shape.flipSide ? -1 : 1)
    const xs = [bounds.x, bounds.x + bounds.width, shape.start.x + nx * reach]
    const ys = [bounds.y, bounds.y + bounds.height, shape.start.y + ny * reach]
    if (shape.kind === 'gate') {
      xs.push(shape.end.x + nx * reach)
      ys.push(shape.end.y + ny * reach)
    }
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  })
  if (!boxes.length) return { shapes: [...shapes], changed: false }
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  const x = area.x + padding
  const y = area.y + padding
  const width = Math.max(1, area.width - padding * 2)
  const height = Math.max(1, area.height - padding * 2)
  if (left >= x && top >= y && right <= x + width && bottom <= y + height) {
    return { shapes: [...shapes], changed: false }
  }
  const scale = Math.min(1, width / Math.max(1, right - left), height / Math.max(1, bottom - top))
  const offsetX = x + (width - (right - left) * scale) / 2 - left * scale
  const offsetY = y + (height - (bottom - top) * scale) / 2 - top * scale
  return { shapes: scaleShapesBetweenPages(shapes, scale, offsetX, offsetY), changed: true }
}

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
    const bounds = shape.kind === 'text' ? oneWireLayoutBounds(shape) : shapeBounds(shape)
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

  const area = pageLayout(page.width, page.height, page.marginMm, page.width / page.widthMm).content
  const printableWidth = Math.max(1, area.width)
  const printableHeight = Math.max(1, area.height)
  const scale = Math.min(printableWidth / contentWidth, printableHeight / contentHeight)
  if (scale < 1.15 || scale > 2.5) return { shapes: [...shapes], changed: false, scale: 1 }

  const offsetX = area.x + (printableWidth - contentWidth * scale) / 2 - minX * scale
  const offsetY = area.y + (printableHeight - contentHeight * scale) / 2 - minY * scale
  return { shapes: scaleShapesBetweenPages(shapes, scale, offsetX, offsetY), changed: true, scale }
}
