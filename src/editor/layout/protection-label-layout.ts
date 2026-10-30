import type { SymbolShape } from '../model/types.js'
import { oneWireProtectionBodyEdges, oneWireSymbolBounds, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'

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
