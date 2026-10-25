import { DEFAULT_PRINT_MARGIN_MM, PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

// All document furniture is measured on paper, never in screen pixels.
export const PAGE_DETAILS_HEIGHT_MM = 30
export const PAGE_DETAILS_GAP_MM = 5
export const PAPER_LABEL_FONT_SIZE = 2.75 * PAPER_WORLD_UNITS_PER_MM
export const paperTextScale = (heightMm: number) => heightMm * PAPER_WORLD_UNITS_PER_MM / 18

export const pageLayout = (
  width: number,
  height: number,
  marginMm = DEFAULT_PRINT_MARGIN_MM,
  unitsPerMm = PAPER_WORLD_UNITS_PER_MM,
  originX = 0,
  originY = 0
) => {
  const margin = Math.max(DEFAULT_PRINT_MARGIN_MM, marginMm) * unitsPerMm
  const detailsHeight = PAGE_DETAILS_HEIGHT_MM * unitsPerMm
  const gap = PAGE_DETAILS_GAP_MM * unitsPerMm
  const innerWidth = Math.max(0, width - margin * 2)
  const detailsY = Math.max(margin, height - margin - detailsHeight)
  return {
    content: {
      x: originX + margin,
      y: originY + margin,
      width: innerWidth,
      height: Math.max(0, detailsY - gap - margin)
    },
    details: {
      x: originX + margin,
      y: originY + detailsY,
      width: innerWidth,
      height: detailsHeight
    }
  }
}
