import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuits, bomRowsToCsv, circuitBomRows } from '../src/editor/circuit-analysis.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { electricalMetadataFromCatalog } from '../src/editor/model/electrical.ts'

const symbol = (id: string, bindingId: string, name: string, path: string): Shape => ({
  id,
  kind: 'symbol',
  position: { x: 0, y: 0 },
  scale: 1,
  bindingId,
  name,
  path
})

test('groups floor-plan devices and ignores generated one-wire geometry', () => {
  const generated = {
    ...symbol('generated', 'A1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg'),
    groupId: 'onewire-1'
  }
  const analysis = analyzeCircuits([
    symbol('switch', 'a1', 'Switch', 'symbols/Switches/Switch general symbol.svg'),
    symbol('lamp-1', 'A1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg'),
    symbol('lamp-2', 'A1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg'),
    symbol('socket', 'B2', 'Wall outlet', 'symbols/Socket outlets/Electrical wall outlet.svg'),
    generated
  ])

  assert.equal(analysis.totalGroups, 2)
  assert.equal(analysis.readyGroups, 2)
  assert.deepEqual(analysis.families, ['A', 'B'])
  assert.deepEqual(
    analysis.groups.map(({ bindingId, switches, loads }) => ({ bindingId, switches, loads })),
    [
      { bindingId: 'A1', switches: 1, loads: 2 },
      { bindingId: 'B2', switches: 0, loads: 1 }
    ]
  )
  assert.equal(analysis.groups[0].specification.circuitType, 'lighting')
  assert.equal(analysis.groups[0].specification.breakerCurrentA, 16)
  assert.equal(analysis.groups[0].specification.cableSectionMm2, 1.5)
  assert.equal(analysis.groups[0].specification.breakerCurve, 'C')
  assert.equal(analysis.groups[1].specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[1].specification.cableSectionMm2, 2.5)
})

test('keeps the original path for imported ground-plan images', () => {
  const sourcePath = 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg'
  const analysis = analyzeCircuits([
    {
      id: 'outlet-image',
      kind: 'image',
      position: { x: 0, y: 0 },
      width: 24,
      height: 24,
      bindingId: 'H',
      name: 'Multiple grounded outlets',
      path: sourcePath
    }
  ])

  assert.equal(analysis.groups[0]?.components[0]?.path, sourcePath)
  assert.equal(analysis.groups[0]?.specification.circuitType, 'sockets')
  assert.equal(analysis.groups[0]?.specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0]?.specification.cableSectionMm2, 2.5)
})

test('recovers legacy custom sockets that were stored with the neutral role', () => {
  const outlet = symbol(
    'legacy-outlet',
    'H',
    'Wall outlet with grounding',
    'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg'
  )
  if (outlet.kind === 'symbol') {
    outlet.electrical = {
      role: 'neutral',
      oneWireEligible: true,
      circuitType: 'sockets'
    }
  }

  const analysis = analyzeCircuits([outlet])
  assert.equal(analysis.valid, true)
  assert.equal(analysis.groups[0]?.loads, 1)
  assert.equal(analysis.groups[0]?.specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0]?.specification.cableSectionMm2, 2.5)
})

test('accepts a deliberately unloaded breaker circuit', () => {
  const analysis = analyzeCircuits([
    symbol('breaker', 'R1', 'Automaat', 'symbols/Protection devices/Automaat.svg')
  ])
  assert.equal(analysis.valid, true)
  assert.equal(analysis.errorCount, 0)
  assert.equal(analysis.groups[0]?.protection, 1)
  assert.equal(analysis.groups[0]?.ready, true)
})

test('reports incomplete and unknown circuit symbols', () => {
  const analysis = analyzeCircuits([
    symbol('switch', 'A3', 'Switch', 'symbols/Switches/Switch general symbol.svg'),
    symbol('unknown', 'C1', 'Mystery device', 'symbols/Misc/Mystery.svg')
  ])

  assert.equal(analysis.valid, false)
  assert.equal(analysis.errorCount, 2)
  assert.equal(analysis.warningCount, 1)
  assert.equal(analysis.groups[0].ready, false)
})

test('reports malformed binding IDs instead of silently dropping devices', () => {
  const analysis = analyzeCircuits([
    symbol('invalid', 'kitchen', 'Lighting', 'symbols/Consumption appliances/Lighting.svg')
  ])
  assert.equal(analysis.totalGroups, 0)
  assert.equal(analysis.errorCount, 1)
  assert.match(analysis.issues[0].message, /short circuit code/)
})

