import assert from 'node:assert/strict'
import test from 'node:test'
import { electricalSupplyLabel, normalizeElectricalProfile } from '../src/editor/electrical-profile.ts'
import { phaseConfigurationLabelForPoles } from '../src/editor/model/electrical.ts'

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

test('formats the configured grid voltage for a one-wire label', () => {
  const profile = normalizeElectricalProfile(undefined)
  assert.equal(electricalSupplyLabel({ ...profile, supplyConfiguration: '3x400V+N', supplyVoltageV: 400 }), '3x400V+N')
  assert.equal(electricalSupplyLabel({ ...profile, supplyConfiguration: 'other', supplyVoltageV: 230,
    phaseConfiguration: 'L1+N' }), '230V · L1+N')
  assert.equal(electricalSupplyLabel(undefined), undefined)
})

test('does not label a two-pole device with all three phases', () => {
  assert.equal(phaseConfigurationLabelForPoles(2, 'L1+L2+L3+N', 'left'), '')
  assert.equal(phaseConfigurationLabelForPoles(2, 'L1+N', 'left'), 'N-L1')
  assert.equal(phaseConfigurationLabelForPoles(3, 'L1+L2+L3+N', 'left'), 'L1-L2-L3')
  assert.equal(phaseConfigurationLabelForPoles(4, 'L1+N', 'left'), '')
})
