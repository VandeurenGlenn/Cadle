import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

const PUSH_BUTTON_PATH = /switches\/(?:(?:illuminated |double )?push button|push switch with safety cover)\.svg$/i

/** Paper sizes for compact appliances, independent of the architectural plan scale. */
export const appliancePaperScale = (path: string): number | null => {
  // The refrigerator's source box includes whitespace: 9 mm gives a 7.2 mm cabinet.
  if (/\/consumption appliances\/refrigerator\.svg$/i.test(path)) return 9 * PAPER_WORLD_UNITS_PER_MM / 24
  if (/\/consumption appliances\/kwh meter\.svg$/i.test(path)) return 8 * PAPER_WORLD_UNITS_PER_MM / 24
  return null
}

export const renderedSymbolScale = (path: string, scale: number): number =>
  Math.max(PUSH_BUTTON_PATH.test(path) ? 0.2 : 0.4, scale)

/** Keep a symbol's visible pen width unchanged when its geometry is resized. */
export const resizedSymbolStrokeWidth = (
  shape: { path: string; scale: number; strokeWidth?: number },
  nextScale: number
): number | undefined => typeof shape.strokeWidth === 'number'
  ? shape.strokeWidth * renderedSymbolScale(shape.path, shape.scale) / renderedSymbolScale(shape.path, nextScale)
  : undefined
