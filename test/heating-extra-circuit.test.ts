import assert from 'node:assert/strict'
import test from 'node:test'
import { heatingPlanScore, heatingPlanningSettings, type AutomaticHeatingResult } from '../src/editor/automatic-heating-plan.ts'
import { heatingDefaults, sanitizeHeating } from '../src/editor/heating-plan.ts'

test('one extra circuit is available before permitting longer circuits and survives reloading without growing again', () => {
  const input = { diameterMm: 16, spacingMm: 100, capacity: 12, allowExtraCircuit: true, allowLongerCircuits: true }
  const settings = heatingPlanningSettings(input)
  assert.equal(settings.capacity, 13)
  assert.equal(settings.preferredCircuitLengthM, 100)
  assert.equal(settings.design?.maxCircuitLengthM, 120)
  const saved = sanitizeHeating(JSON.parse(JSON.stringify({ ...heatingDefaults('manifold'), ...settings })))!
  assert.equal(heatingPlanningSettings(saved).capacity, 13)
  assert.equal(saved.preferredCapacity, 12)
  assert.equal(input.capacity, 12)
  assert.equal(heatingPlanningSettings(input, false).capacity, 12, 'locked circuits keep their ports')
  assert.equal(heatingPlanningSettings({ ...input, allowExtraCircuit: false }).capacity, 12)
  assert.equal(heatingPlanningSettings({ ...input, capacity: 24 }).capacity, 24)
  assert.throws(() => heatingPlanningSettings({ ...input, capacity: 0 }), /capaciteit/)
})

test('a selected pipe product keeps its declared length limit', () => {
  const settings = heatingPlanningSettings({ diameterMm: 16, spacingMm: 100, capacity: 12, allowExtraCircuit: true,
    allowLongerCircuits: true, design: { product: 'Selected pipe', maxCircuitLengthM: 90 } })
  assert.equal(settings.capacity, 13)
  assert.equal(settings.design?.maxCircuitLengthM, 90)
})

const proposal = (count: number, totalM: number, leadsM: number): AutomaticHeatingResult => ({
  shapes: [], wallCrossings: 0, tableOnSeparatePage: true,
  rows: Array.from({ length: count }, (_, i) => ({ id: `VV${i + 1}`, room: 'Test', diameterMm: 16, spacingMm: 100,
    areaM2: 8, loopM: totalM - leadsM, supplyM: leadsM / 2, returnM: leadsM / 2, totalM, cutM: totalM, flowLmin: 1 }))
})
const earlier = (a: number[], b: number[]) => {
  const difference = a.map((value, i) => value - b[i]).find((value) => Math.abs(value) > 1e-6)
  return difference !== undefined && difference < 0
}
test('thirteen shorter complete circuits beat twelve longer ones despite extra lead metres', () => {
  for (const longer of [98, 115]) {
    assert.ok(earlier(heatingPlanScore(proposal(13, 90, 12)), heatingPlanScore(proposal(12, longer, 6))))
  }
  assert.ok(earlier(heatingPlanScore(proposal(12, 90, 10)), heatingPlanScore(proposal(13, 90, 10))), 'equal quality does not add an unnecessary circuit')
})
