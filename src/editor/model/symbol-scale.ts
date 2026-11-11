const PUSH_BUTTON_PATH = /switches\/(?:(?:illuminated |double )?push button|push switch with safety cover)\.svg$/i
const FLOOR_PLAN_SPOT_PATH = /\/consumption appliances\/(?:recessed )?spot(?:light)?\.svg$/i
const FLOOR_PLAN_SOCKET_PATH = /\/socket outlets\//i

export const floorPlanSpotPaperScale = (path: string): number | null =>
  FLOOR_PLAN_SPOT_PATH.test(path) ? 1.15 : null

export const floorPlanSocketPaperScale = (path: string): number | null =>
  FLOOR_PLAN_SOCKET_PATH.test(path) ? 1.05 : null

/** Paper sizes for appliances that previously had oversized floor-plan defaults. */
export const appliancePaperScale = (path: string): number | null => {
  // Their view boxes match appliances such as the dishwasher, so use the same scale.
  if (/\/consumption appliances\/refrigerator\.svg$/i.test(path)) return 1.15
  if (/\/consumption appliances\/kwh meter\.svg$/i.test(path)) return 1.15
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
  return base === null ? null : base * 1.05
}

/** Correct previous floor-plan defaults once, keeping other saved sizes intact. */
export const revisedGroundPlanDefaultScale = (path: string, scale: number): number | null => {
  const previous = /\/consumption appliances\/refrigerator\.svg$/i.test(path) ? [3, 2]
    : /\/consumption appliances\/kwh meter\.svg$/i.test(path) ? [8 / 3, 2] : null
  if (previous !== null) return previous.some((value) => Math.abs(scale - value) < 1e-9) ? appliancePaperScale(path) : null
  const spot = floorPlanSpotPaperScale(path)
  if (spot !== null) return Math.abs(scale - 1.5 * 1.15) < 1e-9 ? spot : null
  const socket = floorPlanSocketPaperScale(path)
  if (socket !== null) return Math.abs(scale - 1.5 * 1.15) < 1e-9 ? socket : null
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
