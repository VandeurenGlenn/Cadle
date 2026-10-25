import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeElectricalProfile } from '../src/editor/electrical-profile.ts'

test('keeps distributor and Belgian supply configuration in the project profile', () => {
  const profile = normalizeElectricalProfile({
    standard: 'AREI',
    edition: 'Book 1',
    distributor: ' Fluvius ',
    supplyConfiguration: '3x400V+N',
    supplyVoltageV: 400,
    phaseConfiguration: 'three-phase',
    earthingSystem: 'TT',
    defaultPoles: 4,
    boards: [
      {
        id: 'main',
        name: 'Main board',
        rails: [{ id: 'rail-1', name: 'Rail 1' }],
        mainDifferential: { id: 'main-rcd', ratedCurrentA: 40, sensitivityMa: 300, poles: 4, type: 'A' }
      }
    ]
  })
  assert.equal(profile.distributor, 'Fluvius')
  assert.equal(profile.supplyConfiguration, '3x400V+N')
  assert.equal(profile.phaseConfiguration, 'L1+L2+L3+N')
  assert.equal(profile.boards?.[0].mainDifferential?.sensitivityMa, 300)
})

test('keeps supply and phase defaults electrically consistent', () => {
  const singlePhase = normalizeElectricalProfile({
    ...normalizeElectricalProfile(undefined),
    supplyConfiguration: '1x230V+N',
    phaseConfiguration: 'single-phase'
  })
  const threePhase = normalizeElectricalProfile({
    ...normalizeElectricalProfile(undefined),
    supplyConfiguration: '3x230V',
    phaseConfiguration: 'single-phase'
  })

  assert.equal(singlePhase.phaseConfiguration, 'L1+N')
  assert.equal(threePhase.phaseConfiguration, 'three-phase')
})
