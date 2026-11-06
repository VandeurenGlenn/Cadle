import { inferSymbolScale } from '../../editor/model/model.js'
import type { DraftShape, NativeCatalogPick, Point, SymbolShape, TextShape, Tool } from '../../editor/model/types.js'
import { electricalMetadataFromCatalog } from '../../editor/model/electrical.js'
import { paperTextScale } from '../layout/page-layout.js'
import { DEFAULT_DRAW_STROKE, DEFAULT_DRAW_STROKE_WIDTH } from '../constants.js'
import { oneWireSymbolScaleFor } from '../layout/onewire-symbol-nodes.js'
import { appliancePaperScale, floorPlanSwitchPaperScale } from '../model/symbol-scale.js'
export { DEFAULT_DRAW_STROKE_WIDTH } from '../constants.js'

type SymbolStyleDefaults = {
  scale?: unknown
  rotation?: unknown
  fill?: unknown
  stroke?: unknown
  strokeWidth?: unknown
  flipX?: unknown
  flipY?: unknown
}

const WALL_LIGHT_SCALE = 1.5
const FLUORESCENT_LAMP_SCALE = 2
const DISTRIBUTION_BOARD_SCALE = 2
const BATTERY_BANK_SCALE = 2
const INVERTER_SCALE = 1.4
const FLOOR_PLAN_ELECTRICAL_FACTOR = 1.5
const FLOOR_PLAN_SYMBOL_FACTOR = 1.15
export type SymbolPlacementContext = 'groundplan' | 'onewire'

const isLightingPath = (path: string): boolean =>
  /\/consumption appliances\/(?:lighting(?: luminaire with built-in switch)?|(?:independent )?emergency lighting(?: connected to a dedicated circuit)?|wall light|fluorescent lamp|(?:recessed )?spot(?:light)?|projector(?: with (?:little )?divergent beam)?)\.svg$/i.test(path)

const isBatteryBankPath = (path: string): boolean => /\/photovoltaic devices[^/]*\/battery bank\.svg$/i.test(path)
const isInverterPath = (path: string): boolean => /\/photovoltaic devices[^/]*\/inverter\.svg$/i.test(path)
const isDistributionBoardPath = (path: string): boolean => /\/electrical devices\/distribution board\.svg$/i.test(path)

const resolveSymbolStyleDefaults = (symbol: NativeCatalogPick): SymbolStyleDefaults => {
  const metadata = symbol.metadata
  if (!metadata || typeof metadata !== 'object') return {}
  const defaults = (metadata as Record<string, unknown>).symbolDefaults
  if (!defaults || typeof defaults !== 'object') return {}
  return defaults as SymbolStyleDefaults
}

export const resolveCatalogSymbolScale = (symbol: NativeCatalogPick, context: SymbolPlacementContext = 'groundplan'): number => {
  const defaults = resolveSymbolStyleDefaults(symbol)
  if (typeof defaults.scale === 'number' && Number.isFinite(defaults.scale)) {
    return Math.max(0.1, Math.min(20, defaults.scale))
  }
  if (context === 'onewire') return oneWireSymbolScaleFor(symbol.path) ?? inferSymbolScale(symbol.path)
  const applianceScale = appliancePaperScale(symbol.path)
  if (applianceScale !== null) return applianceScale
  const switchScale = floorPlanSwitchPaperScale(symbol.path)
  if (switchScale !== null) return switchScale
  if (/\/socket outlets\//i.test(symbol.path)) return inferSymbolScale(symbol.path) * FLOOR_PLAN_ELECTRICAL_FACTOR * FLOOR_PLAN_SYMBOL_FACTOR
  if (isLightingPath(symbol.path)) {
    const base = /\/wall light\.svg$/i.test(symbol.path) ? WALL_LIGHT_SCALE
      : /\/fluorescent lamp\.svg$/i.test(symbol.path) ? FLUORESCENT_LAMP_SCALE : inferSymbolScale(symbol.path)
    return base * FLOOR_PLAN_ELECTRICAL_FACTOR * FLOOR_PLAN_SYMBOL_FACTOR
  }
  if (isDistributionBoardPath(symbol.path)) return DISTRIBUTION_BOARD_SCALE * FLOOR_PLAN_SYMBOL_FACTOR
  if (isBatteryBankPath(symbol.path)) return BATTERY_BANK_SCALE * FLOOR_PLAN_SYMBOL_FACTOR
  if (isInverterPath(symbol.path)) return INVERTER_SCALE * FLOOR_PLAN_SYMBOL_FACTOR
  return inferSymbolScale(symbol.path) * FLOOR_PLAN_SYMBOL_FACTOR
}

export const createTextShape = (id: string, position: Point, text: string): TextShape => ({
  id,
  kind: 'text',
  position,
  text,
  scale: paperTextScale(3),
  fill: '#000000'
})

export const createSymbolShape = (id: string, point: Point, symbol: NativeCatalogPick, context: SymbolPlacementContext = 'groundplan'): SymbolShape => {
  const defaults = resolveSymbolStyleDefaults(symbol)
  const shape: SymbolShape = {
    id,
    kind: 'symbol',
    position: point,
    name: symbol.name,
    path: symbol.path,
    scale: resolveCatalogSymbolScale(symbol, context),
    electrical: electricalMetadataFromCatalog(symbol.metadata, symbol.name, symbol.path)
  }
  if (typeof defaults.rotation === 'number' && Number.isFinite(defaults.rotation)) {
    shape.rotation = ((defaults.rotation % 360) + 360) % 360
  }
  if (typeof defaults.fill === 'string' && defaults.fill.trim()) shape.fill = defaults.fill
  if (typeof defaults.stroke === 'string' && defaults.stroke.trim()) shape.stroke = defaults.stroke
  if (typeof defaults.strokeWidth === 'number' && Number.isFinite(defaults.strokeWidth)) {
    shape.strokeWidth = Math.max(0.5, Math.min(40, defaults.strokeWidth))
  }
  if (Array.isArray(symbol.shapes) && symbol.shapes.length > 0) {
    shape.catalogShapes = symbol.shapes
  }
  return shape
}

export const createDraftShape = (
  id: string,
  point: Point,
  tool: Tool,
  rectVariant: 'rect' | 'circle' | 'arc' = 'rect'
): DraftShape =>
  tool === 'rect' || tool === 'room' || tool === 'circle' || tool === 'arc' || tool === 'heating-zone'
    ? {
        id,
        kind: 'rect',
        start: point,
        end: point,
        variant: tool === 'circle' ? 'circle' : tool === 'arc' ? 'arc' : rectVariant,
        ...(tool === 'room' ? {} : { strokeWidth: DEFAULT_DRAW_STROKE_WIDTH })
      }
    : {
        id,
        kind: tool === 'door' ? 'door' : tool === 'window' ? 'window' : tool === 'gate' ? 'gate' : 'line',
        start: point,
        end: point,
        ...(tool === 'line' ? { stroke: DEFAULT_DRAW_STROKE, strokeWidth: DEFAULT_DRAW_STROKE_WIDTH } : {})
      }
