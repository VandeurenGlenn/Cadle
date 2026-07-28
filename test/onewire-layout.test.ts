import assert from 'node:assert/strict'
import test from 'node:test'
import { ONE_WIRE_PRESETS } from '../src/editor/constants.ts'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.ts'
import {
  buildKamrailCircuitBundle,
  buildOneWireBreakerSection,
  oneWireCableLabelText,
  oneWirePhaseLabelText,
  oneWireProtectionSymbolPath
} from '../src/editor/layout/onewire-helpers.ts'
import {
  oneWireSymbolNodeInfo,
  oneWireSymbolScaleFor
} from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

const idSequence = () => {
  let value = 0
  return () => `shape-${++value}`
}

test('normalizes ground-plan protection symbols to their one-wire variants', () => {
  assert.equal(
    oneWireProtectionSymbolPath('Automaat', 'symbols/Protection devices/Automaat.svg'),
    'symbols/Protection devices/Automaat.svg'
  )
  assert.equal(
    oneWireProtectionSymbolPath(
      'Residual-current circuit breaker',
      'symbols/Protection devices/Residual-current circuit breaker.svg'
    ),
    'symbols/Protection devices/Residual-current circuit breaker.svg'
  )
  assert.equal(oneWireSymbolScaleFor('symbols/Protection devices/Automaat.svg'), 3)
  assert.equal(oneWireSymbolScaleFor('symbols/Protection devices/Residual-current circuit breaker.svg'), 4)
})

