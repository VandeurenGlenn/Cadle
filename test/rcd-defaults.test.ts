import assert from 'node:assert/strict'
import test from 'node:test'
import { electricalMetadataFromCatalog, rcdTypeLabel } from '../src/editor/model/electrical.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import { effectiveSelectionElectrical } from '../src/elements/panes/object-pane/electrical-model.ts'
import { normalizeElectricalProfile } from '../src/editor/electrical-profile.ts'
import { buildOneWireTopology, oneWireTopologyRcdTypes } from '../src/editor/layout/onewire-topology.ts'
import { validateOneWireTopology } from '../src/editor/onewire-topology-schema.ts'
import { symbolTextLayer } from '../src/editor/symbol-metadata.ts'
import type { OneWireTopologyPlan } from '../src/types.ts'
import type { SymbolShape } from '../src/editor/model/types.ts'

const path = 'symbols/Protection devices/Residual-current circuit breaker.svg'

test('uses Type A for an unspecified RCD in the catalog, properties and visible labels', () => {
  assert.equal(electricalMetadataFromCatalog(undefined, 'RCD', path).rcdType, 'A')
  assert.equal(effectiveSelectionElectrical({}, 'RCD', path).rcdType, 'A')
  assert.equal(rcdTypeLabel(), 'Type A')
  assert.match(symbolTextLayer(path), />Type A</)
  assert.equal(electricalMetadataFromCatalog(undefined, 'Automaat', 'symbols/Protection devices/Automaat.svg').rcdType, undefined)
  for (const type of ['AC', 'F', 'B', 'other'] as const) {
    assert.equal(electricalMetadataFromCatalog({ rcdType: type }, 'RCD', path).rcdType, type)
    assert.equal(effectiveSelectionElectrical({ rcdType: type }, 'RCD', path).rcdType, type)
  }
})

test('fills a missing saved RCD type while keeping an explicit legacy classification', () => {
  const source: SymbolShape = { id: 'rcd', kind: 'symbol', path, name: 'RCD', position: { x: 0, y: 0 }, scale: 2,
    electrical: { role: 'protection', oneWireEligible: true } }
  const restored = sanitizeShapes([source])[0] as SymbolShape
  assert.equal(restored.electrical?.rcdType, 'A')
  const legacy = sanitizeShapes([{ ...source, symbolTextOverrides: { 'rcd-type': 'Type F' } }])[0] as SymbolShape
  assert.equal(legacy.electrical?.rcdType, 'F')
})

test('defaults board differentials to A without replacing existing B/F/AC choices', () => {
  const profile = normalizeElectricalProfile(undefined)
  profile.boards![0].mainDifferential = { id: 'main', ratedCurrentA: 40, sensitivityMa: 300, poles: 2 }
  profile.boards![0].additionalDifferentials = [{ id: 'extra', ratedCurrentA: 40, sensitivityMa: 30, poles: 2, type: 'B' }]
  const normalized = normalizeElectricalProfile(profile)
  assert.equal(normalized.boards![0].mainDifferential?.type, 'A')
  assert.equal(normalized.boards![0].additionalDifferentials![0].type, 'B')
})

test('generates Type A defaults and preserves explicit types across topology regeneration', () => {
  const plan: OneWireTopologyPlan = { version: 1, residualBreaker: false, solar: false, consumers: true,
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    additionalDifferentials: [{ count: 1, sensitivityMa: 30, purpose: 'consumers' }] }
  let id = 0
  const rail = { start: { x: 80, y: 700 }, end: { x: 920, y: 700 } }
  const initial = buildOneWireTopology(plan, rail, () => `id-${++id}`)
  const rcds = initial.filter((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.path === path)
  assert.equal(rcds.length, 2)
  assert.ok(rcds.every((shape) => shape.electrical?.rcdType === 'A' && shape.symbolTextOverrides?.['rcd-type'] === 'Type A'))
  rcds[0].electrical!.rcdType = 'F'
  const previousTypes = oneWireTopologyRcdTypes(initial)
  const regenerated = buildOneWireTopology(plan, rail, () => `id-${++id}`, { rcdTypesByRole: previousTypes })
  const main = regenerated.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape
  assert.equal(main.electrical?.rcdType, 'F')
  assert.equal(main.symbolTextOverrides?.['rcd-type'], 'Type F')
  plan.mainDifferential!.rcdType = 'B'
  plan.additionalDifferentials![0].rcdType = 'AC'
  assert.equal(validateOneWireTopology(plan).valid, true)
  const explicit = buildOneWireTopology(plan, rail, () => `id-${++id}`, { rcdTypesByRole: previousTypes })
  assert.equal((explicit.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape).electrical?.rcdType, 'B')
  assert.equal(validateOneWireTopology({ ...plan, mainDifferential: { ...plan.mainDifferential, rcdType: 'invalid' } }).valid, false)
})
