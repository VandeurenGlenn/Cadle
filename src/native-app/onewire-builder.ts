import type { OneWirePresetConfig } from './constants.js'
import type { LineShape, Point, Shape, TextShape, SymbolShape } from '../native-draw/types.js'
import { inferSymbolScale } from '../native-draw/model.js'

export type BuildOneWireCircuitResult = {
  shapes: Shape[]
  primarySelection: string[]
}

const createLine = (id: string, start: Point, end: Point, bindingId: string, groupId: string): LineShape => ({
  id,
  kind: 'line',
  start,
  end,
  bindingId,
  groupId
})

const createText = (id: string, position: Point, text: string, bindingId: string, groupId: string): TextShape => ({
  id,
  kind: 'text',
  position,
  text,
  bindingId,
  groupId
})

const createSymbol = (
  id: string,
  position: Point,
  name: string,
  path: string,
  bindingId: string,
  groupId: string
): SymbolShape => ({
  id,
  kind: 'symbol',
  position,
  name,
  path,
  scale: inferSymbolScale(path),
  bindingId,
  groupId
})

const RESIDENTIAL_BREAKER_SYMBOL_PATH = 'symbols/Protection devices/Automaat.svg'
const RESIDENTIAL_SWITCH_SYMBOL_PATH = 'symbols/Switches/Switch general symbol.svg'

const loadSymbolPathForPreset = (preset: OneWirePresetConfig): string => {
  if (preset.label === 'Sockets') return 'symbols/Socket outlets/Electrical wall outlet.svg'
  if (preset.label === 'Motor') return 'symbols/Consumption appliances/Motor.svg'
  return 'symbols/Consumption appliances/Lighting.svg'
}

// Use existing residential symbol for breaker
const createBreakerSymbol = (
  nextId: () => string,
  center: Point,
  _boxW: number,
  _boxH: number,
  bindingId: string,
  groupId: string
): SymbolShape[] => [createSymbol(nextId(), center, 'Automaat', RESIDENTIAL_BREAKER_SYMBOL_PATH, bindingId, groupId)]

// Use existing residential symbol for switch
const createSwitchSymbol = (
  nextId: () => string,
  center: Point,
  _size: number,
  bindingId: string,
  groupId: string
): SymbolShape[] => [createSymbol(nextId(), center, 'Switch', RESIDENTIAL_SWITCH_SYMBOL_PATH, bindingId, groupId)]

// Use preset-specific residential symbol for load
const createLoadSymbol = (
  nextId: () => string,
  center: Point,
  _size: number,
  preset: OneWirePresetConfig,
  bindingId: string,
  groupId: string
): SymbolShape[] => [createSymbol(nextId(), center, 'Load', loadSymbolPathForPreset(preset), bindingId, groupId)]

// Vertical gap between components inside a circuit column.
const COMPONENT_GAP = 44

/**
 * Builds a single one-wire circuit column.
 * `point` is the BOTTOM connection point (the bus bar).
 * Components stack upward: breaker nearest the bus bar, then switch, load at top.
 * Reading bottom→top: Bus → Breaker → Switch → Load (IEC order).
 * `breakerWidth` is the VERTICAL height of the breaker box;
 * `nodeSize` is the width of the breaker box and size of switch/load.
 */
export const buildOneWireCircuit = (
  point: Point,
  bindingId: string,
  preset: OneWirePresetConfig,
  nextId: () => string,
  breakerWidth: number,
  nodeSize: number
): BuildOneWireCircuitResult => {
  const groupId = `onewire-${nextId()}`

  // Build upward from point (bus bar at bottom)
  const breakerBottom = point.y - COMPONENT_GAP
  const breakerCenterY = breakerBottom - breakerWidth / 2
  const breakerTop = breakerBottom - breakerWidth

  const switchBottom = breakerTop - COMPONENT_GAP
  const switchCenterY = switchBottom - nodeSize / 2
  const switchTop = switchBottom - nodeSize

  const loadBottom = switchTop - COMPONENT_GAP
  const loadCenterY = loadBottom - nodeSize / 2
  const loadTop = loadBottom - nodeSize

  const x = point.x
  const breakerCenter: Point = { x, y: breakerCenterY }
  const switchCenter: Point = { x, y: switchCenterY }
  const loadCenter: Point = { x, y: loadCenterY }

  // Labels sit to the right of each component
  const labelX = x + nodeSize / 2 + 8

  const breakerShapes = createBreakerSymbol(nextId, breakerCenter, nodeSize, breakerWidth, bindingId, groupId)
  const switchShapes = createSwitchSymbol(nextId, switchCenter, nodeSize, bindingId, groupId)
  const loadShapes = createLoadSymbol(nextId, loadCenter, nodeSize, preset, bindingId, groupId)

  const shapes: Shape[] = [
    // Binding-ID label above the load (topmost element)
    createText(nextId(), { x: x - 10, y: loadTop - 20 }, bindingId, bindingId, groupId),
    // Feed line: bus bar → breaker bottom
    { id: nextId(), kind: 'line', start: point, end: { x, y: breakerBottom }, bindingId, groupId } as LineShape,
    ...breakerShapes,
    // Line: breaker top → switch bottom
    {
      id: nextId(),
      kind: 'line',
      start: { x, y: breakerTop },
      end: { x, y: switchBottom },
      bindingId,
      groupId
    } as LineShape,
    ...switchShapes,
    // Line: switch top → load bottom
    {
      id: nextId(),
      kind: 'line',
      start: { x, y: switchTop },
      end: { x, y: loadBottom },
      bindingId,
      groupId
    } as LineShape,
    ...loadShapes,
    // Component labels (right side)
    createText(nextId(), { x: labelX, y: breakerCenterY + 4 }, preset.breaker, bindingId, groupId),
    createText(nextId(), { x: labelX, y: switchCenterY + 4 }, preset.switchLabel, bindingId, groupId),
    createText(nextId(), { x: labelX, y: loadCenterY + 4 }, preset.load, bindingId, groupId),
    // Wire section label in the gap between switch top and load bottom
    createText(nextId(), { x: x + 8, y: switchTop - COMPONENT_GAP / 2 - 2 }, preset.wireSection, bindingId, groupId)
  ]

  return {
    shapes,
    primarySelection: shapes.map((shape) => shape.id)
  }
}
