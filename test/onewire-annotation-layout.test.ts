import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKamrailCircuitBundle } from '../src/editor/layout/onewire-helpers.ts'
import { spaceOneWireCircuitAnnotations } from '../src/editor/layout/onewire-annotation-layout.ts'
import { applyOneWireCircuitPresentation } from '../src/editor/layout/onewire-circuit-presentation.ts'
import { oneWireLayoutBounds } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor, oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

const circuit = () => {
  let id = 0
  return buildKamrailCircuitBundle({
    rail: { id: 'rail', kind: 'line', start: { x: 100, y: 1100 }, end: { x: 1000, y: 1100 } },
    anchorX: 400,
    options: { amps: 16, family: 'C', autoIncludeFamily: true, cableType: 'VOB', cableSectionMm2: 1.5 },
    familyComponents: [1, 2].flatMap((number) => [
      { bindingId: `C${number}`, kind: 'switch' as const, sourcePath: 'symbols/Switches/Dimmer switch.svg' },
      { bindingId: `C${number}`, kind: 'load' as const, sourcePath: 'symbols/Consumption appliances/Spot.svg' }
    ]),
    minimumRowY: 100,
    nextShapeId: () => `shape-${++id}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!.shapes
}

const checkClearance = (shapes: Shape[]) => {
  const breaker = shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')!
  assert.ok(breaker.kind === 'symbol')
  const terminals = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!
  const axisX = breaker.position.x + terminals.bottom!.x
  const bodyLeft = axisX + (5.6536 - 15.3836) * 24 * breaker.scale / 28.8265
  const cable = shapes.find((shape) => shape.sourceLink?.role === 'cable-section')!
  const cableBox = oneWireLayoutBounds(cable)
  assert.ok(cableBox.x >= axisX + 12)
  for (const role of ['breaker-poles', 'breaker-current']) {
    const label = oneWireLayoutBounds(shapes.find((shape) => shape.sourceLink?.role === role)!)
    const gap = role === 'breaker-poles' ? bodyLeft - label.x - label.width : label.x - axisX
    assert.ok(Math.abs(gap - (role === 'breaker-poles' ? 8 : 10)) < 1e-8)
  }
  for (const row of shapes.filter((shape) => shape.sourceLink?.kind !== 'board')) {
    const box = oneWireLayoutBounds(row)
    assert.ok(box.y + box.height <= cableBox.y - 24 + 1e-8)
  }
  const trunk = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  assert.ok(trunk.kind === 'line')
  assert.equal(trunk.start.y, breaker.position.y + terminals.top!.y)
  const wires = shapes.filter((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'row-wire')
  assert.ok(wires.some((wire) => wire.kind === 'line' && wire.start.x === trunk.end.x && wire.start.y === trunk.end.y))
}

test('cable text has its own clear conductor section and protection values clear the breaker', () => {
  const shapes = circuit()
  checkClearance(shapes)
  assert.equal(spaceOneWireCircuitAnnotations(shapes, 'C').changed, false)
})

test('longer cable specifications extend the trunk while retaining row connections and identities', () => {
  const original = circuit()
  const snapshot = structuredClone(original)
  const updated = applyOneWireCircuitPresentation({ shapes: original, circuitKey: 'C', stored: {
    cableConductors: 12, cableSectionMm2: 240, cableType: 'XVB-Cca', poles: 4, breakerCurrentA: 63
  } })
  checkClearance(updated.shapes)
  assert.deepEqual(original, snapshot)
  assert.deepEqual(updated.shapes.map(({ id }) => id), original.map(({ id }) => id))
  assert.equal(spaceOneWireCircuitAnnotations(updated.shapes, 'C').changed, false)
  const oldTrunk = original.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  const newTrunk = updated.shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  assert.ok(oldTrunk.kind === 'line' && newTrunk.kind === 'line' && newTrunk.end.y < oldTrunk.end.y)
})
