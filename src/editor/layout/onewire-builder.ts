import { ONE_WIRE_SOCKET_SYMBOL_PATH, type OneWirePresetConfig } from '../constants.js'
import type { LineShape, Point, Shape, TextShape, SymbolShape } from '../model/types.js'
import { oneWireSymbolBounds, oneWireSymbolScaleFor, oneWireSymbolStrokeWidthFor } from './onewire-symbol-nodes.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from './onewire-connections.js'
import { circuitDefaults } from '../circuit-defaults.js'
import { electricalMetadataFromCatalog, phaseConfigurationLabel } from '../model/electrical.js'
import { oneWireCableLabelText } from './onewire-helpers.js'
import { PROTECTION_TEXT_SIZE, PROTECTION_TEXT_WEIGHT } from './protection-label-layout.js'

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
  const circuitType = preset.label === 'Sockets' ? 'sockets' : preset.label === 'Motor' ? 'motor' : 'lighting'
  const defaults = circuitDefaults(circuitType)
  const amps = Number.parseFloat(preset.breaker) || defaults.breakerCurrentA
  const sectionMm2 = Number.parseFloat(preset.wireSection) || defaults.cableSectionMm2
  const cableDesignation = oneWireCableLabelText({
    conductors: defaults.cableConductors, sectionMm2, hasProtectiveConductor: defaults.hasProtectiveConductor,
    cableType: defaults.cableType
  })
  const cableSpan = oneWireLayoutBounds({ id: '', kind: 'text', position: { x: 0, y: 0 },
    text: cableDesignation, scale: PROTECTION_TEXT_SIZE / 18 }).width
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
    const electrical = index === 0 ? electricalMetadataFromCatalog({
      ...defaults, circuitType, breakerCurrentA: amps, cableSectionMm2: sectionMm2
    }, component.name, component.path) : undefined
    const placed = positionOneWireSymbolForConnection({
      id: nextId(), kind: 'symbol', position: { x: 0, y: 0 }, ...component,
      scale, bindingId, groupId,
      strokeWidth: oneWireSymbolStrokeWidthFor(component.path, scale),
      ...(electrical ? { electrical, symbolTextOverrides: {
        poles: `${electrical.poles}P`,
        phase: phaseConfigurationLabel(defaults.phaseConfiguration, electrical.neutralPosition),
        'rated-current': `${defaults.breakerCurve}${amps}A`
      } } : {})
    }, from, 'top', host, index === 1 ? cableSpan + 48 : 24)
    const wire: LineShape = {
      id: nextId(), kind: 'line', start: { ...from }, end: placed.connection,
      stroke: '#000000', strokeWidth: 2, bindingId, groupId,
      connection: index === 1 ? { kind: 'cable', conductors: defaults.cableConductors,
        sectionMm2, cableType: defaults.cableType, hasProtectiveConductor: true, showLabel: true, labelOwner: 'circuit' }
        : { kind: 'wire', showLabel: false }
    }
    if (index === 1) wire.sourceLink = { kind: 'circuit', id: bindingId, role: 'connection-cable' }
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
    id: nextId(), kind: 'text', position, text: value, scale: PROTECTION_TEXT_SIZE / 18,
    fontWeight: PROTECTION_TEXT_WEIGHT, fill: '#000000', stroke: 'none', bindingId, groupId
  })
  shapes.push(text({ x: point.x - 32, y: point.y + 6 }, bindingId))
  for (const [index, label] of [preset.switchLabel, preset.load].entries()) {
    const symbol = symbols[index + 1]
    const contacts = oneWireSymbolConnectionAnchors(symbol)
    const centerY = (Math.min(...contacts.map(({ point }) => point.y)) + Math.max(...contacts.map(({ point }) => point.y))) / 2
    shapes.push(text({ x: labelX, y: centerY + 6 }, label))
  }
  const trunk = shapes[2] as LineShape
  shapes.push({ ...text({ x: trunk.start.x + 36, y: trunk.start.y - 24 }, cableDesignation), rotation: -90,
    sourceLink: { kind: 'circuit', id: bindingId, role: 'cable-section' } })
  return { shapes, primarySelection: shapes.map((shape) => shape.id) }
}
