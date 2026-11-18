import assert from 'node:assert/strict'
import test from 'node:test'
import { oneWireSourceFingerprint, projectFromRecoveryPoint, projectWithRecoveryPoint } from '../src/data/project-recovery.ts'
import type { Project } from '../src/types.ts'

const pageKey = '00000000-0000-4000-8000-000000000001'
const project = (): Project => ({
  uuid: '00000000-0000-4000-8000-000000000000', creationTime: 1, name: 'Recovery',
  customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' },
  company: '', address: { street: '', number: '', postalCode: '', city: '' },
  circuitSpecifications: { A: { cableSectionMm2: 2.5 } },
  pages: {
    [pageKey]: { creationTime: 1, name: 'Ground', pageType: 'groundplan', schema: { version: 'native-svg-1', objects: [] } },
    schematic: { creationTime: 2, name: 'Schema', pageType: 'onewire', schema: { version: 'native-svg-1', objects: [] } }
  }
})

test('recovery points clone all pages and circuit metadata without nesting history', () => {
  const saved = projectWithRecoveryPoint(project(), pageKey, 'Before')
  const id = saved.recovery![0].id
  saved.pages[pageKey].name = 'Changed'
  delete saved.pages.schematic
  saved.circuitSpecifications!.A.cableSectionMm2 = 6
  const withSecond = projectWithRecoveryPoint(saved, pageKey, 'After')
  const restored = projectFromRecoveryPoint(withSecond, id)
  assert.deepEqual(restored.project.pages, project().pages)
  assert.deepEqual(restored.project.circuitSpecifications, project().circuitSpecifications)
  assert.equal(restored.pageKey, pageKey)
  assert.equal(restored.project.recovery?.length, 2)
  for (const entry of restored.project.recovery!) assert.equal('recovery' in entry.project, false)
  restored.project.pages[pageKey].name = 'Another change'
  assert.equal(withSecond.recovery![1].project.pages[pageKey].name, 'Ground')
})

test('recovery retention is bounded and missing recovery points fail explicitly', () => {
  let saved = project()
  for (let index = 0; index < 12; index++) saved = projectWithRecoveryPoint(saved, pageKey, String(index))
  assert.deepEqual(saved.recovery?.map((entry) => entry.label), ['11', '10', '9', '8', '7', '6', '5', '4', '3', '2'])
  assert.throws(() => projectFromRecoveryPoint(saved, 'missing'), /niet meer beschikbaar/)
})

test('a restored source baseline survives saving and catches subsequent source or circuit edits', async () => {
  const saved = projectWithRecoveryPoint(project(), pageKey, 'Before')
  const signature = await oneWireSourceFingerprint(saved)
  saved.oneWireSyncBaseline = signature
  saved.pages.schematic.name = 'Handmatig hersteld'
  saved.recovery![0].label = 'Changed label'
  assert.equal(await oneWireSourceFingerprint(JSON.parse(JSON.stringify(saved))), signature)
  saved.pages[pageKey].schema.objects.push({ id: 'new-lamp' })
  assert.notEqual(await oneWireSourceFingerprint(saved), signature)
  saved.pages[pageKey].schema.objects = []
  saved.circuitSpecifications!.A.cableSectionMm2 = 6
  assert.notEqual(await oneWireSourceFingerprint(saved), signature)
})
