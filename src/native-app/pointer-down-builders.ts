import { inferSymbolScale } from '../native-draw/model.js'
import type { DraftShape, NativeCatalogPick, Point, SymbolShape, TextShape, Tool } from '../native-draw/types.js'
import { electricalMetadataFromCatalog } from '../native-draw/electrical.js'

type SymbolStyleDefaults = {
  scale?: unknown
  rotation?: unknown
  fill?: unknown
  stroke?: unknown
  strokeWidth?: unknown
  flipX?: unknown
  flipY?: unknown
}

const resolveSymbolStyleDefaults = (symbol: NativeCatalogPick): SymbolStyleDefaults => {
  const metadata = symbol.metadata
  if (!metadata || typeof metadata !== 'object') return {}
  const defaults = (metadata as Record<string, unknown>).symbolDefaults
  if (!defaults || typeof defaults !== 'object') return {}
  return defaults as SymbolStyleDefaults
}

export const createTextShape = (id: string, position: Point, text: string): TextShape => ({
  id,
  kind: 'text',
  position,
  text
})

export const createSymbolShape = (id: string, point: Point, symbol: NativeCatalogPick): SymbolShape => {
  const defaults = resolveSymbolStyleDefaults(symbol)
  const defaultScale =
    typeof defaults.scale === 'number' && Number.isFinite(defaults.scale)
      ? Math.max(0.1, Math.min(20, defaults.scale))
      : undefined
  const shape: SymbolShape = {
    id,
    kind: 'symbol',
    position: point,
    name: symbol.name,
    path: symbol.path,
    scale: defaultScale ?? inferSymbolScale(symbol.path),
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
  tool === 'rect' || tool === 'circle' || tool === 'arc'
    ? {
        id,
        kind: 'rect',
        start: point,
        end: point,
        variant: tool === 'circle' ? 'circle' : tool === 'arc' ? 'arc' : rectVariant
      }
    : {
        id,
        kind: tool === 'door' ? 'door' : tool === 'window' ? 'window' : tool === 'gate' ? 'gate' : 'line',
        start: point,
        end: point
      }
