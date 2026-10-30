import assert from 'node:assert/strict'
import test from 'node:test'
import { ONE_WIRE_PRESETS, ONE_WIRE_SOCKET_SYMBOL_PATH } from '../src/editor/constants.ts'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.ts'
import {
  buildKamrailCircuitBundle,
  buildOneWireBreakerSection,
  buildOneWireRowSection,
  ONE_WIRE_CONDUCTOR_STROKE_WIDTH,
  oneWireCableLabelText,
  oneWirePhaseLabelText,
  oneWireProtectionSymbolPath
} from '../src/editor/layout/onewire-helpers.ts'
import {
  ONE_WIRE_RENDERED_STROKE_WIDTH,
  oneWireSymbolNodeInfo,
  oneWireSymbolRotationFor,
  oneWireSymbolScaleFor,
  oneWireSymbolStrokeWidthFor,
  oneWireSymbolTerminalInfo
} from '../src/editor/layout/onewire-symbol-nodes.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
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
  assert.ok((oneWireSymbolScaleFor('symbols/Protection devices/Automaat.svg') ?? 0) > 2.5)
  assert.ok((oneWireSymbolScaleFor('symbols/Protection devices/Residual-current circuit breaker.svg') ?? 0) > 1.8)
  const switchScale = oneWireSymbolScaleFor('symbols/Switches/Switch general symbol.svg')!
  assert.ok(Math.abs(oneWireSymbolNodeInfo('symbols/Switches/Switch general symbol.svg', switchScale)!.cutHalfWidth! * 2 / 8 - 2) < 1e-6)
  assert.equal(oneWireSymbolScaleFor('symbols/Socket outlets/Wall outlet with grounding.svg')! * 24 / 8, 4)
  assert.equal(ONE_WIRE_SOCKET_SYMBOL_PATH, 'symbols/Socket outlets/Wall outlet with grounding.svg')
})

test('defines stable nodes and relative sizes for every one-wire switch symbol', () => {
  const pushButtonPaths = [
    'symbols/Switches/Push button.svg',
    'symbols/Switches/Illuminated push button.svg',
    'symbols/Switches/Push switch with safety cover.svg'
  ]
  const classicSwitchPaths = [
    'symbols/Switches/Switch general symbol.svg',
    'symbols/Switches/Double pole switch.svg',
    'symbols/Switches/Double pole illuminated switch.svg',
    'symbols/Switches/Dual switch, single casing.svg',
    'symbols/Switches/Dimmer switch.svg',
    'symbols/Switches/Single pole illuminated switch.svg',
    'symbols/Switches/Single pole switch with indicator light.svg',
    'symbols/Switches/Single pole delayed switch.svg',
    'symbols/Switches/Single pole pull switch.svg',
    'symbols/Switches/Single pole change over switch.svg',
    'symbols/Switches/Double pole change over switch.svg',
    'symbols/Switches/Double change over switch (wissel-wissel).svg',
    'symbols/Switches/Intermediate switch.svg',
    'symbols/Switches/Triple pole switch.svg'
  ]
  const deviceSwitchPaths = [
    'symbols/Switches/Impulse relay.svg',
    'symbols/Switches/Time switch.svg',
    'symbols/Switches/Electric lock or guard tour control device.svg',
    'symbols/Switches/Thermostat.svg',
    'symbols/Switches/Timer.svg'
  ]

  for (const path of pushButtonPaths) {
    const scale = oneWireSymbolScaleFor(path)
    assert.notEqual(scale, null)
    const node = oneWireSymbolNodeInfo(path, scale!)
    assert.ok(node?.cutHalfWidth !== null && node.cutHalfWidth >= 4.2 && node.cutHalfWidth <= 8.001)
  }

  for (const path of classicSwitchPaths) {
    const scale = oneWireSymbolScaleFor(path)
    assert.notEqual(scale, null)
    const node = oneWireSymbolNodeInfo(path, scale!)
    assert.ok(node?.cutHalfWidth !== null && Math.abs(node.cutHalfWidth * 2 / 8 - 2) < 1e-6)
    assert.ok(scale! > 0 && scale! <= 3)
  }

  for (const path of deviceSwitchPaths) {
    const scale = oneWireSymbolScaleFor(path)
    assert.notEqual(scale, null)
    const node = oneWireSymbolNodeInfo(path, scale!)
    assert.ok(node?.cutHalfWidth !== null && node.cutHalfWidth >= 7.999 && node.cutHalfWidth <= 8.001)
    assert.ok(scale! >= 0.67 && scale! <= 0.69)
  }

  const doubleButton = oneWireSymbolNodeInfo('symbols/Switches/Double push button.svg', 1.425)
  assert.ok(doubleButton?.cutHalfWidth !== null && Math.abs(doubleButton.cutHalfWidth - 6.78 * 24 * 1.425 / 13.68) < 1e-8)
  assert.ok(classicSwitchPaths.length + pushButtonPaths.length + deviceSwitchPaths.length + 1 === 23)
})

