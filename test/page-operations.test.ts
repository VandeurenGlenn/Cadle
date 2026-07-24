import assert from 'node:assert/strict'
import test from 'node:test'
import { clonePageSchema } from '../src/shell/page-schema.ts'

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
