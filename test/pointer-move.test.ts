import assert from 'node:assert/strict'
import test from 'node:test'
import { applyDragMove } from '../src/editor/interaction/pointer-move.ts'
import { oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('snaps a dragged RCD by its electrical terminal', () => {
  const rcd: Shape = {
    id: 'rcd',
    kind: 'symbol',
    position: { x: 103, y: 207 },
    name: 'Residual-current circuit breaker',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    scale: 4
  }
  const moved = applyDragMove(
    { x: 0, y: 0 },
    { ids: ['rcd'], pointerStart: { x: 0, y: 0 }, initial: [rcd] },
    (point) => ({ x: Math.round(point.x / 10) * 10, y: Math.round(point.y / 10) * 10 }),
    [rcd]
  )
  const movedRcd = moved[0]
  assert.equal(movedRcd?.kind, 'symbol')
  if (movedRcd?.kind !== 'symbol') return
  const node = oneWireSymbolNodeInfo(movedRcd.path, movedRcd.scale)
  assert.ok(node)
  const anchor = {
    x: movedRcd.position.x + node.offset.x,
    y: movedRcd.position.y + node.offset.y
  }
  assert.ok(Math.abs(anchor.x / 10 - Math.round(anchor.x / 10)) < 1e-9)
  assert.ok(Math.abs(anchor.y / 10 - Math.round(anchor.y / 10)) < 1e-9)
})
