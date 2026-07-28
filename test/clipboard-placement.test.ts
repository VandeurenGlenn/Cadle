import assert from 'node:assert/strict'
import test from 'node:test'
import { snapPasteTranslation } from '../src/editor/interaction/clipboard-placement.ts'
import { oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('snaps a pasted RCD by its electrical terminal instead of its visual bounds', () => {
  const rcd: Shape = {
    id: 'rcd',
    kind: 'symbol',
    position: { x: 103, y: 207 },
    name: 'Residual-current circuit breaker',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    scale: 4
  }
  const translation = snapPasteTranslation([rcd], { x: 10, y: 10 }, { x: 80.5, y: 180.5 }, 10)
  const node = oneWireSymbolNodeInfo(rcd.path, rcd.scale)
  assert.ok(node)
  const pastedNode = {
    x: rcd.position.x + node.offset.x + translation.x,
    y: rcd.position.y + node.offset.y + translation.y
  }

  assert.ok(Math.abs(pastedNode.x / 10 - Math.round(pastedNode.x / 10)) < 1e-9)
  assert.ok(Math.abs(pastedNode.y / 10 - Math.round(pastedNode.y / 10)) < 1e-9)
})

test('keeps bounds-based snapping for shapes without an electrical node', () => {
  const shape: Shape = {
    id: 'text',
    kind: 'text',
    position: { x: 13, y: 17 },
    text: 'Label'
  }
  const translation = snapPasteTranslation([shape], { x: 10, y: 10 }, { x: 13, y: 7 }, 10)
  assert.deepEqual(translation, { x: 7, y: 13 })
})