test('accepts short letter-only circuit codes used on Belgian plans', () => {
  const analysis = analyzeCircuits([
    symbol('load-o', 'O', 'Lighting', 'symbols/Consumption appliances/Lighting.svg'),
    symbol('load-alsb', 'alsb', 'Socket', 'symbols/Consumption appliances/Socket.svg')
  ])

  assert.equal(analysis.valid, true)
  assert.equal(analysis.errorCount, 0)
  assert.deepEqual(
    analysis.groups.map(({ bindingId, family, number }) => ({ bindingId, family, number })),
    [
      { bindingId: 'ALSB', family: 'ALSB', number: null },
      { bindingId: 'O', family: 'O', number: null }
    ]
  )
})

test('ignores earthing symbols and recognises boards and PV inverters', () => {
  const analysis = analyzeCircuits([
    symbol('earth', 'AB', 'Earthing', 'symbols/Earthing/Aarding.svg'),
    symbol('sub-board', 'ALSB', 'Distribution board', 'symbols/Boards/Distribution board.svg'),
    symbol('board-t', 'T', 'Verdeelbord', 'symbols/Boards/Verdeelbord.svg'),
    symbol('pv', 'U', 'PV inverter', 'symbols/Consumption appliances/PV inverter.svg')
  ])

  assert.equal(analysis.valid, true)
  assert.equal(analysis.errorCount, 0)
  assert.equal(analysis.warningCount, 0)
  assert.deepEqual(analysis.groups.map((group) => group.bindingId), ['ALSB', 'T', 'U'])
  assert.equal(analysis.readyGroups, 3)
  assert.equal(analysis.groups.find((group) => group.bindingId === 'ALSB')?.junctions, 1)
  assert.equal(analysis.groups.find((group) => group.bindingId === 'U')?.loads, 1)
})

test('exports escaped BOM rows as CSV', () => {
  const analysis = analyzeCircuits([
    symbol('load', 'A1', 'Lamp, pendant', 'symbols/Consumption appliances/Lighting.svg')
  ])
  const csv = bomRowsToCsv(circuitBomRows(analysis))
  assert.match(csv, /^Binding ID,Family,Switches,Loads,Other,Total,Components/m)
  assert.match(csv, /"Lamp, pendant"/)
})

test('uses project-level circuit specifications without storing them on symbols', () => {
  const configured = {
    ...symbol('configured', 'D1', 'Custom appliance', 'symbols/Custom/device.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'motor' as const,
      ratedCurrentA: 25,
      breakerCurrentA: 99,
      cableSectionMm2: 99
    }
  }
  const analysis = analyzeCircuits([configured], undefined, {
    D: {
      breakerCurrentA: 32,
      cableSectionMm2: 4,
      hasProtectiveConductor: false,
      poles: 4,
      phaseConfiguration: 'three-phase'
    }
  })

  assert.equal(analysis.groups[0].loads, 1)
  assert.deepEqual(analysis.groups[0].specification, {
    circuitType: 'motor',
    breakerCurrentA: 32,
    cableSectionMm2: 4,
    cableConductors: 5,
    hasProtectiveConductor: false,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    showCableInstallation: true,
    poles: 4,
    phaseConfiguration: 'three-phase',
    showPhaseLabel: true,
    breakerCurve: 'C',
    source: 'explicit',
    sources: {
      breakerCurrentA: 'entered', cableSectionMm2: 'entered', poles: 'entered', phaseConfiguration: 'entered'
    }
  })
})

test('normalizes catalog electrical metadata and keeps legacy inference as fallback', () => {
  assert.deepEqual(
    electricalMetadataFromCatalog(
      {
        electrical: {
          role: 'load',
          circuitType: 'sockets',
          oneWireEligible: true,
          ratedCurrentA: 20,
          breakerCurrentA: 25,
          cableSectionMm2: 2.5
        }
      },
      'Custom socket',
      'symbols/custom.svg'
    ),
    {
      role: 'load',
      circuitType: 'sockets',
      oneWireEligible: true,
      ratedCurrentA: 20,
      breakerCurrentA: 25,
      poles: undefined,
      phaseConfiguration: undefined,
      showPhaseLabel: undefined,
      cableSectionMm2: 2.5,
      cableConductors: undefined,
      hasProtectiveConductor: undefined,
      cableType: undefined,
      cableInstallation: undefined,
      showCableInstallation: undefined,
      breakerCurve: undefined,
      rcdSensitivityMa: undefined,
      rcdType: undefined,
      boardId: undefined,
      railId: undefined,
      notes: undefined
    }
  )
  assert.equal(electricalMetadataFromCatalog(undefined, 'Wall switch', 'symbols/Switches/general.svg').role, 'switch')
})

