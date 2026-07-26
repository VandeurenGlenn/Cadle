import assert from 'node:assert/strict'
import test from 'node:test'
import { ONE_WIRE_PRESETS } from '../src/editor/constants.ts'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.ts'
import { buildOneWireBreakerSection } from '../src/editor/layout/onewire-helpers.ts'

const idSequence = () => {
  let value = 0
  return () => `shape-${++value}`
}

test('builds a complete lighting circuit upward from its bus connection', () => {
  const result = buildOneWireCircuit(
    { x: 400, y: 700 },
    'A1',
    ONE_WIRE_PRESETS.lighting,
    idSequence(),
    80,
    24
  )

  assert.equal(result.shapes.length, 11)
  assert.equal(result.primarySelection.length, result.shapes.length)
  assert.ok(result.shapes.some((shape) => shape.kind === 'symbol' && shape.name === 'Automaat'))
  assert.ok(
    result.shapes.some(
      (shape) => shape.kind === 'line' && shape.start.x === 400 && shape.start.y === 700 && shape.bindingId === 'A1'
    )
  )
  assert.ok(result.shapes.every((shape) => shape.bindingId === 'A1'))
})

test('attaches a composed breaker to a selected one-wire bus', () => {
  const result = buildOneWireBreakerSection(700, 400, 'A1', 'A', {
    nextShapeId: idSequence(),
    oneWireComponentSymbol: () => ({
      name: 'Automaat',
      path: 'symbols/Protection devices/Automaat.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000',
    kamrailAttachOffset: 20
  })

  assert.deepEqual(
    result.shapes.map((shape) => shape.kind),
    ['line', 'symbol', 'text', 'text']
  )
  assert.ok(result.shapes.every((shape) => shape.bindingId === 'A1'))
  assert.equal(new Set(result.shapes.map((shape) => shape.groupId)).size, 1)
  const breaker = result.shapes.find((shape) => shape.kind === 'symbol')
  assert.deepEqual(breaker?.kind === 'symbol' ? breaker.symbolTextOverrides : null, {
    'desc:nP': '2P', 'desc:n': '1N', 'desc:20A': 'C20A'
  })

  const connector = result.shapes[0]
  assert.equal(connector.kind, 'line')
  if (connector.kind === 'line') {
    assert.deepEqual(connector.start, { x: 400, y: 680 })
    assert.deepEqual(connector.end, { x: 400, y: 700 })
  }
})