test('keeps electrical nodes and breaker terminals on their wire axes', () => {
  const wallLightPath = 'symbols/Consumption appliances/Wall light.svg'
  const wallLightNode = oneWireSymbolNodeInfo(wallLightPath, 1.7)
  assert.ok(wallLightNode)
  assert.equal(oneWireSymbolRotationFor(wallLightPath), undefined)
  assert.ok(wallLightNode.offset.x < 0)
  assert.ok(wallLightNode.offset.y > 0)

  const breakerPath = 'symbols/Protection devices/Automaat.svg'
  const breakerNode = oneWireSymbolNodeInfo(breakerPath, 2.8)
  const breakerTerminal = oneWireSymbolTerminalInfo(breakerPath, 2.8)?.bottom
  assert.ok(breakerNode && breakerTerminal)
  assert.ok(Math.abs(breakerNode.offset.x - breakerTerminal.x) < 0.0001)
  assert.ok(Math.abs(breakerNode.offset.y - breakerTerminal.y) < 0.0001)
})

test('connects row wires directly to symbol node edges', () => {
  const path = 'symbols/Switches/Switch general symbol.svg'
  const scale = oneWireSymbolScaleFor(path) ?? 1
  const node = oneWireSymbolNodeInfo(path, scale)
  assert.ok(node)
  assert.ok(node.cutHalfWidth !== null && Math.abs(node.cutHalfWidth - 8) < 1e-6)
  const lamp = oneWireSymbolNodeInfo('symbols/Consumption appliances/Lighting.svg', 1.35)
  assert.deepEqual(lamp, { offset: { x: 0, y: 0 }, cutHalfWidth: null })
  const fluorescent = oneWireSymbolNodeInfo('symbols/Consumption appliances/Fluorescent lamp.svg', 1.35, 90)
  assert.ok(fluorescent?.cutHalfWidth !== null && fluorescent.cutHalfWidth < 0.2)
})

test('connects the breaker terminal and every branch without grid rounding gaps', () => {
  const result = buildKamrailCircuitBundle({
    rail: { id: 'rail', kind: 'line', start: { x: 0, y: 703 }, end: { x: 1000, y: 703 } },
    anchorX: 400,
    options: { amps: 16, family: 'A', autoIncludeFamily: true },
    familyComponents: [
      ...Array.from({ length: 6 }, (_, index) => ({
        bindingId: `A${index + 1}`,
        kind: 'load' as const,
        sourcePath: 'symbols/Consumption appliances/Lighting.svg'
      })),
      ...Array.from({ length: 12 }, () => ({
        bindingId: 'A1',
        kind: 'switch' as const,
        sourcePath: 'symbols/Switches/Switch general symbol.svg'
      }))
    ],
    minimumRowY: 190,
    nextShapeId: idSequence(),
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path) ?? 1.35,
    symbolContentBounds: (shape) => ({
      x: shape.position.x - 12 * shape.scale,
      y: shape.position.y - 12 * shape.scale,
      width: 24 * shape.scale,
      height: 24 * shape.scale
    }),
    branchStroke: '#000000'
  })
  assert.ok(result)
  const breaker = result.shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker')
  const distribution = result.shapes.find(
    (shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk-distribution'
  )
  assert.ok(breaker?.kind === 'symbol' && distribution?.kind === 'line')
  const terminal = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)?.top
  assert.ok(terminal)
  assert.deepEqual(distribution.start, { x: breaker.position.x + terminal.x, y: breaker.position.y + terminal.y })
  const trunks = result.shapes.filter(
    (shape) => shape.kind === 'line' && /^trunk(?:-\d+)?$/.test(shape.sourceLink?.role ?? '')
  )
  assert.equal(trunks.length, 2)
  assert.ok(trunks[0].kind === 'line' && trunks[1].kind === 'line' && trunks[1].start.x - trunks[0].start.x > 200)
  for (const trunk of trunks) {
    assert.ok(trunk.kind === 'line')
    assert.equal(trunk.start.y, distribution.start.y)
    const branches = result.shapes.filter(
      (shape) => shape.kind === 'line' && shape.sourceLink?.role === 'row-wire' && shape.start.x === trunk.start.x
    )
    assert.equal(branches.length, 3)
    assert.equal(trunk.end.y, Math.min(...branches.map((shape) => (shape.kind === 'line' ? shape.start.y : Infinity))))
  }
})

