import assert from 'node:assert/strict'
import test from 'node:test'
import { canCommitDraft } from '../src/editor/interaction/pointer-up.ts'
import type { RectShape } from '../src/editor/model/types.ts'

const roof = (variant: 'roof-left' | 'roof-straight' | 'roof-right', x: number, y: number): RectShape => ({
  id: variant,
  kind: 'rect',
  variant,
  start: { x: 0, y: 0 },
  end: { x, y }
})

test('commits roofs only when both dimensions meet the minimum size', () => {
  for (const variant of ['roof-left', 'roof-straight', 'roof-right'] as const) {
    assert.equal(canCommitDraft(roof(variant, 100, 0)), false, `${variant}: zero height`)
    assert.equal(canCommitDraft(roof(variant, 0, 100)), false, `${variant}: zero width`)
    assert.equal(canCommitDraft(roof(variant, 100, 1.99)), false, `${variant}: height below minimum`)
    assert.equal(canCommitDraft(roof(variant, -2, -2)), true, `${variant}: reverse drag`)
    assert.equal(canCommitDraft(roof(variant, 4, 4)), true, `${variant}: valid footprint`)
    assert.equal(canCommitDraft(roof(variant, 3, 3), 4), false, `${variant}: custom minimum`)
  }
})

test('keeps one-dimensional line drafts valid', () => {
  assert.equal(canCommitDraft({
    id: 'line',
    kind: 'line',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  }), true)
})
