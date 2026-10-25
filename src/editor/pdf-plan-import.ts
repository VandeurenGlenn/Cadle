import {
  PAPER_PRESETS,
  paperWorldSize
} from './constants.js'
import type { PaperPreset } from './model/types.js'
import { pageLayout } from './layout/page-layout.js'

const PDF_POINTS_PER_MM = 72 / 25.4

export const pdfPreviewRenderScale = (
  width: number,
  height: number,
  preferredScale = 1.5,
  maximumPixels = 3_000_000,
  maximumDimension = 2400
): number => {
  if (!(width > 0) || !(height > 0)) return 1
  const pixelScale = Math.sqrt(maximumPixels / (width * height))
  const dimensionScale = maximumDimension / Math.max(width, height)
  const scale = Math.min(preferredScale, pixelScale, dimensionScale)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export const paperPresetForPdfPage = (width: number, height: number): PaperPreset => {
  const landscape = width > height
  const oriented = (size: 'a4' | 'a3'): PaperPreset => `${size}-${landscape ? 'landscape' : 'portrait'}`
  if (!(width > 0) || !(height > 0)) return oriented('a4')

  const candidates = [oriented('a4'), oriented('a3')] as PaperPreset[]
  let best = candidates[0]
  let bestError = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const paper = PAPER_PRESETS[candidate]
    const expectedWidth = paper.widthMm * PDF_POINTS_PER_MM
    const expectedHeight = paper.heightMm * PDF_POINTS_PER_MM
    const error = Math.abs(width - expectedWidth) / expectedWidth + Math.abs(height - expectedHeight) / expectedHeight
    if (error < bestError) {
      best = candidate
      bestError = error
    }
  }
  return best
}

export const fitPdfPageToPaper = (
  sourceWidth: number,
  sourceHeight: number,
  preset: PaperPreset,
  marginMm = 10
) => {
  const world = paperWorldSize(preset)
  const area = pageLayout(world.width, world.height, marginMm).content
  const availableWidth = Math.max(1, area.width)
  const availableHeight = Math.max(1, area.height)
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  return {
    worldWidth: world.width,
    worldHeight: world.height,
    width,
    height,
    position: { x: area.x + area.width / 2, y: area.y + area.height / 2 }
  }
}

export const importedPlanPageName = (fileName: string, pageNumber: number, importedPageCount: number) => {
  const baseName = fileName.replace(/\.pdf$/i, '').trim() || 'Old plan'
  return importedPageCount > 1 ? `${baseName} – page ${pageNumber}` : baseName
}