test('formats cable designations with or without a yellow-green conductor', () => {
  assert.equal(
    oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5, hasProtectiveConductor: true, cableType: 'XVB-Cca' }),
    '3G2.5 mm² XVB Cca'
  )
  assert.equal(
    oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5, hasProtectiveConductor: false, cableType: 'XVB-Cca' }),
    '3X2.5 mm² XVB Cca'
  )
  assert.equal(
    oneWireCableLabelText({ conductors: 4, sectionMm2: 10, cableType: 'EXVB' }),
    '4X10 mm² EXVB'
  )
  assert.equal(
    oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5, cableType: 'none' }),
    '3G2.5 mm²'
  )
  assert.equal(
    oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5 }),
    '3G2.5 mm²'
  )
})

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
    branchStroke: '#000000'
  })

  assert.deepEqual(
    result.shapes.map((shape) => shape.kind),
    ['symbol', 'text', 'text', 'text', 'text', 'text', 'symbol']
  )
  assert.ok(result.shapes.every((shape) => shape.bindingId === 'A1'))
  assert.equal(new Set(result.shapes.map((shape) => shape.groupId)).size, 1)
  const breaker = result.shapes.find((shape) => shape.kind === 'symbol')
  assert.deepEqual(breaker?.kind === 'symbol' ? breaker.symbolTextOverrides : null, {
    poles: '',
    phase: '',
    'rated-current': ''
  })
  assert.deepEqual(
    result.shapes
      .filter((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text')
      .map((shape) => [shape.sourceLink?.role, shape.text]),
    [
      ['label', 'A'],
      ['breaker-poles', '2P'],
      ['breaker-current', 'C20A'],
      ['breaker-phase', 'L1N'],
      ['cable-section', '3G1.5 mm²']
    ]
  )
  const cableSection = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-section')
  const cableInstallation = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-installation')
  const phase = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')
  assert.equal(phase?.kind === 'text' ? phase.textAnchor : null, 'end')
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

  const hiddenInstallation = buildOneWireBreakerSection(
    700,
    400,
    'A1',
    'A',
    {
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
      branchStroke: '#000000'
    },
    { cableInstallation: 'conduit', showCableInstallation: false }
  )
  const hiddenInstallationSymbol = hiddenInstallation.shapes.find(
    (shape) => shape.sourceLink?.role === 'cable-installation'
  )
  assert.equal(hiddenInstallationSymbol?.kind === 'symbol' ? hiddenInstallationSymbol.hidden : null, true)

  const configuredPhase = buildOneWireBreakerSection(
    700,
    400,
    'A1',
    'A',
    {
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
      branchStroke: '#000000'
    },
    { phaseConfiguration: 'L1+N' }
  )
  assert.equal(
    configuredPhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')?.kind === 'text'
      ? configuredPhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')?.text
      : null,
    'L1N'
  )
  const hiddenPhase = buildOneWireBreakerSection(
    700,
    400,
    'A1',
    'A',
    {
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
      branchStroke: '#000000'
    },
    { phaseConfiguration: 'L2+N', showPhaseLabel: false }
  )
  const hiddenPhaseLabel = hiddenPhase.shapes.find(
    (shape) => shape.sourceLink?.role === 'breaker-phase'
  )
  assert.equal(hiddenPhaseLabel?.kind === 'text' ? hiddenPhaseLabel.text : null, '')
  assert.equal(hiddenPhaseLabel?.kind === 'text' ? hiddenPhaseLabel.textAnchor : null, 'end')
  const fourPolePhase = buildOneWireBreakerSection(
    700,
    400,
    'A1',
    'A',
    {
      nextShapeId: idSequence(),
      oneWireComponentSymbol: () => ({
        name: 'Residual-current circuit breaker',
        path: 'symbols/Protection devices/Residual-current circuit breaker.svg'
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
    { poles: 4, phaseConfiguration: 'L1+L2+L3+N', showPhaseLabel: true }
  )
  const fourPolePhaseLabel = fourPolePhase.shapes.find(
    (shape) => shape.sourceLink?.role === 'breaker-phase'
  )
  assert.equal(fourPolePhaseLabel?.kind === 'text' ? fourPolePhaseLabel.text : null, 'L1L2L3N')
  assert.equal(oneWirePhaseLabelText('L2+N'), 'L2N')
  assert.equal(oneWirePhaseLabelText('L3+N'), 'L3N')
  assert.equal(oneWirePhaseLabelText('L1+L2+L3+N'), 'L1L2L3N')

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

test('reuses and vertically stacks every ground-plan outlet in a single circuit', () => {
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
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
  assert.ok(outlets.every((shape) => shape.kind === 'symbol' && shape.rotation === -90))
  assert.ok(
    outlets[0]?.kind === 'symbol'
      && outlets[1]?.kind === 'symbol'
      && outlets[1].position.y < outlets[0].position.y
  )
})

test('turns a lone socket onto the vertical circuit trunk', () => {
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
      family: 'D',
      autoIncludeFamily: true
    },
    familyComponents: [{
      bindingId: 'D',
      kind: 'load',
      sourceShapeId: 'outlet-1',
      sourcePath: outletPath,
      sourceName: 'Wall outlet'
    }],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
  const outlet = result.shapes.find(
    (shape) => shape.kind === 'symbol' && shape.sourceLink?.id === 'outlet-1'
  )
  assert.ok(outlet?.kind === 'symbol')
  assert.equal(outlet.rotation, -90)
  assert.equal(outlet.position.x, 400)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
})

test('stacks the only multi-device circuit vertically instead of creating a row', () => {
  const switchPath = 'symbols/Switches/Switch general symbol.svg'
  const lightPath = 'symbols/Consumption appliances/Lighting.svg'
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
      family: 'A',
      autoIncludeFamily: true
    },
    familyComponents: [
      { bindingId: 'A1', kind: 'switch', sourceShapeId: 'switch-1', sourcePath: switchPath, sourceName: 'Switch' },
      { bindingId: 'A1', kind: 'load', sourceShapeId: 'light-1', sourcePath: lightPath, sourceName: 'Light' }
    ],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
  const devices = result.shapes.filter(
    (shape): shape is Extract<Shape, { kind: 'symbol' }> =>
      shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'
  )
  assert.equal(devices.length, 2)
  assert.ok(devices.every((shape) => Math.abs(shape.position.x - 400) < 20))
  assert.ok(devices[1].position.y < devices[0].position.y)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
  assert.ok(!result.shapes.some(
    (shape) => shape.kind === 'line' && shape.start.y === shape.end.y && shape.bindingId === 'A1'
  ))
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
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
      && (lamp.position.y - 12) - (spot.position.y + 12) >= 8
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
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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

test('connects an ALSB distribution board without adding a fictitious breaker', () => {
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 },
      strokeWidth: 10
    },
    anchorX: 400,
    options: {
      amps: 40,
      cableSectionMm2: 10,
      family: 'ALSB',
      autoIncludeFamily: true,
      omitBreaker: true
    },
    familyComponents: [{
      bindingId: 'ALSB',
      kind: 'load',
      sourceShapeId: 'main-board',
      sourcePath: 'symbols/Distribution boards/Distribution board.svg',
      sourceName: 'Main distribution board'
    }],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
  assert.ok(result.shapes.some((shape) => shape.sourceLink?.id === 'main-board'))
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'breaker'))
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'breaker-current'))
  const trunk = result.shapes.find((shape) => shape.sourceLink?.role === 'trunk')
  assert.ok(trunk?.kind === 'line')
  assert.equal(trunk.start.y, 700)
})

test('adds an editable breaker without drawing a family label', () => {
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 },
      strokeWidth: 10
    },
    anchorX: 400,
    options: {
      amps: 20,
      cableSectionMm2: 2.5,
      family: 'C',
      autoIncludeFamily: true,
      hideFamilyLabel: true
    },
    familyComponents: [{
      bindingId: 'C',
      kind: 'empty',
      breakerCurrentA: 20,
      cableSectionMm2: 2.5,
      poles: 2,
      breakerCurve: 'C'
    }],
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind) => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
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
  const breaker = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker')
  assert.ok(breaker)
  assert.equal(breaker.sourceLink?.id, 'C')
  assert.equal(result.selectedId, breaker.id)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'label'))
  assert.ok(!result.shapes.some((shape) => shape.kind === 'text' && shape.text === 'C'))
})
