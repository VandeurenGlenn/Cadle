import assert from 'node:assert/strict'
import test from 'node:test'
import { assessOneWireCapacity } from '../src/editor/onewire-capacity.ts'

test('adds the grid and PV protection currents without a downstream limiter', () => {
  const assessment = assessOneWireCapacity({
    version: 1,
    gridProtectionCurrentA: 40,
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: false,
    solar: true,
    solarBreakerRatedCurrentA: 20,
    consumers: true,
    additionalDifferentials: [
      { count: 2, ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' }
    ]
  })

  assert.equal(assessment.status, 'overload')
  assert.equal(assessment.sourceCurrentA, 60)
  assert.equal(assessment.downstreamLimitA, 60)
  assert.equal(assessment.lowestDifferentialRatingA, 40)
  assert.equal(assessment.upgradeCandidateA, 63)
  assert.match(assessment.detail, /kandidaat diff 63 A na materiaalcontrole/i)
})

test('a correctly placed remautomaat limits the only feeder to the downstream rail', () => {
  const assessment = assessOneWireCapacity({
    version: 1,
    gridProtectionCurrentA: 40,
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    residualBreakerRatedCurrentA: 40,
    solar: true,
    solarBreakerRatedCurrentA: 20,
    consumers: true,
    additionalDifferentials: [
      { count: 1, ratedCurrentA: 40, sensitivityMa: 30, purpose: 'consumers' }
    ]
  })

  assert.equal(assessment.status, 'limited')
  assert.equal(assessment.sourceCurrentA, 60)
  assert.equal(assessment.downstreamLimitA, 40)
  assert.match(assessment.detail, /enige voeding/i)
})

test('does not claim the installation is safe when the grid protection is unknown', () => {
  const assessment = assessOneWireCapacity({
    version: 1,
    residualBreaker: false,
    solar: true,
    consumers: true
  })

  assert.equal(assessment.status, 'unknown')
  assert.equal(assessment.sourceCurrentA, undefined)
  assert.match(assessment.message, /onbekend/i)
})

test('selects the next standard candidate but keeps it conditional', () => {
  const assessment = assessOneWireCapacity({
    version: 1,
    gridProtectionCurrentA: 63,
    mainDifferential: { ratedCurrentA: 63, sensitivityMa: 300 },
    residualBreaker: false,
    solar: true,
    solarBreakerRatedCurrentA: 20,
    consumers: true,
    additionalDifferentials: [
      { count: 1, ratedCurrentA: 63, sensitivityMa: 30, purpose: 'consumers' }
    ]
  })

  assert.equal(assessment.sourceCurrentA, 83)
  assert.equal(assessment.upgradeCandidateA, 100)
  assert.match(assessment.detail, /na materiaalcontrole/i)
})
