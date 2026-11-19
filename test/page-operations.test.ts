import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureOneWirePage, oneWireGenerationPageKeys, redundantOneWirePageKeys } from '../src/data/page-operations.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { clonePageSchema } from '../src/data/page-schema.ts'
import type { Project, UUID } from '../src/types.ts'

test('clones page schemas without sharing object references', () => {
  const schema = { version: 'native-svg-1', objects: [{ id: 'one', kind: 'wall' }] }
  const cloned = clonePageSchema(schema, {
    includeWalls: true,
    outsideWallsOnly: false,
    includeOpenings: false,
    includeElectrical: false
  })

  assert.deepEqual(cloned, schema)
  assert.notEqual(cloned, schema)
  assert.notEqual(cloned.objects, schema.objects)
})

test('filters page objects according to the selected clone options', () => {
  const schema = {
    version: 'native-svg-1',
    objects: [
      { id: 'wall', kind: 'wall' },
      { id: 'door', kind: 'door' },
      { id: 'socket', kind: 'symbol', electrical: { role: 'load' } }
    ]
  }
  const cloned = clonePageSchema(schema, {
    includeWalls: true,
    outsideWallsOnly: false,
    includeOpenings: false,
    includeElectrical: true
  })

  assert.deepEqual(
    cloned.objects.map((object) => (object as { id: string }).id),
    ['wall', 'socket']
  )
})

test('creates and returns a one-wire page when the project has none', async () => {
  const projectKey = 'project' as UUID
  const pageKey = 'onewire-page' as UUID
  const project = { pages: {} } as Project

  const result = await ensureOneWirePage(projectKey, project, {
    addPage: async (receivedProjectKey, pageName, schema, pageType) => {
      assert.equal(receivedProjectKey, projectKey)
      assert.equal(pageName, 'One-wire diagram')
      assert.deepEqual(schema, { version: 'native-svg-1', objects: [] })
      assert.equal(pageType, 'onewire')
      project.pages[pageKey] = {
        creationTime: Date.now(),
        name: pageName,
        pageType,
        schema
      }
      return pageKey
    },
    getProjectData: async () => project
  })

  assert.equal(result?.pageKey, pageKey)
  assert.equal(result?.project.pages[pageKey]?.pageType, 'onewire')
})

test('only removes obsolete automatic sheets whose complete content is represented on retained sheets', () => {
  const generated: Shape = { id: 'a', kind: 'text', text: 'A', position: { x: 200, y: 200 }, scale: 1,
    generationKey: 'board:A:label' }
  const page = (name: string, shapes: Shape[]): Project['pages'][string] => ({
    name, pageType: 'onewire', creationTime: 1, schema: { version: 'native-svg-1', objects: [
      { kind: 'cadle-native-svg-document', payload: { version: 2, shapes, worldWidth: 2376, worldHeight: 1680,
        paperPreset: 'a4-landscape', printMargin: 10, selectedId: null } }
    ] }
  })
  const project = { pages: {
    root: page('One-wire diagram', [generated]),
    stale: page('One-wire diagram 2', [generated]),
    manual: page('One-wire diagram 3', [generated, { ...generated, id: 'note', generationKey: undefined }]),
    locked: page('One-wire diagram 4', [{ ...generated, locked: true }]),
    unmatched: page('One-wire diagram 5', [{ ...generated, generationKey: 'board:B:label' }]),
    unknown: { ...page('One-wire diagram 6', [generated]), schema: { version: 'legacy', objects: [{ kind: 'image' }] } },
    malformed: { ...page('One-wire diagram 7', [generated]), schema: { version: 'native-svg-1', objects: [
      { kind: 'cadle-native-svg-document', payload: { shapes: [{ kind: 'unknown' }], worldWidth: 2376, worldHeight: 1680,
        paperPreset: 'a4-landscape', printMargin: 10 } }
    ] } },
    empty: { ...page('One-wire diagram 8', []), schema: { version: 'native-svg-1', objects: [] } },
    custom: page('Eigen extra schema', [generated]),
    overflow: { ...page('Vervolg', [generated]), oneWireOverflowOf: 'stale' as UUID }
  } } as Project
  const keys = oneWireGenerationPageKeys(project, 'root')
  assert.ok(keys.includes('overflow'))
  assert.ok(!keys.includes('custom'))
  assert.deepEqual(redundantOneWirePageKeys(project, keys, new Set(['root'])), ['stale', 'empty', 'overflow'])
  assert.deepEqual(redundantOneWirePageKeys(project, keys, new Set(['root', 'stale'])), ['empty', 'overflow'])
})
