import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import type { Shape, SymbolShape } from '../src/editor/model/types.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { createNativeSelectionChangedPayload } from '../src/editor/interaction/selection-payload.ts'
import { buildOneWireTopology } from '../src/editor/layout/onewire-topology.ts'
import { oneWireTopologyDescriptions } from '../src/editor/layout/protection-descriptions.ts'
import { protectionDescriptionLayout } from '../src/editor/layout/protection-label-layout.ts'
import { symbolTextPresentation } from '../src/editor/symbol-metadata.ts'

const plan = { version: 1 as const, residualBreaker: false, solar: false, consumers: true,
  mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } }
const rail = { start: { x: 80, y: 700 }, end: { x: 920, y: 700 } }
let id = 0
const nextId = () => `description-${++id}`

test('absorbs legacy device captions, keeps custom names and leaves independent text alone', () => {
  const initial = buildOneWireTopology(plan, rail, nextId)
  const device = initial.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape
  delete device.symbolTextOverrides!.description
  const legacy: Shape = { id: 'caption', kind: 'text', position: { x: 300, y: 400 }, text: 'Mijn hoofddiff',
    groupId: device.groupId, generationKey: 'board:main:topology:v27:main-differential-title',
    sourceLink: { kind: 'board', id: 'main', role: 'main-differential-title' } }
  const note: Shape = { id: 'note', kind: 'text', text: 'Vrije notitie', position: { x: 20, y: 30 } }
  const restored = sanitizeShapes([...initial, legacy, note])
  const restoredDevice = restored.find((shape) => shape.id === device.id) as SymbolShape
  assert.equal(restoredDevice.symbolTextOverrides?.description, 'Mijn hoofddiff')
  assert.equal(restored.some((shape) => shape.id === legacy.id), false)
  assert.ok(restored.some((shape) => shape.id === note.id))
  assert.deepEqual(sanitizeShapes(restored), restored)
})

test('edits the device name without losing ratings, moves it with the device and preserves a cleared name', () => {
  const initial = buildOneWireTopology(plan, rail, nextId)
  const device = initial.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape
  const context = { selectedIds: new Set([device.id]), selectedId: device.id, groupedSelection: false }
  const selection = createNativeSelectionChangedPayload(device, 1, { circuitPropertiesEditable: true })
  assert.deepEqual(selection.shape?.symbolTextFields, [{ key: 'description', label: 'Benaming', value: 'Hoofddiff.' }])
  const renamed = updateSelectionProperties(initial, { symbolTextOverrides: { description: 'Algemeen <A&B>' } }, context)!
  const renamedDevice = renamed.find((shape) => shape.id === device.id) as SymbolShape
  assert.equal(renamedDevice.symbolTextOverrides?.['residual-current'], '300mA')
  assert.equal(renamedDevice.symbolTextOverrides?.['rated-current'], '40A')
  assert.equal(device.symbolTextOverrides?.description, 'Hoofddiff.')
  const presentation = symbolTextPresentation(renamedDevice)
  assert.doesNotMatch(presentation.inner, /Algemeen/)
  assert.match(presentation.annotations, /font-weight="600"[^>]*>Algemeen &lt;A&amp;B&gt;<\/text>/)
  const moved = updateSelectionProperties(renamed, { x: device.position.x + 100, y: device.position.y + 80 }, context)!
  const movedDevice = moved.find((shape) => shape.id === device.id) as SymbolShape
  const before = protectionDescriptionLayout(renamedDevice)!
  const after = protectionDescriptionLayout(movedDevice)!
  assert.ok(Math.abs(after.x - before.x - 100) < 1e-9)
  assert.ok(Math.abs(after.y - before.y - 80) < 1e-9)
  const cleared = updateSelectionProperties(moved, { symbolTextOverrides: { description: '' } }, context)!
  const restored = sanitizeShapes(cleared)
  const regenerated = buildOneWireTopology(plan, rail, nextId, { descriptionsByRole: oneWireTopologyDescriptions(restored) })
  const main = regenerated.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape
  assert.equal(main.symbolTextOverrides?.description, '')
  assert.doesNotMatch(symbolTextPresentation(main).annotations, /onewire-device-description/)
  const custom = buildOneWireTopology(plan, rail, nextId, { descriptionsByRole: oneWireTopologyDescriptions(renamed) })
  assert.equal((custom.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape).symbolTextOverrides?.description, 'Algemeen <A&B>')
})
