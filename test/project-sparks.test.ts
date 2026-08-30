import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseProjectSparkIndex, PROJECT_SPARKS } from '../src/fields/project-sparks.ts'

test('offers a varied collection of project sparks', () => {
  assert.ok(PROJECT_SPARKS.length >= 10)
  assert.ok(PROJECT_SPARKS.every(({ setup, punchline }) => setup.length > 0 && punchline.length > 0))
})

test('does not immediately repeat the previous spark', () => {
  for (let previous = 0; previous < PROJECT_SPARKS.length; previous += 1) {
    assert.notEqual(chooseProjectSparkIndex(previous, () => 0), previous)
    assert.notEqual(chooseProjectSparkIndex(previous, () => 0.999999), previous)
  }
})
