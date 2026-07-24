import assert from 'node:assert/strict'
import test from 'node:test'
import { clonePageSchema } from '../src/shell/page-schema.ts'

test('clones page schemas without sharing object references', () => {
  const schema = { version: 'native-svg-1', objects: [{ id: 'one' }] }
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