test('lays out known row symbols identically before and after SVG cache warming', () => {
  const row = [
    'A1',
    [
      { bindingId: 'A1', kind: 'switch' as const, sourcePath: 'symbols/Switches/Double push button.svg' },
      { bindingId: 'A1', kind: 'load' as const, sourcePath: 'symbols/Consumption appliances/Fluorescent lamp.svg' }
    ]
  ] as Parameters<typeof buildOneWireRowSection>[1]
  const render = (boundsSize: number) =>
    buildOneWireRowSection(0, row, 700, 400, {
      nextShapeId: idSequence(),
      oneWireComponentSymbol: () => ({ name: 'Load', path: 'load.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path) ?? 1.35,
      symbolContentBounds: (shape) => ({
        x: shape.position.x - boundsSize / 2,
        y: shape.position.y - boundsSize / 2,
        width: boundsSize,
        height: boundsSize
      }),
      branchStroke: '#000000'
    })
  assert.deepEqual(render(24), render(60))
})

test('normalizes rendered stroke widths across differently sized symbol viewBoxes', () => {
  const symbols = [
    { path: 'symbols/Protection devices/Automaat.svg', maxViewBox: 28.8265 },
    { path: 'symbols/Switches/Push button.svg', maxViewBox: 8.74394 },
    { path: 'symbols/Switches/Switch general symbol.svg', maxViewBox: 13.368 },
    { path: 'symbols/Consumption appliances/Lighting.svg', maxViewBox: 11.6358 },
    { path: 'symbols/Consumption appliances/Wall light.svg', maxViewBox: 22.9172 }
  ]

  for (const { path, maxViewBox } of symbols) {
    const scale = oneWireSymbolScaleFor(path) ?? 1
    const sourceStrokeWidth = oneWireSymbolStrokeWidthFor(path, scale)
    const renderedStrokeWidth = sourceStrokeWidth * ((24 * scale) / maxViewBox)
    assert.ok(Math.abs(renderedStrokeWidth - ONE_WIRE_RENDERED_STROKE_WIDTH) < 0.0001, path)
  }
  assert.equal(ONE_WIRE_RENDERED_STROKE_WIDTH, 2)
})

test('defines connection nodes for every built-in socket variant', () => {
  const socketNames = [
    'Wall outlet with grounding.svg',
    'Wall outlet with grounding for floorplan.svg',
    'Wall outlet with integrated safety shutter.svg',
    'Wall outlet with integrated safety shutter for floorplan.svg',
    'Wall outlet with grounding and integrated safety shutter.svg',
    'Wall outlet with grounding and integrated safety shutter for floorplan.svg'
  ]

  for (const name of socketNames) {
    const node = oneWireSymbolNodeInfo(`symbols/Socket outlets/${name}`, 0.9, -90)
    assert.ok(node, name)
    assert.equal(node.cutHalfWidth, null)
  }
})

test('preserves one-wire symbol scale until node-aware page migration', () => {
  const [single, double] = sanitizeShapes([
    {
      id: 'single',
      kind: 'symbol',
      position: { x: 0, y: 0 },
      name: 'Push button',
      path: 'symbols/Switches/Push button.svg',
      scale: 1.53,
      groupId: 'onewire-row-1'
    },
    {
      id: 'double',
      kind: 'symbol',
      position: { x: 0, y: 0 },
      name: 'Double push button',
      path: 'symbols/Switches/Double push button.svg',
      scale: 1.53,
      groupId: 'onewire-row-2'
    }
  ])

  assert.equal(single?.kind === 'symbol' ? single.scale : null, 1.53)
  assert.equal(double?.kind === 'symbol' ? double.scale : null, 1.53)
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
  assert.equal(oneWireCableLabelText({ conductors: 4, sectionMm2: 10, cableType: 'EXVB' }), '4X10 mm² EXVB')
  assert.equal(oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5, cableType: 'none' }), '3G2.5 mm²')
  assert.equal(oneWireCableLabelText({ conductors: 3, sectionMm2: 2.5 }), '3G2.5 mm²')
})

