import assert from 'node:assert/strict'
import test from 'node:test'
import { transformShapeForSelection } from '../src/editor/interaction/selection-transforms.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('mirrors a door geometry and opening side through selection actions', () => {
  const door: Shape = {
    id: 'door',
    kind: 'door',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  }
  const mirrored = transformShapeForSelection(door, { x: 50, y: 0 }, 'flip-horizontal')

  assert.equal(mirrored.kind, 'door')
  if (mirrored.kind !== 'door') return
  assert.deepEqual(mirrored.start, { x: 100, y: 0 })
  assert.deepEqual(mirrored.end, { x: 0, y: 0 })
  assert.equal(mirrored.flipSide, true)
  assert.equal(mirrored.rotation, 180)
})
