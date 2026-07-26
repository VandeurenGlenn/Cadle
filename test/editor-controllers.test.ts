import assert from 'node:assert/strict'
import test from 'node:test'
import { CanvasDocumentController } from '../src/editor/controllers/canvas-document-controller.ts'
import { OneWireController } from '../src/editor/controllers/onewire-controller.ts'
import { CatalogController } from '../src/editor/controllers/catalog-controller.ts'
import type { Shape } from '../src/editor/model/types.ts'

const shape = (id: string): Shape => ({ id, kind: 'text', position: { x: 0, y: 0 }, text: id })

test('canvas document controller retains only valid selection after replacement', () => {
  const controller = new CanvasDocumentController()
  controller.shapes = [shape('a'), shape('b')]
  controller.selectedId = 'a'
  controller.selectedIds = new Set(['a', 'b'])
  controller.replaceShapes([shape('b')])
  assert.equal(controller.selectedId, null)
  assert.deepEqual([...controller.selectedIds], ['b'])
})

test('one-wire controller owns analysis and layout planning', () => {
  const controller = new OneWireController()
  const plan = controller.plan([{ family: 'A', circuitCount: 2 }], 500, 500)
  assert.equal(plan.pageCount, 1)
})

test('catalog controller creates a detached selection draft', () => {
  const controller = new CatalogController()
  const source = [shape('a')]
  const draft = controller.selectionDraft(source, ['a'])
  assert.ok(draft)
  assert.notEqual(draft?.shapes[0], source[0])
})
