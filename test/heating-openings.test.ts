import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHeatingGrid, routeHeating } from '../src/editor/heating-routing.ts'
import { isHeatingDoorSymbol, isHeatingSymbolObstacle } from '../src/editor/heating-openings.ts'
import { createHeatingPipe, heatingDefaults, presentHeatingTables } from '../src/editor/heating-plan.ts'
import { shapeBounds } from '../src/editor/model/model.ts'
import type { RectShape, Shape, SymbolShape } from '../src/editor/model/types.ts'

const door = (overrides: Partial<SymbolShape> = {}): SymbolShape => ({ id: 'catalog-door', kind: 'symbol', name: 'Door',
  path: 'symbols/Floor plan/door.svg', scale: 80 / 24, position: { x: 600, y: 521.21 }, ...overrides })
const roomScene = (vertical: boolean): Shape[] => {
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  return [...corners.map((start, i): Shape => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] })),
    ... (vertical ? [
      { start: { x: 600, y: 400 }, end: { x: 600, y: 520 } },
      { start: { x: 600, y: 600 }, end: { x: 600, y: 720 } }
    ] : [
      { start: { x: 400, y: 560 }, end: { x: 560, y: 560 } },
      { start: { x: 640, y: 560 }, end: { x: 800, y: 560 } }
    ]).map((segment, i): Shape => ({ ...segment, id: `partition-${i}`, kind: 'wall' }))]
}

const placements = [
  { name: 'horizontal', vertical: false, rotation: 0, position: { x: 600, y: 521.21 } },
  { name: 'rotated 90°', vertical: true, rotation: 90, position: { x: 638.79, y: 560 } },
  { name: 'rotated 180°', vertical: false, rotation: 180, position: { x: 600, y: 598.79 } },
  { name: 'rotated 270°', vertical: true, rotation: 270, position: { x: 561.21, y: 560 } },
  { name: 'mirrored vertically', vertical: false, rotation: 0, flipY: true, position: { x: 600, y: 598.79 } },
  { name: 'rotated and mirrored horizontally', vertical: true, rotation: 90, flipX: true, position: { x: 638.79, y: 560 } }
]
for (const placement of placements) test(`catalog door ${placement.name} remains a usable threshold between two rooms`, () => {
  const symbol = door(placement), g = buildHeatingGrid([...roomScene(placement.vertical), symbol], 100, 150, { x: 180, y: 280 })
  const threshold = g.index({ x: 600, y: 560 })
  assert.equal(g.rooms.length, 2, 'close the boundary at the threshold, not at the open leaf or arc')
  assert.equal(g.wall[threshold], 1)
  assert.equal(g.door[threshold], 1)
  assert.equal(g.obstacle[threshold], 0)
  assert.equal(g.loopObstacle[threshold], 0)
  const start = placement.vertical ? { x: 560, y: 560 } : { x: 600, y: 520 }
  const end = placement.vertical ? { x: 640, y: 560 } : { x: 600, y: 600 }
  const path = routeHeating(g, g.index(start), g.index(end), { allowWalls: true, radiusCells: 7 })
  assert.ok(path)
  assert.ok(path.some((cell) => g.door[cell]))
  assert.ok(!path.some((cell) => g.wall[cell] && !g.door[cell]), 'the doorway needs no wall penetration')
})

for (const placement of placements) test(`pipes pass beneath the ${placement.name} door leaf and swing despite an obstacle flag`, () => {
  const symbol = door({ ...placement, heatingObstacle: true })
  const grid = buildHeatingGrid([...roomScene(placement.vertical), symbol], 100, 100, { x: 180, y: 280 })
  const radians = placement.rotation * Math.PI / 180
  const point = (x: number) => ({ x: symbol.position.x + x * Math.cos(radians), y: symbol.position.y + x * Math.sin(radians) })
  const path = routeHeating(grid, grid.index(point(-50)), grid.index(point(50)), { radiusCells: 4 })
  assert.ok(path, 'a below-floor pipe can cross both the drawn leaf and swing')
  assert.equal(isHeatingSymbolObstacle(symbol), false)
  assert.ok(path.every((cell) => !grid.obstacle[cell] && !grid.loopObstacle[cell]))
  const pipe = createHeatingPipe('under-door', [point(-50), point(50)],
    { ...heatingDefaults('pipe', 100), automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
  const manifold: RectShape = { id: 'manifold', kind: 'rect', start: { x: 100, y: 100 }, end: { x: 200, y: 160 },
    heating: { ...heatingDefaults('manifold', 100), automatic: true, circuits: 1 } }
  const audit = presentHeatingTables([symbol, manifold, pipe], undefined, shapeBounds)
    .find((shape) => shape.id === manifold.id)!.heating!.audit!
  assert.ok(!audit.issues.some((issue) => issue.code === 'obstacle'), 'the final audit also ignores the above-floor door')
})

test('a native door cannot become a floor obstacle through an old obstacle flag', () => {
  const native: Shape = { id: 'native-door', kind: 'door', start: { x: 560, y: 560 }, end: { x: 640, y: 560 }, heatingObstacle: true }
  const grid = buildHeatingGrid([...roomScene(false), native], 100, 100, { x: 180, y: 280 })
  const threshold = grid.index({ x: 600, y: 560 })
  assert.equal(grid.door[threshold], 1)
  assert.equal(grid.obstacle[threshold], 0)
  assert.equal(grid.loopObstacle[threshold], 0)
})

test('does not confuse electrical door appliances or arbitrary names with architectural door symbols', () => {
  for (const path of ['symbols/Consumption appliances/Door bell.svg', 'symbols/Consumption appliances/Electric door lock.svg', 'custom.svg']) {
    const symbol = door({ path })
    assert.equal(isHeatingDoorSymbol(symbol), false)
    assert.equal(isHeatingSymbolObstacle(symbol), true)
    assert.throws(() => buildHeatingGrid([...roomScene(false), symbol], 100, 150, { x: 180, y: 280 }), /deur of trap/)
  }
  assert.ok(isHeatingDoorSymbol(door({ path: '/cadle/symbols/Floor%20plan/door.svg?v=1' })))
})

test('hidden door symbols do not create passages or divide rooms', () => {
  assert.throws(() => buildHeatingGrid([...roomScene(false), door({ hidden: true })], 100, 150, { x: 180, y: 280 }), /deur of trap/)
})

test('live schedule checks allow pipes through catalog doors but still flag appliances', () => {
  const manifold: RectShape = { id: 'manifold', kind: 'rect', start: { x: 100, y: 100 }, end: { x: 200, y: 160 },
    heating: { ...heatingDefaults('manifold', 100), automatic: true, circuits: 1 } }
  const pipe = createHeatingPipe('pipe', [{ x: 600, y: 480 }, { x: 600, y: 600 }],
    { ...heatingDefaults('pipe', 100), automatic: true, circuitId: 'VV01', pipeRole: 'supply' })
  const audit = (symbol: SymbolShape) => presentHeatingTables([symbol, manifold, pipe], undefined, shapeBounds)
    .find((shape) => shape.id === 'manifold')!.heating!.audit!
  assert.ok(!audit(door()).issues.some((issue) => issue.code === 'obstacle'))
  assert.ok(audit(door({ path: 'symbols/Consumption appliances/Door bell.svg' })).issues.some((issue) => issue.code === 'obstacle'))
})