test('excludes symbols explicitly opted out of one-wire generation', () => {
  const excluded = {
    ...symbol('annotation', 'A1', 'Floor-plan annotation', 'symbols/custom/annotation.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: false,
      circuitType: 'other' as const
    }
  }
  const analysis = analyzeCircuits([
    excluded,
    symbol('lamp', 'B1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg')
  ])

  assert.deepEqual(
    analysis.groups.map((group) => group.bindingId),
    ['B1']
  )
  assert.equal(analysis.valid, true)
})

test('preserves legacy door, gate, and image bindings', () => {
  const analysis = analyzeCircuits([
    { id: 'door', kind: 'door', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, bindingId: 'A1' },
    { id: 'gate', kind: 'gate', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, bindingId: 'A1' },
    {
      id: 'image',
      kind: 'image',
      position: { x: 0, y: 0 },
      name: 'Legacy appliance',
      path: 'data:image/png;base64,AA==',
      width: 10,
      height: 10,
      bindingId: 'A1'
    }
  ])

  assert.equal(analysis.groups[0].switches, 2)
  assert.equal(analysis.groups[0].loads, 1)
  assert.equal(analysis.valid, true)
})

test('does not use a device rated current as its breaker current', () => {
  const ratedLoad = {
    ...symbol('motor', 'M1', 'Motor', 'symbols/Motors/motor.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'motor' as const,
      ratedCurrentA: 25
    }
  }
  const analysis = analyzeCircuits([ratedLoad])

  assert.equal(analysis.groups[0].specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0].specification.source, 'suggested')
  assert.equal(analysis.groups[0].specification.sources.breakerCurrentA, 'suggested')
})

test('uses project phase and pole defaults with field-level provenance', () => {
  const analysis = analyzeCircuits(
    [symbol('lamp', 'A1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg')],
    { standard: 'AREI', edition: 'Book 1', distributor: 'Fluvius', supplyConfiguration: '3x400V+N', supplyVoltageV: 400, phaseConfiguration: 'three-phase', earthingSystem: 'TT', defaultPoles: 4 }
  )
  assert.equal(analysis.groups[0].specification.phaseConfiguration, 'three-phase')
  assert.equal(analysis.groups[0].specification.poles, 4)
  assert.equal(analysis.groups[0].specification.sources.phaseConfiguration, 'project')
  assert.equal(analysis.groups[0].specification.sources.poles, 'project')
})

test('keeps partially entered circuit specifications marked as suggested', () => {
  const partiallyConfigured = {
    ...symbol('socket', 'S1', 'Socket', 'symbols/Socket outlets/socket.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'sockets' as const,
      breakerCurrentA: 20
    }
  }

  const analysis = analyzeCircuits([partiallyConfigured], undefined, {
    S: { breakerCurrentA: 20 }
  })

  assert.equal(analysis.groups[0].specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0].specification.cableSectionMm2, 2.5)
  assert.equal(analysis.groups[0].specification.poles, 2)
  assert.equal(analysis.groups[0].specification.breakerCurve, 'C')
  assert.equal(analysis.groups[0].specification.source, 'suggested')
  assert.equal(analysis.groups[0].specification.sources.breakerCurrentA, 'entered')
  assert.equal(analysis.groups[0].specification.sources.cableSectionMm2, 'suggested')
})

test('ignores legacy one-wire values stored on ground-plan symbols', () => {
  const first = {
    ...symbol('first', 'A1', 'Socket 1', 'symbols/Socket outlets/socket.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'sockets' as const,
      breakerCurrentA: 16,
      cableSectionMm2: 2.5
    }
  }
  const second = {
    ...symbol('second', 'A1', 'Socket 2', 'symbols/Socket outlets/socket.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'sockets' as const,
      breakerCurrentA: 20,
      cableSectionMm2: 4
    }
  }
  const analysis = analyzeCircuits([first, second])

  assert.equal(analysis.valid, true)
  assert.equal(analysis.errorCount, 0)
  assert.equal(analysis.groups[0].specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0].specification.cableSectionMm2, 2.5)
})
