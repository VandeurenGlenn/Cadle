import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureOneWirePage } from '../src/shell/page-operations.ts'
import { clonePageSchema } from '../src/shell/page-schema.ts'
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
