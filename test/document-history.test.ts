import assert from 'node:assert/strict'
import test from 'node:test'
import { DocumentHistory } from '../src/editor/controllers/document-history.ts'
import type { Snapshot } from '../src/editor/model/types.ts'

const snapshot = (id: string): Snapshot => ({
  shapes: [
    {
      id,
      kind: 'line',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 }
    }
  ],
  selectedId: id,
  worldWidth: 100,
  worldHeight: 100
})

test('walks backward and forward through document snapshots', () => {
  const history = new DocumentHistory()
  history.push(snapshot('first'))
  history.push(snapshot('second'))

  assert.equal(history.undo()?.selectedId, 'first')
  assert.equal(history.undo(), null)
  assert.equal(history.redo()?.selectedId, 'second')
  assert.equal(history.redo(), null)
})

test('drops the redo branch after a new edit', () => {
  const history = new DocumentHistory()
  history.push(snapshot('first'))
  history.push(snapshot('discarded'))
  history.undo()
  history.push(snapshot('replacement'))

  assert.equal(history.redo(), null)
  assert.equal(history.undo()?.selectedId, 'first')
})

test('clones snapshots at the controller boundary', () => {
  const history = new DocumentHistory()
  const input = snapshot('shape')
  history.push(input)
  input.shapes[0].id = 'mutated-input'

  history.push(snapshot('later'))
  const restored = history.undo()
  assert.equal(restored?.shapes[0].id, 'shape')

  if (restored) restored.shapes[0].id = 'mutated-output'
  assert.equal(history.redo()?.selectedId, 'later')
  assert.equal(history.undo()?.shapes[0].id, 'shape')
})

test('replaces the current entry without adding an undo step', () => {
  const history = new DocumentHistory()
  history.push(snapshot('first'))
  history.push(snapshot('replacement'), true)

  assert.equal(history.undo(), null)
})