test('anchors readable breaker annotations to the conductor like the reference diagram', () => {
  const section = buildOneWireBreakerSection(
    700,
    400,
    'AA',
    'AA',
    {
      nextShapeId: idSequence(),
      oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path) ?? 1.35,
      symbolContentBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      branchStroke: '#000000'
    },
    { amps: 16, poles: 4, cableConductors: 5, cableSectionMm2: 1.5, cableType: 'VOB' }
  )
  const breaker = section.shapes.find((shape) => shape.sourceLink?.role === 'breaker')
  const cable = section.shapes.find((shape) => shape.sourceLink?.role === 'cable-section')
  const installation = section.shapes.find((shape) => shape.sourceLink?.role === 'cable-installation')
  const family = section.shapes.find((shape) => shape.sourceLink?.role === 'label')
  assert.ok(
    breaker?.kind === 'symbol' && cable?.kind === 'text' && installation?.kind === 'symbol' && family?.kind === 'text'
  )
  const terminals = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)!
  assert.ok(terminals.bottom!.y - terminals.top!.y > 35)
  assert.equal(cable.position.x, 436)
  assert.equal(cable.position.y, section.breakerContentTopY - 24)
  assert.equal(cable.rotation, -90)
  assert.equal(18 * cable.scale! / 8, 2.5)
  assert.equal(cable.fontWeight, 400)
  const node = oneWireSymbolNodeInfo(installation.path, installation.scale)!
  assert.equal(installation.position.x + node.offset.x, 400)
  assert.equal(installation.position.x, 400)
  assert.equal(installation.position.y + node.offset.y, section.breakerContentTopY - 8)
  assert.equal(family.position.x, 400)
  assert.equal(family.textAnchor, 'middle')
})

