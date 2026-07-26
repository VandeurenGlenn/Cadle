import { cloneShape, shapeBounds } from '../../editor/model/model.js'
import type { Shape } from '../../editor/model/types.js'
import { shapeMarkup } from '../export/svg-export.js'
import { translateShape } from '../interaction/shape-transforms.js'

export type CatalogSelectionDraft = {
  svgMarkup: string
  defaultScale: number
  fallbackName: string
  shapes: Shape[]
}

export const buildCatalogSelectionDraft = (
  shapes: readonly Shape[],
  selectedShapeIds: Iterable<string>
): CatalogSelectionDraft | null => {
  const selectedIds = new Set(selectedShapeIds)
  if (!selectedIds.size) return null
  const selectedShapes = shapes.filter((shape) => selectedIds.has(shape.id)).map((shape) => cloneShape(shape))
  if (!selectedShapes.length) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of selectedShapes) {
    const bounds = shapeBounds(shape)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }

  const padding = 8
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)
  const defaultScale = Math.max(0.4, Math.min(20, Math.max(contentWidth, contentHeight) / 24))
  const translatedShapes = selectedShapes.map((shape) =>
    translateShape(cloneShape(shape), -minX + padding, -minY + padding)
  )
  const width = Math.max(24, contentWidth + padding * 2)
  const height = Math.max(24, contentHeight + padding * 2)
  const markup = translatedShapes.map((shape) => shapeMarkup(shape, false)).join('')
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${markup}</svg>`
  const fallbackName =
    selectedShapes.length === 1
      ? `${selectedShapes[0].kind.charAt(0).toUpperCase() + selectedShapes[0].kind.slice(1)} symbol`
      : 'Custom symbol'

  return { svgMarkup, defaultScale, fallbackName, shapes: translatedShapes }
}
