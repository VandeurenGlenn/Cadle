import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKamrailCircuitBundle, buildOneWireRowSection } from '../src/editor/layout/onewire-helpers.ts'
import { placeOneWireCountLabels, spaceOneWireCircuitAnnotations } from '../src/editor/layout/onewire-annotation-layout.ts'
import { applyOneWireCircuitPresentation } from '../src/editor/layout/onewire-circuit-presentation.ts'
import { oneWireLayoutBounds } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor, oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape, TextShape } from '../src/editor/model/types.ts'

test('places counts above their own horizontal or stacked symbols, clear of devices and wires', () => {
  for (const compact of [false, true]) {
    let id = 0
    const section = buildOneWireRowSection(0, ['N1', [
      { bindingId: 'N1', kind: 'switch', sourcePath: 'symbols/Switches/Switch general symbol.svg' },
      ...[1, 2].map(() => ({ bindingId: 'N1', kind: 'load' as const,
        sourcePath: 'symbols/Consumption appliances/Lighting.svg' })),
      ...Array.from({ length: 11 }, () => ({ bindingId: 'N1', kind: 'load' as const,
        sourcePath: 'symbols/Consumption appliances/Spot.svg' }))
    ]], 1100, 400, {
      nextShapeId: () => `count-${++id}`,
      oneWireComponentSymbol: () => ({ name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
      symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
      branchStroke: '#000000'
    }, compact)
    const symbols = section.shapes.filter((shape) => shape.kind === 'symbol')
    const counts = section.shapes.filter((shape): shape is TextShape =>
      shape.kind === 'text' && shape.sourceLink?.role === 'count-label')
    assert.deepEqual(counts.map((shape) => shape.text), ['x2', 'x11'])
    for (const count of counts) {
      const index = Number(/:count:(\d+)$/.exec(count.generationKey!)![1])
      const box = oneWireLayoutBounds(count)
      const body = oneWireLayoutBounds(symbols[index])
      assert.ok(box.y + box.height <= body.y - 6 + 1e-8)
      assert.equal(count.textAnchor, 'middle')
      assert.equal(count.rotation, 0)
      if (!compact) assert.ok(Math.abs(count.position.x - body.x - body.width / 2) < 1e-8)
      for (const other of symbols.map(oneWireLayoutBounds)) {
        assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x ||
          box.y + box.height <= other.y || other.y + other.height <= box.y)
      }
      for (const wire of section.shapes) {
        if (wire.kind !== 'line' || wire.start.x !== wire.end.x) continue
        assert.ok(wire.start.x < box.x || wire.start.x > box.x + box.width ||
          Math.max(wire.start.y, wire.end.y) < box.y || Math.min(wire.start.y, wire.end.y) > box.y + box.height)
      }
    }
    const legacy = section.shapes.map((shape) => shape.sourceLink?.role === 'count-label' && shape.kind === 'text'
      ? { ...shape, position: { x: 900, y: 900 }, textAnchor: 'start' as const } : shape)
    const repaired = placeOneWireCountLabels(legacy)
    assert.deepEqual(repaired, section.shapes)
    assert.ok(repaired.every((shape, index) => shape.sourceLink?.role === 'count-label' || shape === legacy[index]))
    assert.deepEqual(placeOneWireCountLabels(repaired), repaired)
    const locked = legacy.map((shape) => shape.sourceLink?.role === 'count-label' ? { ...shape, locked: true } : shape)
    assert.deepEqual(placeOneWireCountLabels(locked), locked)
  }
})

const circuit = (empty = false) => {
  let id = 0
  return buildKamrailCircuitBundle({
    rail: { id: 'rail', kind: 'line', start: { x: 100, y: 1100 }, end: { x: 1000, y: 1100 } },
    anchorX: 400,
    options: { amps: 16, family: 'C', autoIncludeFamily: true, cableType: 'VOB', cableSectionMm2: 1.5 },
    familyComponents: empty ? [{ bindingId: 'C1', kind: 'empty' }] : [1, 2].flatMap((number) => [
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
  const cable = shapes.find((shape) => shape.sourceLink?.role === 'cable-section')!
  const trunk = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  assert.ok(cable.kind === 'text' && trunk.kind === 'line')
  const firstRowY = Math.max(...shapes.flatMap((shape) =>
    shape.kind === 'line' && shape.sourceLink?.role === 'row-wire' && shape.start.x === trunk.start.x
      ? [shape.start.y]
      : []
  ))
  assert.equal(cable.textAnchor, 'middle')
  assert.equal(cable.position.y, (trunk.start.y + firstRowY) / 2)
  const cableBox = oneWireLayoutBounds(cable)
  assert.ok(cableBox.x >= axisX + 12)
  const current = shapes.find((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'breaker-current')!
  const phase = shapes.find((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'breaker-phase')!
  assert.ok(current.kind === 'text' && phase.kind === 'text')
  assert.equal(current.textAnchor, 'start')
  assert.notEqual(phase.position.x, current.position.x)
  assert.equal(phase.position.y - current.position.y, -8)
  assert.ok(phase.position.y < breaker.position.y + terminals.bottom!.y)
  const currentBox = oneWireLayoutBounds(current)
  const phaseBox = oneWireLayoutBounds(phase)
  const poles = oneWireLayoutBounds(shapes.find((shape) => shape.sourceLink?.role === 'breaker-poles')!)
  assert.ok(Math.abs(currentBox.x - poles.x) < 1e-8)
  assert.ok(phaseBox.x + phaseBox.width <= currentBox.x || currentBox.x + currentBox.width <= phaseBox.x ||
    phaseBox.y + phaseBox.height <= currentBox.y || currentBox.y + currentBox.height <= phaseBox.y)
  assert.ok(poles.x + poles.width < axisX - 10)
  assert.ok(currentBox.x + currentBox.width < axisX - 10)
  assert.ok(currentBox.y >= poles.y + poles.height)
  for (const row of shapes.filter((shape) => shape.sourceLink?.kind !== 'board')) {
    const box = oneWireLayoutBounds(row)
    assert.ok(box.y + box.height <= cableBox.y - 24 + 1e-8)
  }
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

const checkEmptyClearance = (shapes: Shape[]) => {
  const breaker = shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')!
  const trunk = shapes.find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  const cable = shapes.find((shape) => shape.sourceLink?.role === 'cable-section')!
  assert.ok(breaker.kind === 'symbol' && trunk.kind === 'line' && cable.kind === 'text')
  const top = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!.top!
  assert.deepEqual(trunk.start, { x: breaker.position.x + top.x, y: breaker.position.y + top.y })
  const bounds = oneWireLayoutBounds(cable)
  assert.ok(bounds.y >= trunk.end.y + 24 - 1e-8)
  assert.ok(bounds.y + bounds.height <= trunk.start.y - 24 + 1e-8)
  assert.equal(cable.position.y, (trunk.start.y + trunk.end.y) / 2)
  assert.equal(cable.textAnchor, 'middle')
  assert.equal(trunk.connection?.labelOwner, 'circuit')
  assert.ok(!shapes.some((shape) => ['load', 'switch', 'number-label'].includes(shape.sourceLink?.role ?? '')))
}

test('empty circuits reserve a real cable section for their complete caption and longer specifications', () => {
  const original = circuit(true)
  const snapshot = structuredClone(original)
  checkEmptyClearance(original)
  const updated = applyOneWireCircuitPresentation({ shapes: original, circuitKey: 'C', stored: {
    cableConductors: 12, cableSectionMm2: 240, cableType: 'XVB-Cca'
  } })
  checkEmptyClearance(updated.shapes)
  const originalTrunk = original.find((shape) => shape.sourceLink?.role === 'trunk')!
  const updatedTrunk = updated.shapes.find((shape) => shape.sourceLink?.role === 'trunk')!
  assert.ok(originalTrunk.kind === 'line' && updatedTrunk.kind === 'line' && updatedTrunk.end.y < originalTrunk.end.y)
  for (const role of ['breaker', 'breaker-feed', 'label', 'cable-installation']) {
    const before = original.find((shape) => shape.sourceLink?.role === role)!
    const after = updated.shapes.find((shape) => shape.id === before.id)!
    assert.deepEqual('position' in after ? after.position : after, 'position' in before ? before.position : before)
  }
  assert.deepEqual(original, snapshot)
  assert.deepEqual(updated.shapes.map(({ id }) => id), original.map(({ id }) => id))
  assert.equal(spaceOneWireCircuitAnnotations(updated.shapes, 'C').changed, false)
})

test('repairs missing empty-circuit cables locally without repositioning populated circuits or manual connections', () => {
  const legacy = circuit(true).filter((shape) => shape.sourceLink?.role !== 'trunk')
  const snapshot = structuredClone(legacy)
  const repaired = spaceOneWireCircuitAnnotations(legacy, 'C', { emptyOnly: true, nextId: () => 'restored-trunk' })
  checkEmptyClearance(repaired.shapes)
  assert.equal(repaired.shapes.at(-1)?.id, 'restored-trunk')
  assert.deepEqual(legacy, snapshot)
  assert.equal(spaceOneWireCircuitAnnotations(repaired.shapes, 'C', { emptyOnly: true }).changed, false)
  const populated = circuit().map((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'cable-section'
    ? { ...shape, position: { x: 900, y: 900 } } : shape)
  assert.deepEqual(spaceOneWireCircuitAnnotations(populated, 'C', { emptyOnly: true }), { shapes: populated, changed: false })
  const trunk = circuit(true).find((shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk')!
  const manual = { ...trunk, id: 'manual', generationKey: undefined, sourceLink: undefined }
  const manualShapes = [...legacy, manual]
  assert.ok(!spaceOneWireCircuitAnnotations(manualShapes, 'C', { emptyOnly: true }).shapes
    .some((shape) => shape.sourceLink?.role === 'trunk'))
})
