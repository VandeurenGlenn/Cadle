import assert from 'node:assert/strict'
import test from 'node:test'
import type { SymbolShape } from '../src/editor/model/types.js'
import { oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection } from '../src/editor/layout/onewire-connections.js'
import { oneWireSymbolBounds, oneWireSymbolNodeInfo, oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.js'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.js'
import { ONE_WIRE_PRESETS } from '../src/editor/constants.js'

const symbol = (path: string, overrides: Partial<SymbolShape> = {}): SymbolShape => ({
  id: 'symbol',
  kind: 'symbol',
  name: 'Symbol',
  path,
  scale: 1,
  position: { x: 100, y: 200 },
  ...overrides
})

test('uses only the real conductor terminals as anchors', () => {
  const shape = symbol('symbols/Photovoltaic devices (≠AREI)/Solar panel.svg')
  const terminal = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
  assert.ok(terminal)

  assert.deepEqual(oneWireSymbolConnectionAnchors(shape), [
    {
      side: 'bottom',
      point: { x: shape.position.x + terminal.x, y: shape.position.y + terminal.y }
    }
  ])
})

test('rotates and flips conductor terminal anchors with the symbol', () => {
  const shape = symbol('symbols/Protection devices/Automaat.svg', {
    rotation: 90,
    flipX: true
  })
  const terminals = oneWireSymbolTerminalInfo(shape.path, shape.scale)
  assert.ok(terminals?.top && terminals.bottom)

  const anchors = oneWireSymbolConnectionAnchors(shape)
  assert.deepEqual(anchors.map(({ side }) => side), ['right', 'left'])
  assert.notDeepEqual(anchors[0].point, anchors[1].point)
})

test('placed devices connect exactly in every direction and at different scales', () => {
  for (const path of [
    'symbols/Protection devices/Automaat.svg',
    'symbols/Photovoltaic devices (≠AREI)/Solar panel.svg',
    'symbols/Switches/Switch general symbol.svg',
    'symbols/Socket outlets/Wall outlet with grounding.svg'
  ]) {
    for (const scale of [0.5, 1, 2.5]) {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const from = { x: 101.25, y: 203.75 }
        const placed = positionOneWireSymbolForConnection(symbol(path, { scale, rotation: 90, flipX: true }), from, side)
        const contacts = oneWireSymbolConnectionAnchors(placed.symbol)
        assert.ok(contacts.some(({ point }) => Math.hypot(point.x - placed.connection.x, point.y - placed.connection.y) < 1e-8), `${path}: ${side}`)
        assert.ok(Math.abs(from.x - placed.connection.x) < 1e-8 || Math.abs(from.y - placed.connection.y) < 1e-8)
        assert.ok(Math.abs(Math.hypot(from.x - placed.connection.x, from.y - placed.connection.y) - 24) < 1e-8)
      }
    }
  }
})

test('manual presets form continuous columns from the bus through every component', () => {
  for (const preset of Object.values(ONE_WIRE_PRESETS)) {
    let id = 0
    const start = { x: 403.25, y: 706.75 }
    const result = buildOneWireCircuit(start, 'A1', preset, () => `shape-${++id}`, 80, 24)
    const wires = result.shapes.filter((shape) => shape.kind === 'line')
    const symbols = result.shapes.filter((shape) => shape.kind === 'symbol')
    assert.equal(wires.length, 3)
    assert.equal(symbols.length, 3)
    assert.deepEqual(wires[0].start, start)
    for (const [index, wire] of wires.entries()) {
      assert.ok(Math.abs(wire.start.x - start.x) < 1e-8)
      assert.ok(Math.abs(wire.end.x - start.x) < 1e-8)
      const target = oneWireSymbolConnectionAnchors(symbols[index])
      assert.ok(target.some(({ point }) => Math.hypot(wire.end.x - point.x, wire.end.y - point.y) < 1e-8))
      if (index === 0) continue
      const source = oneWireSymbolConnectionAnchors(symbols[index - 1])
      assert.ok(source.some(({ point }) => Math.hypot(wire.start.x - point.x, wire.start.y - point.y) < 1e-8))
      const previousBounds = oneWireSymbolBounds(symbols[index - 1])!
      const targetBounds = oneWireSymbolBounds(symbols[index])!
      assert.ok(targetBounds.y + targetBounds.height <= previousBounds.y - 8 + 1e-8)
    }
  }
})

test('floor-plan outlet leads use the actual SVG origin and viewBox', () => {
  const path = 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg'
  for (const scale of [0.5, 1, 3]) {
    const node = oneWireSymbolNodeInfo(path, scale)!
    const factor = 24 * scale / 11.5786
    assert.ok(Math.abs(node.offset.x - (0.12 - 8.50772 / 2) * factor) < 1e-8)
    assert.ok(Math.abs(node.offset.y - (5.78 - 11.5786 / 2) * factor) < 1e-8)
  }
})
