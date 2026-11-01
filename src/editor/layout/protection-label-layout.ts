import type { SymbolShape } from '../model/types.js'
import { oneWireProtectionBodyEdges, oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

export const PROTECTION_TEXT_SIZE = 2.5 * PAPER_WORLD_UNITS_PER_MM
export const PROTECTION_TEXT_WEIGHT = 400
export const PROTECTION_FONT_FAMILY = "'IBM Plex Sans','Segoe UI',sans-serif"

// Descriptions and technical values share the same columns beside a device.
export const protectionLabelLayout = (shape: SymbolShape) => {
  const terminals = oneWireSymbolTerminalInfo(shape.path, shape.scale)
  const bounds = oneWireSymbolBounds({ ...shape, rotation: 0 })
  if (!bounds || !terminals?.top || !terminals.bottom) return null
  const axisX = shape.position.x + terminals.bottom.x
  // The source SVG reserves a wide area for its old embedded labels. Place
  // external values beside the actual switching body, excluding that whitespace.
  const body = oneWireProtectionBodyEdges(shape) ?? { leftX: bounds.x, rightX: bounds.x + bounds.width }
  return {
    axisX,
    centerY: shape.position.y + (terminals.top.y + terminals.bottom.y) / 2,
    bottomY: shape.position.y + terminals.bottom.y,
    rightX: body.rightX + 10,
    leftX: body.leftX - 8
  }
}

export const protectionDescriptionLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  return { x: layout.rightX, y: layout.centerY + (residual ? 40 : 29) }
}

export const protectionPhaseLabelLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  const description = shape.symbolTextOverrides?.description ? protectionDescriptionLayout(shape) : null
  return {
    x: layout.rightX,
    y: Math.max(layout.centerY + (residual ? 40 : 33), description ? description.y + 28 : 0)
  }
}

export const protectionAnnotationLayout = (shape: SymbolShape) => {
  const layout = protectionLabelLayout(shape)
  if (!layout) return null
  const residual = /residual-current circuit breaker\.svg$/i.test(shape.path)
  return {
    poles: { x: layout.leftX, y: layout.centerY + 5 },
    current: { x: layout.rightX, y: layout.centerY + (residual ? 12 : 5) },
    residual: { x: layout.rightX, y: layout.centerY - 12 },
    type: { x: layout.rightX, y: layout.centerY + 12 },
    phase: protectionPhaseLabelLayout(shape)!,
    description: protectionDescriptionLayout(shape)!
  }
}