test('builds a complete lighting circuit upward from its bus connection', () => {
  const result = buildOneWireCircuit({ x: 400, y: 700 }, 'A1', ONE_WIRE_PRESETS.lighting, idSequence(), 80, 24)

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
    ['symbol', 'line', 'text', 'text', 'text', 'text', 'text', 'symbol', 'text']
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
      ['breaker-phase', 'N-L1'],
      ['cable-section', '3G1.5 mm²'],
      ['cable-installation-label', 'In conduit, recessed in wall']
    ]
  )
  const cableSection = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-section')
  const cableInstallation = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-installation')
  const cableInstallationLabel = result.shapes.find((shape) => shape.sourceLink?.role === 'cable-installation-label')
  const phase = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')
  assert.equal(phase?.kind === 'text' ? phase.textAnchor : null, 'end')
  assert.ok(cableSection?.kind === 'text' && cableSection.position.x === 436)
  assert.equal(cableSection?.kind === 'text' ? cableSection.textAnchor : null, undefined)
  assert.equal(cableSection?.kind === 'text' ? 18 * cableSection.scale! / 8 : null, 2.5)
  assert.equal(cableSection?.kind === 'text' ? cableSection.rotation : null, -90)
  assert.ok(cableInstallationLabel?.kind === 'text' && cableInstallationLabel.position.x === 432)
  assert.equal(cableInstallationLabel?.kind === 'text' ? cableInstallationLabel.textAnchor : null, undefined)
  assert.equal(cableInstallationLabel?.kind === 'text' ? cableInstallationLabel.scale : null, 0.54)
  assert.equal(cableInstallationLabel?.kind === 'text' ? cableInstallationLabel.rotation : null, -90)
  assert.equal(cableInstallationLabel?.kind === 'text' ? cableInstallationLabel.hidden : null, true)
  assert.ok(phase?.kind === 'text' && phase.position.x < 400 && phase.position.y === 694)
  assert.ok(cableSection?.kind === 'text' && cableSection.position.y < 700)
  assert.equal(
    cableInstallation?.kind === 'symbol' ? cableInstallation.path : null,
    'symbols/Wires/Cable in conduit recessed in wall.svg'
  )
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.hidden : null, false)
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.position.x : null, 400)
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.scale : null, 2.25)
  assert.equal(cableInstallation?.kind === 'symbol' ? cableInstallation.strokeWidth : null, 2)
  const restoredCable = sanitizeShapes(result.shapes).find((shape) => shape.sourceLink?.role === 'cable-section')
  assert.ok(restoredCable?.kind === 'text' && cableSection?.kind === 'text')
  assert.deepEqual(restoredCable.position, cableSection.position)
  assert.equal(restoredCable.rotation, cableSection.rotation)
  assert.equal(restoredCable.fontWeight, cableSection.fontWeight)
  assert.ok(cableInstallation?.kind === 'symbol')
  const scaledInstallation = { ...cableInstallation, scale: cableInstallation.scale * 1.5 }
  const [restoredInstallation] = sanitizeShapes([scaledInstallation])
  assert.ok(restoredInstallation.kind === 'symbol')
  assert.equal(restoredInstallation.scale, scaledInstallation.scale)
  assert.deepEqual(restoredInstallation.position, scaledInstallation.position)
  assert.equal(restoredInstallation.strokeWidth, scaledInstallation.strokeWidth)

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
  const hiddenInstallationLabel = hiddenInstallation.shapes.find(
    (shape) => shape.sourceLink?.role === 'cable-installation-label'
  )
  assert.equal(hiddenInstallationSymbol?.kind === 'symbol' ? hiddenInstallationSymbol.hidden : null, true)
  assert.equal(hiddenInstallationLabel?.kind === 'text' ? hiddenInstallationLabel.hidden : null, true)

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
    'N-L1'
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
  const hiddenPhaseLabel = hiddenPhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')
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
  const fourPolePhaseLabel = fourPolePhase.shapes.find((shape) => shape.sourceLink?.role === 'breaker-phase')
  assert.equal(fourPolePhaseLabel?.kind === 'text' ? fourPolePhaseLabel.text : null, '')
  assert.equal(oneWirePhaseLabelText('L2+N'), 'L2-N')
  assert.equal(oneWirePhaseLabelText('L3+N'), 'L3-N')
  assert.equal(oneWirePhaseLabelText('L1+L2+L3+N'), 'L1-L2-L3-N')

  const placedBreaker = result.shapes.find(
    (shape): shape is Extract<Shape, { kind: 'symbol' }> =>
      shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker'
  )
  assert.ok(placedBreaker)
  const breakerNode = oneWireSymbolNodeInfo(placedBreaker.path, placedBreaker.scale)
  assert.ok(breakerNode)
  const breakerTerminals = oneWireSymbolTerminalInfo(placedBreaker.path, placedBreaker.scale)
  assert.equal(placedBreaker.position.x + breakerNode.offset.x, 400)
  assert.equal(placedBreaker.position.y + breakerNode.offset.y, 660)
  const breakerFeed = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker-feed')
  assert.ok(breakerFeed?.kind === 'line')
  assert.deepEqual(breakerFeed.start, { x: 400, y: 700 })
  assert.deepEqual(breakerFeed.end, { x: 400, y: 660 })
  assert.ok(breakerTerminals?.top)
  assert.equal(result.breakerContentTopY, placedBreaker.position.y + breakerTerminals.top.y)
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
  assert.ok(
    result.shapes
      .filter((shape): shape is Extract<Shape, { kind: 'line' }> => shape.kind === 'line')
      .every((shape) => shape.strokeWidth === ONE_WIRE_CONDUCTOR_STROKE_WIDTH)
  )
  const outlets = result.shapes.filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device')
  assert.deepEqual(
    outlets.map((shape) => (shape.kind === 'symbol' ? shape.path : '')),
    [outletPath, outletPath]
  )
  assert.deepEqual(
    outlets.map((shape) => shape.sourceLink?.id),
    ['outlet-1', 'outlet-2']
  )
  assert.ok(outlets.every((shape) => shape.kind === 'symbol' && shape.rotation === -90))
  assert.ok(
    outlets[0]?.kind === 'symbol' && outlets[1]?.kind === 'symbol' && outlets[1].position.y < outlets[0].position.y
  )
})

