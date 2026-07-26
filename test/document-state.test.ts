import assert from 'node:assert/strict'
import test from 'node:test'
import { asNativeState } from '../src/editor/model/document-state.ts'

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

test('restores stable generated source links used by incremental regeneration', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'generated-load', kind: 'symbol', position: { x: 10, y: 20 }, name: 'Load', path: 'load.svg', scale: 1,
      generationKey: 'device:floor-load-1', sourceLink: { kind: 'device', id: 'floor-load-1', role: 'load' }
    }],
    selectedId: null, paperPreset: 'a4-landscape', printMargin: 0, worldWidth: 1000, worldHeight: 1000
  })
  assert.equal(state?.shapes[0].generationKey, 'device:floor-load-1')
  assert.deepEqual(state?.shapes[0].sourceLink, { kind: 'device', id: 'floor-load-1', role: 'load' })
})
