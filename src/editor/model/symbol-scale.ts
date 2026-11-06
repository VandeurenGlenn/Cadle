import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

const PUSH_BUTTON_PATH = /switches\/(?:(?:illuminated |double )?push button|push switch with safety cover)\.svg$/i

/** Paper sizes for compact appliances, independent of the architectural plan scale. */
export const appliancePaperScale = (path: string): number | null => {
  // The refrigerator source includes whitespace; a 6 mm box gives a 4.8 mm cabinet.
  if (/\/consumption appliances\/refrigerator\.svg$/i.test(path)) return 6 * PAPER_WORLD_UNITS_PER_MM / 24
  if (/\/consumption appliances\/kwh meter\.svg$/i.test(path)) return 6 * PAPER_WORLD_UNITS_PER_MM / 24
  return null
}

const floorPlanSwitchBaseScale = (path: string): number | null => {
  if (!/\/switches\//i.test(path)) return null
  if (/double push button\.svg$/i.test(path)) return 1.25
  if (/push button\.svg$/i.test(path)) return .8
  if (/dual switch, single casing\.svg$/i.test(path)) return 1.15
  if (/(?:change over|intermediate switch).*\.svg$/i.test(path)) return 1.7
  return /(?:timer|time switch|thermostat|impulse relay|electric lock|guard tour control device)\.svg$/i.test(path) ? 1 : 1.3
}

export const floorPlanSwitchPaperScale = (path: string): number | null => {
  const base = floorPlanSwitchBaseScale(path)
  return base === null ? null : base * 1.15
}

/** Correct previous floor-plan defaults once, keeping other saved sizes intact. */
export const revisedGroundPlanDefaultScale = (path: string, scale: number): number | null => {
  const previous = /\/consumption appliances\/refrigerator\.svg$/i.test(path) ? 3
    : /\/consumption appliances\/kwh meter\.svg$/i.test(path) ? 8 / 3 : null
  if (previous !== null) return Math.abs(scale - previous) < 1e-9 ? appliancePaperScale(path) : null
  const base = floorPlanSwitchBaseScale(path)
  return base !== null && Math.abs(scale - base * 1.5 * 1.15) < 1e-9 ? floorPlanSwitchPaperScale(path) : null
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