test('places one impulse relay between push buttons and lighting loads', () => {
  const common = {
    rail: {
      id: 'rail',
      kind: 'line' as const,
      start: { x: 80, y: 700 },
      end: { x: 900, y: 700 }
    },
    anchorX: 400,
    options: { amps: 16, cableSectionMm2: 1.5, family: 'A', autoIncludeFamily: true },
    nextShapeId: idSequence(),
    oneWireComponentSymbol: (kind: 'breaker' | 'switch' | 'load') => ({
      name: kind === 'breaker' ? 'Automaat' : 'Fallback',
      path: kind === 'breaker' ? 'symbols/Protection devices/Automaat.svg' : 'symbols/Fallback.svg'
    }),
    oneWireSymbolScale: () => 1,
    symbolContentBounds: (shape: Extract<Shape, { kind: 'symbol' }>) => ({
      x: shape.position.x - 12,
      y: shape.position.y - 12,
      width: 24,
      height: 24
    }),
    branchStroke: '#000000'
  }
  const pushButton = {
    bindingId: 'A1',
    kind: 'switch' as const,
    sourceShapeId: 'push-1',
    sourcePath: 'symbols/Switches/Push button.svg',
    sourceName: 'Push button'
  }
  const light = {
    bindingId: 'A1',
    kind: 'load' as const,
    sourceShapeId: 'light-1',
    sourcePath: 'symbols/Consumption appliances/Lighting.svg',
    sourceName: 'Lighting'
  }
  const generated = buildKamrailCircuitBundle({ ...common, familyComponents: [pushButton, light] })
  assert.ok(generated)
  assert.deepEqual(
    generated.shapes
      .filter((shape): shape is Extract<Shape, { kind: 'symbol' }> => shape.kind === 'symbol')
      .map((shape) => shape.path)
      .filter((path) => /push button|impulse relay|lighting/i.test(path)),
    [
      'symbols/Switches/Push button.svg',
      'symbols/Switches/Impulse relay.svg',
      'symbols/Consumption appliances/Lighting.svg'
    ]
  )

  const preserved = buildKamrailCircuitBundle({
    ...common,
    nextShapeId: idSequence(),
    familyComponents: [
      pushButton,
      {
        bindingId: 'A1',
        kind: 'switch',
        sourceShapeId: 'relay-1',
        sourcePath: 'symbols/Switches/Impulse relay.svg',
        sourceName: 'Impulse relay'
      },
      light
    ]
  })
  assert.ok(preserved)
  assert.equal(
    preserved.shapes.filter((shape) => shape.kind === 'symbol' && /impulse relay/i.test(shape.path)).length,
    1
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
    familyComponents: [
      {
        bindingId: 'D',
        kind: 'load',
        sourceShapeId: 'outlet-1',
        sourcePath: outletPath,
        sourceName: 'Wall outlet'
      }
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
  const outlet = result.shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.id === 'outlet-1')
  const trunk = result.shapes.find(
    (shape): shape is Extract<Shape, { kind: 'line' }> => shape.kind === 'line' && shape.sourceLink?.role === 'trunk'
  )
  assert.ok(outlet?.kind === 'symbol')
  assert.ok(trunk)
  assert.equal(outlet.rotation, -90)
  const outletNode = oneWireSymbolNodeInfo(outlet.path, outlet.scale, outlet.rotation)
  assert.ok(outletNode)
  assert.ok(Math.abs(outlet.position.x + outletNode.offset.x - trunk.end.x) < 0.0001)
  assert.ok(Math.abs(outlet.position.y + outletNode.offset.y - trunk.end.y) < 0.0001)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
})

test('keeps numbered row symbols close to the vertical circuit trunk', () => {
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
      family: 'A',
      autoIncludeFamily: true
    },
    familyComponents: [
      { bindingId: 'A1', kind: 'load', sourceShapeId: 'load-1', sourceName: 'Load 1' },
      { bindingId: 'A2', kind: 'load', sourceShapeId: 'load-2', sourceName: 'Load 2' }
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
  const firstSymbol = result.shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.id === 'load-1')
  const firstConnector = result.shapes.find(
    (shape) => shape.kind === 'line' && shape.bindingId === 'A1' && shape.start.y === shape.end.y
  )
  assert.equal(firstSymbol?.kind === 'symbol' ? firstSymbol.position.x : null, 430)
  assert.ok(firstConnector?.kind === 'line')
  assert.ok(firstConnector.end.x - firstConnector.start.x <= 50)
})

