import assert from 'node:assert/strict'
import test from 'node:test'
import { ONE_WIRE_PRESETS } from '../src/editor/constants.ts'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.ts'
import { buildKamrailCircuitBundle, buildOneWireBreakerSection } from '../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

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
      path: 'symbols/One-wire/Custom breaker.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  })

  assert.deepEqual(
    result.shapes.map((shape) => shape.kind),
    ['symbol', 'text', 'text', 'text', 'text', 'text', 'symbol']
  )
  assert.ok(result.shapes.every((shape) => shape.bindingId === 'A1'))
  assert.equal(new Set(result.shapes.map((shape) => shape.groupId)).size, 1)
  const breaker = result.shapes.find((shape) => shape.kind === 'symbol')
  assert.equal(breaker?.kind === 'symbol' ? breaker.symbolTextOverrides : null, undefined)
  assert.deepEqual(
    result.shapes
      .filter((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text')
      .map((shape) => [shape.sourceLink?.role, shape.text]),
    [
      ['label', 'A'],
      ['breaker-poles', '2P'],
      ['breaker-current', 'C20A'],
      ['breaker-phase', '1N'],
      ['cable-section', '3G1.5 mm² VOB']
    ]
  )
  const cableSection = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-section')
  const cableInstallation = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-installation')
  const phase = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')
  assert.ok(cableSection?.kind === 'text' && cableSection.position.x > 400)
  assert.equal(cableSection?.kind === 'text' ? cableSection.scale : null, 0.65)
  assert.equal(cableSection?.kind === 'text' ? cableSection.rotation : null, -90)
  assert.ok(phase?.kind === 'text' && phase.position.x < 400 && phase.position.y < 700)
  assert.ok(cableSection?.kind === 'text' && cableSection.position.y < 700)
  assert.equal(
    cableInstallation?.kind === 'symbol' ? cableInstallation.path : null,
    'symbols/Wires/Cable in conduit recessed in wall.svg'
  )
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.scale : null, 3)
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.strokeWidth : null, 1)

  const configuredPhase = buildOneWireBreakerSection(
    700,
    400,
    'A1',
    'A',
    {
      nextShapeId: idSequence(),
      oneWireComponentSymbol: () => ({
        name: 'Automaat',
        path: 'symbols/One-wire/Custom breaker.svg'
      }),
      oneWireSymbolScale: () => 1,
      symbolContentBounds: (shape) => ({
        x: shape.position.x - 12,
        y: shape.position.y - 12,
        width: 24,
        height: 24
      }),
      branchStroke: '#000000'
    },
    { phaseConfiguration: 'L1+N' }
  )
  assert.equal(
    configuredPhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')?.kind === 'text'
      ? configuredPhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')?.text
      : null,
    'L1+N'
  )

  const placedBreaker = result.shapes.find(
    (shape): shape is Extract<Shape, { kind: 'symbol' }> =>
      shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker'
  )
  assert.ok(placedBreaker)
  const breakerNode = oneWireSymbolNodeInfo(placedBreaker.path, placedBreaker.scale)
  assert.ok(breakerNode)
  assert.equal(placedBreaker.position.x + breakerNode.offset.x, 400)
  assert.equal(placedBreaker.position.y + breakerNode.offset.y, 695)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'feed'))
})

test('reuses every ground-plan outlet symbol in a multi-outlet circuit', () => {
  const outletPath = 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg'
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 }
    },
    anchorX: 400,
    options: {
      amps: 20,
      cableSectionMm2: 2.5,
      family: 'H',
      autoIncludeFamily: true
    },
    familyComponents: [
      { bindingId: 'H', kind: 'load', sourceShapeId: 'outlet-1', sourcePath: outletPath, sourceName: 'Outlet 1' },
      { bindingId: 'H', kind: 'load', sourceShapeId: 'outlet-2', sourcePath: outletPath, sourceName: 'Outlet 2' }
    ],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/One-wire/Custom breaker.svg' : 'symbols/Fallback.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  })

  assert.ok(result)
  const outlets = result.shapes.filter(
    (shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'
  )
  assert.deepEqual(outlets.map((shape) => shape.kind === 'symbol' ? shape.path : ''), [outletPath, outletPath])
  assert.deepEqual(outlets.map((shape) => shape.sourceLink?.id), ['outlet-1', 'outlet-2'])
})

test('keeps spotlight and lamp symbols distinct when collapsing repeated lights', () => {
  const lampPath = 'symbols/Consumption appliances/Lighting.svg'
  const spotPath = 'symbols/Consumption appliances/Spot.svg'
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 }
    },
    anchorX: 400,
    options: {
      amps: 16,
      cableSectionMm2: 1.5,
      family: 'L',
      autoIncludeFamily: true
    },
    familyComponents: [
      { bindingId: 'L1', kind: 'load', sourceShapeId: 'spot-1', sourcePath: spotPath, sourceName: 'Spot' },
      { bindingId: 'L1', kind: 'load', sourceShapeId: 'lamp-1', sourcePath: lampPath, sourceName: 'Lamp' },
      { bindingId: 'L1', kind: 'load', sourceShapeId: 'lamp-2', sourcePath: lampPath, sourceName: 'Lamp' }
    ],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/One-wire/Custom breaker.svg' : 'symbols/Fallback.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  })

  assert.ok(result)
  const loads = result.shapes.filter(
    (shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'
  )
  assert.deepEqual(loads.map((shape) => shape.kind === 'symbol' ? shape.path : ''), [lampPath, spotPath])
  const [lamp, spot] = loads
  assert.ok(
    lamp?.kind === 'symbol'
      && spot?.kind === 'symbol'
      && (spot.position.x - 12) - (lamp.position.x + 12) >= 8
  )
  assert.ok(result.shapes.some((shape) => shape.kind === 'text' && shape.text === 'x2'))
})

test('draws a breaker row without inventing a load symbol', () => {
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 }
    },
    anchorX: 400,
    options: {
      amps: 20,
      cableSectionMm2: 2.5,
      family: 'R',
      autoIncludeFamily: true
    },
    familyComponents: [{ bindingId: 'R1', kind: 'empty' }],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/One-wire/Custom breaker.svg' : 'symbols/Fallback.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  })

  assert.ok(result)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
  assert.ok(!result.shapes.some(
    (shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'
  ))
})

test('places a lone circuit device directly on the trunk without a numbered row', () => {
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 }
    },
    anchorX: 400,
    options: {
      amps: 20,
      cableSectionMm2: 2.5,
      family: 'U',
      autoIncludeFamily: true
    },
    familyComponents: [{
      bindingId: 'U',
      kind: 'load',
      sourceShapeId: 'inverter',
      sourcePath: 'symbols/Consumption appliances/PV inverter.svg',
      sourceName: 'PV inverter'
    }],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/One-wire/Custom breaker.svg' : 'symbols/Fallback.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  })

  assert.ok(result)
  const device = result.shapes.find(
    (shape) => shape.kind === 'symbol' && shape.sourceLink?.id === 'inverter'
  )
  assert.ok(device?.kind === 'symbol')
  assert.equal(device.position.x, 400)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
  assert.ok(!result.shapes.some(
    (shape) => shape.kind === 'line' && shape.start.y === shape.end.y && shape.bindingId === 'U'
  ))
})
