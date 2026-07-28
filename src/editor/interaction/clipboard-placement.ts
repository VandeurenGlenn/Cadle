import { oneWireSymbolNodeInfo } from '../layout/onewire-symbol-nodes.js'
import type { Point, Shape } from '../model/types.js'

const isGridAnchoredProtectionSymbol = (shape: Extract<Shape, { kind: 'symbol' }>): boolean =>
  /protection devices|automaat|breaker|differential|differentieel|\brcd\b/i.test(`${shape.name} ${shape.path}`)

export const snapPasteTranslation = (
  shapes: Shape[],
  translation: Point,
  fallbackOrigin: Point,
  gridSize: number
): Point => {
  const electricalSymbol = shapes.find((shape) => {
    if (shape.kind !== 'symbol') return false
    return isGridAnchoredProtectionSymbol(shape) && oneWireSymbolNodeInfo(shape.path, shape.scale) !== null
  })
  const node = electricalSymbol?.kind === 'symbol'
    ? oneWireSymbolNodeInfo(electricalSymbol.path, electricalSymbol.scale)
    : null
  const origin = electricalSymbol?.kind === 'symbol' && node
    ? {
        x: electricalSymbol.position.x + node.offset.x,
        y: electricalSymbol.position.y + node.offset.y
      }
    : fallbackOrigin
  const translated = {
    x: origin.x + translation.x,
    y: origin.y + translation.y
  }

  return {
    x: translation.x + Math.round(translated.x / gridSize) * gridSize - translated.x,
    y: translation.y + Math.round(translated.y / gridSize) * gridSize - translated.y
  }
}