test('wraps a 22-point manually inserted family into readable columns', () => {
  const result = buildKamrailCircuitBundle({
    rail: {
      id: 'rail',
      kind: 'line',
      start: { x: 80, y: 1100 },
      end: { x: 900, y: 1100 }
    },
    anchorX: 400,
    options: {
      amps: 16,
      cableSectionMm2: 1.5,
      family: 'A',
      autoIncludeFamily: true
    },
    familyComponents: Array.from({ length: 22 }, (_, index) => ({
      bindingId: `A${index + 1}`,
      kind: 'load' as const,
      sourceShapeId: `load-${index + 1}`,
      sourceName: `Load ${index + 1}`
    })),
    minimumRowY: 100,
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
  const rowYs = result.shapes
    .filter((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text' && /^\d+$/.test(shape.text))
    .map((shape) => ({ x: shape.position.x, y: shape.position.y - 5 }))
  assert.equal(rowYs.length, 22)
  assert.ok(
    result.shapes
      .filter((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text' && /^\d+$/.test(shape.text))
      .every((shape) => shape.fontWeight === 500 && 18 * shape.scale! / 8 >= 2.75)
  )
  assert.ok(
    result.shapes
      .filter(
        (shape): shape is Extract<Shape, { kind: 'text' }> =>
          shape.kind === 'text' && ['2P', 'C16A', '3G1.5 mm² VOB'].includes(shape.text)
      )
      .every((shape) => shape.fontWeight === 400 && 18 * shape.scale! / 8 >= 2.5)
  )
  const trunkXs = result.shapes
    .filter(
      (shape): shape is Extract<Shape, { kind: 'line' }> =>
        shape.kind === 'line' && /^trunk(?:-\d+)?$/.test(shape.sourceLink?.role ?? '')
    )
    .map((shape) => shape.start.x)
  assert.equal(trunkXs.length, 2)
  const columns = Map.groupBy(rowYs, (row) =>
    trunkXs.reduce((closest, trunkX) => (Math.abs(row.x - trunkX) < Math.abs(row.x - closest) ? trunkX : closest))
  )
  for (const rows of columns.values()) {
    const ys = rows.map((row) => row.y).sort((a, b) => a - b)
    assert.ok(ys[0] >= 100)
    assert.ok(ys.every((rowY, index) => index === 0 || rowY - ys[index - 1] === 64))
  }
  const columnSizes = [...columns.values()].map((rows) => rows.length)
  assert.ok(Math.max(...columnSizes) - Math.min(...columnSizes) <= 1)
  assert.equal(Math.max(...trunkXs) - Math.min(...trunkXs), 200)
  assert.ok(
    result.shapes.some(
      (shape) => shape.kind === 'line' && shape.sourceLink?.role === 'trunk-distribution' && shape.end.x > shape.start.x
    )
  )
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
  assert.ok(
    !result.shapes.some((shape) => shape.kind === 'line' && shape.start.y === shape.end.y && shape.bindingId === 'A1')
  )
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
  const loads = result.shapes.filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device')
  assert.deepEqual(
    loads.map((shape) => (shape.kind === 'symbol' ? shape.path : '')),
    [lampPath, spotPath]
  )
  const [lamp, spot] = loads
  assert.ok(lamp?.kind === 'symbol' && spot?.kind === 'symbol' && lamp.position.y - 12 - (spot.position.y + 12) >= 8)
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
  assert.ok(!result.shapes.some((shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device'))
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
    familyComponents: [
      {
        bindingId: 'U',
        kind: 'load',
        sourceShapeId: 'inverter',
        sourcePath: 'symbols/Consumption appliances/PV inverter.svg',
        sourceName: 'PV inverter'
      }
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
  const device = result.shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.id === 'inverter')
  assert.ok(device?.kind === 'symbol')
  assert.equal(device.position.x, 400)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'number-label'))
  assert.ok(
    !result.shapes.some((shape) => shape.kind === 'line' && shape.start.y === shape.end.y && shape.bindingId === 'U')
  )
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
    familyComponents: [
      {
        bindingId: 'ALSB',
        kind: 'load',
        sourceShapeId: 'main-board',
        sourcePath: 'symbols/Distribution boards/Distribution board.svg',
        sourceName: 'Main distribution board'
      }
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
    familyComponents: [
      {
        bindingId: 'C',
        kind: 'empty',
        breakerCurrentA: 20,
        cableSectionMm2: 2.5,
        poles: 2,
        breakerCurve: 'C'
      }
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
  const breaker = result.shapes.find((shape) => shape.sourceLink?.role === 'breaker')
  assert.ok(breaker)
  assert.equal(breaker.sourceLink?.id, 'C')
  assert.equal(result.selectedId, breaker.id)
  assert.ok(!result.shapes.some((shape) => shape.sourceLink?.role === 'label'))
  assert.ok(!result.shapes.some((shape) => shape.kind === 'text' && shape.text === 'C'))
})
