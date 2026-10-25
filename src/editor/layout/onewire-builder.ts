import { ONE_WIRE_SOCKET_SYMBOL_PATH, type OneWirePresetConfig } from '../constants.js'
import type { LineShape, Point, Shape, TextShape, SymbolShape } from '../model/types.js'
import { oneWireSymbolBounds, oneWireSymbolScaleFor, oneWireSymbolStrokeWidthFor } from './onewire-symbol-nodes.js'
import { oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from './onewire-connections.js'
import { paperTextScale } from './page-layout.js'

export type BuildOneWireCircuitResult = {
  shapes: Shape[]
  primarySelection: string[]
}

/** Build upward from the bus using the rendered symbols' actual contact points. */
export const buildOneWireCircuit = (
  point: Point,
  bindingId: string,
  preset: OneWirePresetConfig,
  nextId: () => string,
  _breakerWidth: number,
  _nodeSize: number
): BuildOneWireCircuitResult => {
  const groupId = `onewire-${nextId()}`
  const loadPath = preset.label === 'Sockets' ? ONE_WIRE_SOCKET_SYMBOL_PATH
    : preset.label === 'Motor' ? 'symbols/Consumption appliances/Motor.svg'
    : 'symbols/Consumption appliances/Lighting.svg'
  const components = [
    { name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' },
    { name: 'Switch', path: 'symbols/Switches/Switch general symbol.svg' },
    { name: 'Load', path: loadPath, rotation: preset.label === 'Sockets' ? -90 : undefined }
  ]
  const shapes: Shape[] = []
  const symbols: SymbolShape[] = []
  let from = point
  let host: SymbolShape | undefined
  for (const [index, component] of components.entries()) {
    const scale = oneWireSymbolScaleFor(component.path)!
    const placed = positionOneWireSymbolForConnection({
      id: nextId(), kind: 'symbol', position: { x: 0, y: 0 }, ...component,
      scale, bindingId, groupId,
      strokeWidth: oneWireSymbolStrokeWidthFor(component.path, scale),
      ...(index === 0 ? { symbolTextOverrides: { poles: '', phase: '', 'rated-current': '' } } : {})
    }, from, 'top', host)
    const wire: LineShape = {
      id: nextId(), kind: 'line', start: { ...from }, end: placed.connection,
      stroke: '#000000', strokeWidth: 2, bindingId, groupId
    }
    shapes.push(wire, placed.symbol)
    symbols.push(placed.symbol)
    host = placed.symbol
    from = oneWireSymbolConnectionAnchors(host).find((anchor) => anchor.side === 'top')!.point
  }
  const labelX = Math.max(...symbols.map((symbol) => {
    const bounds = oneWireSymbolBounds(symbol)!
    return bounds.x + bounds.width
  })) + 12
  const text = (position: Point, value: string): TextShape => ({
    id: nextId(), kind: 'text', position, text: value, scale: paperTextScale(2.5),
    fontWeight: 400, fill: '#000000', stroke: 'none', bindingId, groupId
  })
  shapes.push(text({ x: point.x - 32, y: point.y + 6 }, bindingId))
  for (const [index, label] of [preset.breaker, preset.switchLabel, preset.load].entries()) {
    const symbol = symbols[index]
    const contacts = oneWireSymbolConnectionAnchors(symbol)
    const centerY = (Math.min(...contacts.map(({ point }) => point.y)) + Math.max(...contacts.map(({ point }) => point.y))) / 2
    shapes.push(text({ x: labelX, y: centerY + 6 }, label))
  }
  const loadWire = shapes[4] as LineShape
  shapes.push(text({ x: labelX, y: (loadWire.start.y + loadWire.end.y) / 2 + 6 }, preset.wireSection))
  return { shapes, primarySelection: shapes.map((shape) => shape.id) }
}
