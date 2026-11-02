import assert from 'node:assert/strict'
import test from 'node:test'
import { createNativeSelectionChangedPayload } from '../src/editor/interaction/selection-payload.ts'
import { normalizeSelection } from '../src/elements/panes/object-pane/selection-model.ts'

test('reports the entire routed conductor length and its drawing thickness', () => {
  const result = createNativeSelectionChangedPayload({ id: 'wire', kind: 'line', start: { x: 0, y: 0 }, end: { x: 80, y: 80 },
    connection: { kind: 'wire', routing: 'orthogonal', showLabel: false }, strokeWidth: 2 }, 1)
  assert.deepEqual(result.shape?.dimensions, { length: 160, strokeWidth: 2 })
  const normalized = normalizeSelection(result)
  assert.equal(normalized.shape?.dimensions?.length, 160)
  assert.equal(normalized.shape?.dimensions?.strokeWidth, 2)
})

test('shows wall lengths and rectangle sizes without inventing a length for a multi-selection', () => {
  assert.deepEqual(createNativeSelectionChangedPayload({ id: 'wall', kind: 'wall', start: { x: 10, y: 10 }, end: { x: 110, y: 10 } }, 1)
    .shape?.dimensions, { length: 100, strokeWidth: 8 })
  assert.deepEqual(createNativeSelectionChangedPayload({ id: 'rect', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 80, y: 40 }, strokeWidth: 3 }, 1)
    .shape?.dimensions, { width: 80, height: 40, strokeWidth: 3 })
  assert.equal(createNativeSelectionChangedPayload({ id: 'line', kind: 'line', start: { x: 0, y: 0 }, end: { x: 80, y: 0 } }, 2).shape, undefined)
  assert.equal(normalizeSelection({ selectionCount: 1, shape: { kind: 'line', dimensions: { length: NaN } } }).shape?.dimensions?.length, null)
})
