import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeElectricalProfile } from '../src/native-app/electrical-profile.ts'

test('keeps distributor and Belgian supply configuration in the project profile', () => {
  const profile = normalizeElectricalProfile({
    standard: 'AREI',
    edition: 'Book 1',
    distributor: ' Fluvius ',
    supplyConfiguration: '3x400V+N',
    supplyVoltageV: 400,
    phaseConfiguration: 'three-phase',
    earthingSystem: 'TT',
    defaultPoles: 4
  })
  assert.equal(profile.distributor, 'Fluvius')
  assert.equal(profile.supplyConfiguration, '3x400V+N')
})
