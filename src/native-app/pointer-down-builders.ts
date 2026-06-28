import { inferSymbolScale } from '../native-draw/model.js'
import type { DraftShape, NativeCatalogPick, Point, SymbolShape, TextShape, Tool } from '../native-draw/types.js'

export const createTextShape = (id: string, position: Point, text: string): TextShape => ({
  id,
  kind: 'text',
  position,
  text
})

export const createSymbolShape = (id: string, point: Point, symbol: NativeCatalogPick): SymbolShape => {
  const shape: SymbolShape = {
    id,
    kind: 'symbol',
    position: point,
    name: symbol.name,
    path: symbol.path,
    scale: inferSymbolScale(symbol.path)
  }
  const metaBinding = symbol.metadata?.bindingId
  if (typeof metaBinding === 'string' && metaBinding.trim()) shape.bindingId = metaBinding.trim().toUpperCase()
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
