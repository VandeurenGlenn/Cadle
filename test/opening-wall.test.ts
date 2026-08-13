import assert from 'node:assert/strict'
import test from 'node:test'
import { bindOpeningToNearestWall } from '../src/editor/interaction/opening-wall.js'
import type { LineShape } from '../src/editor/model/types.js'

test('projects a door exactly onto a diagonal wall', () => {
  const wall: LineShape = {
    id: 'diagonal-wall',
    kind: 'wall',
    start: { x: 100, y: 100 },
    end: { x: 300, y: 300 }
  }
  const door: LineShape = {
    id: 'door',
    kind: 'door',
    start: { x: 148, y: 152 },
    end: { x: 218, y: 222 }
  }

  const bound = bindOpeningToNearestWall(door, [wall])

  assert.equal(bound.wallId, wall.id)
  assert.deepEqual(bound.start, { x: 150, y: 150 })
  assert.deepEqual(bound.end, { x: 220, y: 220 })
})

test('does not bind an opening that was drawn away from a wall', () => {
  const wall: LineShape = {
    id: 'wall',
    kind: 'wall',
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 }
  }
  const door: LineShape = {
    id: 'door',
    kind: 'door',
    wallId: wall.id,
    start: { x: 40, y: 30 },
    end: { x: 100, y: 30 }
  }

  const bound = bindOpeningToNearestWall(door, [wall])

  assert.equal(bound.wallId, undefined)
  assert.deepEqual(bound.start, door.start)
  assert.deepEqual(bound.end, door.end)
})
