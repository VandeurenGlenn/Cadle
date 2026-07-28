import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDraftShape,
  DEFAULT_DRAW_STROKE_WIDTH
} from '../src/editor/interaction/pointer-down-builders.js'

test('uses a one-pixel stroke for newly drawn lines and outline shapes', () => {
  const point = { x: 10, y: 20 }

  for (const tool of ['line', 'rect', 'circle', 'arc'] as const) {
    const draft = createDraftShape(tool, point, tool)
    assert.equal(draft.strokeWidth, DEFAULT_DRAW_STROKE_WIDTH, tool)
  }
})

test('keeps architectural tools on their specialized stroke defaults', () => {
  const point = { x: 10, y: 20 }

  for (const tool of ['wall', 'door', 'window', 'gate'] as const) {
    const draft = createDraftShape(tool, point, tool)
    assert.equal(draft.strokeWidth, undefined, tool)
  }
})
