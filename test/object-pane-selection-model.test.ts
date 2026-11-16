import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSelection } from '../src/elements/panes/object-pane/selection-model.ts'

test('normalizes object pane selection data at the event boundary', () => {
  const selection = normalizeSelection({
    selectionCount: 1,
    shape: {
      id: 'symbol-1',
      kind: 'symbol',
      scale: Number.NaN,
      busbarLength: 840,
      bindingLabelOffset: { x: -12, y: 2 },
      symbolTextFields: [{ key: 'label', label: 'Label', value: 'Q1' }]
    }
  })

  assert.equal(selection.shape?.label, 'Symbol')
  assert.equal(selection.shape?.scale, null)
  assert.equal(selection.shape?.busbarLength, 840)
  assert.equal(selection.shape?.bindingLabelSide, 'left')
  assert.deepEqual(selection.shape?.symbolTextFields, [{ key: 'label', label: 'Label', value: 'Q1' }])
})

test('represents an empty selection without a placeholder shape', () => {
  assert.deepEqual(normalizeSelection({ selectionCount: 0 }), { selectionCount: 0, shape: null })
})

test('presents roof variants as a readable roof object with an editable direction', () => {
  const selection = normalizeSelection({
    selectionCount: 1,
    shape: { id: 'roof', kind: 'roof-left', rectVariant: 'roof-left' }
  })

  assert.equal(selection.shape?.label, 'Dakvlak')
  assert.equal(selection.shape?.rectVariant, 'roof-left')
})
