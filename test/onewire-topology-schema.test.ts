import assert from 'node:assert/strict'
import test from 'node:test'
import { validateOneWireTopology } from '../src/editor/onewire-topology-schema.ts'

test('accepts strict model output for a one-wire topology', () => {
  const result = validateOneWireTopology({
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential'
  })
  assert.equal(result.valid, true)
})

test('rejects unsafe or incomplete model output', () => {
  const result = validateOneWireTopology({
    version: 1,
    residualBreaker: 'yes',
    solar: true
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.length >= 2)
})
