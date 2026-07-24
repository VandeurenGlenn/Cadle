import assert from 'node:assert/strict'
import test from 'node:test'
import { asNativeState } from '../src/native-draw/document-state.ts'

test('ignores persisted selection ids so restored documents start unselected', () => {
  const state = asNativeState({
    version: 1,
    shapes: [],
    selectedId: 'shape-1',
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.equal(state?.selectedId, null)
})

test('rejects malformed document dimensions and paper presets', () => {
  const base = {
    version: 1,
    shapes: [],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  }

  assert.equal(asNativeState({ ...base, worldWidth: 0 }), null)
  assert.equal(asNativeState({ ...base, printMargin: -1 }), null)
  assert.equal(asNativeState({ ...base, paperPreset: 'letter' }), null)
})
