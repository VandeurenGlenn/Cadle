import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuits, bomRowsToCsv, circuitBomRows } from '../src/native-app/circuit-analysis.ts'
import type { Shape } from '../src/native-draw/types.ts'
import { electricalMetadataFromCatalog } from '../src/native-draw/electrical.ts'

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
  assert.match(analysis.issues[0].message, /letters followed by a circuit number/)
})

test('exports escaped BOM rows as CSV', () => {
  const analysis = analyzeCircuits([
    symbol('load', 'A1', 'Lamp, pendant', 'symbols/Consumption appliances/Lighting.svg')
  ])
  const csv = bomRowsToCsv(circuitBomRows(analysis))
  assert.match(csv, /^Binding ID,Family,Switches,Loads,Other,Total,Components/m)
  assert.match(csv, /"Lamp, pendant"/)
})

test('prefers explicit electrical metadata and derives circuit specifications', () => {
  const configured = {
    ...symbol('configured', 'D1', 'Custom appliance', 'symbols/Custom/device.svg'),
    electrical: {
      role: 'load' as const,
      oneWireEligible: true,
      circuitType: 'motor' as const,
      ratedCurrentA: 25,
      breakerCurrentA: 32,
      cableSectionMm2: 4,
      poles: 4,
      phaseConfiguration: 'three-phase' as const
    }
  }
  const analysis = analyzeCircuits([configured])

  assert.equal(analysis.groups[0].loads, 1)
  assert.deepEqual(analysis.groups[0].specification, {
    circuitType: 'motor',
    breakerCurrentA: 32,
    cableSectionMm2: 4,
    poles: 4,
    phaseConfiguration: 'three-phase',
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
      cableSectionMm2: 2.5,
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

  const analysis = analyzeCircuits([partiallyConfigured])

  assert.equal(analysis.groups[0].specification.breakerCurrentA, 20)
  assert.equal(analysis.groups[0].specification.cableSectionMm2, 2.5)
  assert.equal(analysis.groups[0].specification.poles, 2)
  assert.equal(analysis.groups[0].specification.breakerCurve, 'C')
  assert.equal(analysis.groups[0].specification.source, 'suggested')
  assert.equal(analysis.groups[0].specification.sources.breakerCurrentA, 'entered')
  assert.equal(analysis.groups[0].specification.sources.cableSectionMm2, 'suggested')
})

test('rejects conflicting explicit circuit specifications', () => {
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

  assert.equal(analysis.valid, false)
  assert.equal(analysis.errorCount, 1)
  assert.match(analysis.issues[0].message, /breaker current, cable section/)
})
