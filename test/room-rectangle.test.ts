import assert from 'node:assert/strict'
import test from 'node:test'
import { convertWallsToRoom, createRoomWalls } from '../src/editor/interaction/room-rectangle.ts'

test('creates four grouped walls from a dragged rectangle', () => {
  let id = 0
  const walls = createRoomWalls({ x: 10, y: 20 }, { x: 110, y: 80 }, () => String(++id))

  assert.equal(walls.length, 4)
  assert.ok(walls.every((wall) => wall.kind === 'wall'))
  assert.ok(walls.every((wall) => wall.groupId === walls[0]?.groupId))
  assert.deepEqual(
    walls.map((wall) => [wall.start, wall.end]),
    [
      [{ x: 10, y: 20 }, { x: 110, y: 20 }],
      [{ x: 110, y: 20 }, { x: 110, y: 80 }],
      [{ x: 110, y: 80 }, { x: 10, y: 80 }],
      [{ x: 10, y: 80 }, { x: 10, y: 20 }]
    ]
  )
})

test('converts selected existing walls into one named-room group', () => {
  let id = 10
  const source = createRoomWalls({ x: 0, y: 0 }, { x: 100, y: 80 }, () => String(++id))
    .map(({ groupId: _groupId, ...wall }) => wall)
  const converted = convertWallsToRoom(source, () => 'living', 'Living')

  assert.equal(converted?.length, 4)
  assert.ok(converted?.every((wall) => wall.groupId === 'room-living'))
  assert.ok(converted?.every((wall) => wall.roomName === 'Living'))
})

test('requires at least three walls before converting a room', () => {
  let id = 20
  const walls = createRoomWalls({ x: 0, y: 0 }, { x: 100, y: 80 }, () => String(++id))
  assert.equal(convertWallsToRoom(walls.slice(0, 2), () => 'small'), null)
})
