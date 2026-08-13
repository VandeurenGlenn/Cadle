import assert from 'node:assert/strict'
import test from 'node:test'
import { validateOneWireTopology } from '../src/editor/onewire-topology-schema.ts'

test('accepts strict model output for a one-wire topology', () => {
  const result = validateOneWireTopology({
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
    mainSwitch: { ratedCurrentA: 25 },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential',
    additionalDifferentials: [
      { count: 2, sensitivityMa: 30, purpose: 'consumers' },
      { count: 1, sensitivityMa: 30, ratedCurrentA: 40, purpose: 'ev' }
    ]
  })
  assert.equal(result.valid, true)
})

test('validates the structured hoofdschakelaar', () => {
  assert.equal(validateOneWireTopology({
    version: 1,
    mainSwitch: {
      ratedCurrentA: 25,
      manufacturer: 'Schneider Electric',
      neutralPosition: 'left'
    },
    residualBreaker: false,
    solar: false,
    consumers: false
  }).valid, true)

  const invalid = validateOneWireTopology({
    version: 1,
    mainSwitch: { ratedCurrentA: 0 },
    residualBreaker: false,
    solar: false,
    consumers: false
  })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some((error) => error.includes('mainSwitch.ratedCurrentA')))
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

test('rejects unsafe additional differential counts and purposes', () => {
  const result = validateOneWireTopology({
    version: 1,
    residualBreaker: true,
    solar: false,
    consumers: true,
    additionalDifferentials: [{ count: 20, sensitivityMa: 30, purpose: 'pool' }]
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('count')))
  assert.ok(result.errors.some((error) => error.includes('purpose')))
})

test('accepts manufacturer and neutral-position metadata', () => {
  const result = validateOneWireTopology({
    version: 1,
    residualBreaker: true,
    residualBreakerManufacturer: 'Schneider Electric',
    residualBreakerNeutralPosition: 'left',
    solar: true,
    solarBreakerManufacturer: 'TECO',
    solarBreakerNeutralPosition: 'right',
    consumers: true,
    mainDifferential: {
      ratedCurrentA: 40,
      sensitivityMa: 300,
      manufacturer: 'Schneider Electric',
      neutralPosition: 'left'
    },
    additionalDifferentials: [{
      count: 1,
      sensitivityMa: 30,
      purpose: 'consumers',
      manufacturer: 'TECO',
      neutralPosition: 'right'
    }]
  })

  assert.equal(result.valid, true)
})
