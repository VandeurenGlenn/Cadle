import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildHeatingGrid, heatingSourceRoom, routeHeating } from '../src/editor/heating-routing.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { heatingConnectionZone } from '../src/editor/heating-connection-zone.ts'
import { heatingFallbackPassage } from '../src/editor/heating-wall-policy.ts'
import type { Shape } from '../src/editor/model/types.ts'

const scene = JSON.parse(readFileSync(new URL('./fixtures/heating-floor-12.json', import.meta.url), 'utf8')) as Shape[]
const source = { x: 744, y: 592 }

for (const placement of [source, { x: 744, y: 624 }]) test(`all 24 tails use the source door, including wall-mounted sources (${placement.y})`, () => {
  const source = placement
  const grid = buildHeatingGrid(scene, 100, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const zone = heatingConnectionZone(grid, scene, source, 12, 16, 80, 100), sourceRoom = heatingSourceRoom(grid, source)!.id
  assert.ok(zone.stubs.every((stub) => stub.every((cell) => grid.room[cell] === sourceRoom)))
  const points = [
    ...Array.from({ length: 8 }, (_, i) => ({ x: 1300 + 40 * i, y: 400 })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: 1300 + 32 * i, y: 800 })),
    ...Array.from({ length: 6 }, (_, i) => ({ x: 900 + 32 * i, y: 440 })),
    ...Array.from({ length: 4 }, (_, i) => ({ x: 680 + 24 * i, y: 800 }))
  ]
  const blocked = grid.obstacle.slice()
  for (const cell of zone.interior) blocked[cell] = 1
  for (const stub of zone.stubs) for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  const roots = zone.stubs.map((stub) => stub.at(-1)!), goals = points.map(grid.index)
  const paths = routeHeatingBundle(grid, roots, goals, blocked, {})!
  assert.equal(paths?.length, 24)
  const sourceDoor = (cell: number) => { const p = grid.point(cell); return grid.wall[cell] && grid.door[cell] && p.x > 780 && p.x < 844 && Math.abs(p.y - 544) <= grid.step }
  assert.ok(paths.every((path) => path.cells.some(sourceDoor)))
  assert.ok(paths.every((path) => path.cells.every((cell) => !grid.wall[cell] || grid.door[cell])))
  for (let cell = 0; cell < blocked.length; cell++) if (sourceDoor(cell)) blocked[cell] = 1
  assert.equal(routeHeatingBundle(grid, roots, goals, blocked, {}), null, 'a blocked source door must not trigger an unapproved wall bypass')
})

test('the door opening does not include its adjoining wall or jambs', () => {
  const grid = buildHeatingGrid(scene, 100, 100, source)
  assert.equal(grid.door[grid.index({ x: 812, y: 544 })], 1)
  assert.equal(grid.door[grid.index({ x: 772, y: 544 })], 0)
  assert.equal(grid.door[grid.index({ x: 852, y: 544 })], 0)
})

test('both individual routing engines obey the same restricted wall passage', () => {
  const width = 61, height = 51, size = width * height
  const grid = { width, height, step: 1, origin: { x: 0, y: 0 }, rooms: [], wall: new Uint8Array(size), door: new Uint8Array(size),
    obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size),
    point: (cell: number) => ({ x: cell % width, y: Math.floor(cell / width) }), index: (p: { x: number; y: number }) => p.y * width + p.x }
  for (let y = 0; y < height; y++) grid.wall[y * width + 30] = 1
  const passage = new Set(Array.from({ length: 5 }, (_, i) => (10 + i) * width + 30))
  for (const radiusCells of [undefined, 4]) {
    const path = routeHeating(grid, 25 * width + 10, 25 * width + 50, { allowWalls: true, permittedWallCells: passage, radiusCells })!
    assert.ok(path)
    assert.ok(path.every((cell) => !grid.wall[cell] || passage.has(cell)))
  }
})

test('a useful internal shortcut still leaves the source room through its door', () => {
  const corners = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }]
  const shapes: Shape[] = corners.map((start, i) => ({ id: `outer-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] }))
  shapes.push(
    { id: 'source-top', kind: 'wall', start: { x: 0, y: 200 }, end: { x: 200, y: 200 } },
    { id: 'source-side', kind: 'wall', start: { x: 200, y: 200 }, end: { x: 200, y: 400 } },
    { id: 'target-top', kind: 'wall', start: { x: 400, y: 200 }, end: { x: 800, y: 200 } },
    { id: 'target-side', kind: 'wall', start: { x: 400, y: 200 }, end: { x: 400, y: 400 } },
    { id: 'source-door', kind: 'door', start: { x: 150, y: 200 }, end: { x: 190, y: 200 } },
    { id: 'target-door', kind: 'door', start: { x: 740, y: 200 }, end: { x: 780, y: 200 } })
  const source = { x: 100, y: 300 }, target = { x: 420, y: 300 }
  const grid = buildHeatingGrid(shapes, 100, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const passage = heatingFallbackPassage(grid, source, target, 100)!
  assert.ok(passage)
  assert.ok(passage.point.x >= 396, 'the source-side partition is never opened')
  const doorway = routeHeating(grid, grid.index(source), grid.index(target))!
  const shortcut = routeHeating(grid, grid.index(source), grid.index(target), { allowWalls: true, permittedWallCells: passage.cells })!
  assert.ok(shortcut && doorway)
  assert.ok(shortcut.length + 160 / grid.step <= doorway.length)
  assert.ok(shortcut.some((cell) => { const p = grid.point(cell); return grid.wall[cell] && grid.door[cell] && p.x > 150 && p.x < 190 && Math.abs(p.y - 200) <= grid.step }))
  assert.ok(shortcut.every((cell) => !grid.wall[cell] || grid.door[cell] || passage.cells.has(cell)))
})
