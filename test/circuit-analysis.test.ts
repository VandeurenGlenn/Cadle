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
  const generated = { ...symbol('generated', 'A1', 'Lighting', 'symbols/Consumption appliances/Lighting.svg'), groupId: 'onewire-1' }
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
  const analysis = analyzeCircuits([symbol('load', 'A1', 'Lamp, pendant', 'symbols/Consumption appliances/Lighting.svg')])
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
      cableSectionMm2: 4,
      poles: 4,
      phaseConfiguration: 'three-phase' as const
    }
  }
  const analysis = analyzeCircuits([configured])

  assert.equal(analysis.groups[0].loads, 1)
  assert.deepEqual(analysis.groups[0].specification, {
    circuitType: 'motor',
    breakerCurrentA: 25,
    cableSectionMm2: 4,
    poles: 4,
    phaseConfiguration: 'three-phase',
    source: 'explicit'
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
      poles: undefined,
      phaseConfiguration: undefined,
      cableSectionMm2: 2.5
    }
  )
  assert.equal(
    electricalMetadataFromCatalog(undefined, 'Wall switch', 'symbols/Switches/general.svg').role,
    'switch'
  )
})
