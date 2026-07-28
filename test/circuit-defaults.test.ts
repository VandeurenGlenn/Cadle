import assert from 'node:assert/strict'
import test from 'node:test'
import {
  circuitDefaults,
  defaultHasProtectiveConductor
} from '../src/editor/circuit-defaults.js'

test('uses Belgian residential defaults for lighting circuits', () => {
  assert.deepEqual(circuitDefaults('lighting'), {
    breakerCurrentA: 16,
    cableSectionMm2: 1.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    poles: 2,
    phaseConfiguration: 'single-phase',
    breakerCurve: 'C',
    boardId: 'main',
    railId: 'rail-1'
  })
})

test('keeps higher-load defaults for socket circuits', () => {
  const defaults = circuitDefaults('sockets')
  assert.equal(defaults.breakerCurrentA, 20)
  assert.equal(defaults.cableSectionMm2, 2.5)
})

test('defaults four-conductor cables to X notation', () => {
  assert.equal(defaultHasProtectiveConductor(4), false)
  assert.equal(defaultHasProtectiveConductor(3), true)
  assert.equal(defaultHasProtectiveConductor(5), true)
})
