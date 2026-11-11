import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildHeatingGrid, heatingSourceRoom, routeHeating } from '../src/editor/heating-routing.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { heatingConnectionZone } from '../src/editor/heating-connection-zone.ts'
import { heatingFallbackPassage, heatingInternalWallCells } from '../src/editor/heating-wall-policy.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { reserveHeatingAccess, reserveHeatingFeedPairs, shareSmallHeatingRooms } from '../src/editor/heating-zones.ts'
import { allocateHeatingCircuits } from '../src/editor/heating-allocation.ts'
import { heatingAccessDistances } from '../src/editor/heating-access-distances.ts'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'

const scene = JSON.parse(readFileSync(new URL('./fixtures/heating-floor-12.json', import.meta.url), 'utf8')) as Shape[]
const project = JSON.parse(readFileSync(new URL('./fixtures/heating-cadle-project.json', import.meta.url), 'utf8'))
const source = { x: 744, y: 592 }

test('the supplied Cadle project routes lower-left feed pairs through partitions instead of the door detour', () => {
  const scene = sanitizeShapes(project.shapes)
  const grid = buildHeatingGrid(scene, 100, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const wallCells = heatingInternalWallCells(grid, 100)
  assert.ok(wallCells.has(grid.index({ x: 744, y: 624 })), 'the source-side wall to the lower-left room is available')
  assert.ok(wallCells.has(grid.index({ x: 868, y: 844 })), 'the next lower room can use its shared partition')
  assert.ok(wallCells.has(grid.index({ x: 900, y: 704 })), 'a partition remains usable when its two sides connect elsewhere')
  assert.ok(!wallCells.has(grid.index({ x: 620, y: 800 })), 'a facade is never a shortcut')
  assert.ok(!wallCells.has(grid.index({ x: 868, y: 584 })), 'an unrecognised shaft is not a passage')
  assert.ok(!wallCells.has(grid.index({ x: 868, y: 728 })), 'a door jamb is not a drilling location')
  assert.ok([...wallCells].every((cell) => !grid.obstacle[cell]), 'fixed furnishings stay blocked')
  const zone = heatingConnectionZone(grid, scene, source, 12, 16, 80, 100), blocked = grid.obstacle.slice()
  for (const cell of zone.interior) blocked[cell] = 1
  for (const stub of zone.stubs) for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  const goals = [{ x: 700, y: 800 }, { x: 708, y: 800 }, { x: 940, y: 840 }, { x: 948, y: 840 }].map(grid.index)
  const paths = routeHeatingBundle(grid, zone.stubs.map((stub) => stub.at(-1)!), goals, blocked,
    { allowWalls: true, permittedWallCells: wallCells })!
  assert.equal(paths?.length, 4, 'both rooms receive a complete, disjoint supply/return pair')
  const used = new Set<number>()
  for (const path of paths) {
    assert.ok(path.cells.some((cell) => grid.wall[cell] && !grid.door[cell]))
    assert.ok(path.cells.every((cell) => !grid.wall[cell] || grid.door[cell] || wallCells.has(cell)))
    for (const cell of path.cells) { assert.ok(!used.has(cell)); used.add(cell) }
  }
  const target = grid.index({ x: 700, y: 800 }), start = grid.index(source)
  const doorRoute = routeHeating(grid, start, target, { radiusCells: 8 })!
  const wallRoute = routeHeating(grid, start, target, { allowWalls: true, permittedWallCells: wallCells, radiusCells: 8 })!
  assert.ok(doorRoute && wallRoute)
  assert.ok(wallRoute.length + 160 / grid.step < doorRoute.length, 'the physical approach saves more than two metres')
})

test('the supplied Cadle project gives the lower-left room complete wall-fed circuits and retains passage markers on reflow', () => {
  const scene = sanitizeShapes(project.shapes), original = structuredClone(scene)
  let id = 0
  const settings = { connectionMode: 'zone' as const, diameterMm: 16, spacingMm: 100, capacity: 4, heatSourceRoom: false,
    excludedRoomKeys: ['region-2', 'region-3', 'region-6', 'region-7'] }
  const area = { x: 80, y: 80, width: project.worldWidth - 160, height: project.worldHeight - 160 }
  const result = generateAutomaticHeatingPlan(scene, source, settings, project.drawingScale, () => `lower-left-${id++}`, area)
  const owner = result.shapes.find((shape) => shape.heating?.kind === 'manifold')!
  assert.ok(result.rows.length > 0)
  assert.equal(owner.heating!.audit!.errors, 0)
  assert.ok(result.rows.every((row) => row.roomKey === 'region-9' && row.supplyM > 0 && row.returnM > 0 && row.cutM! <= 100.05))
  assert.ok(result.wallCrossings > 0)
  assert.equal(result.shapes.filter((shape) => shape.generationKey?.startsWith('heating-penetration:')).length, result.wallCrossings)
  for (const pipe of result.shapes.filter((shape) => shape.heating?.kind === 'pipe')) {
    assert.ok(heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9))
  }
  for (const row of result.rows) assert.deepEqual(result.shapes.filter((shape) => shape.heating?.circuitId === row.id)
    .map((shape) => shape.heating!.pipeRole).sort(), ['loop', 'return', 'supply'])
  const retained = generateAutomaticHeatingPlan(scene, source, settings, project.drawingScale, () => `retained-${id++}`, area, 0, 0,
    { routes: 1, preserved: result.shapes.filter((shape) => shape.heating?.kind === 'pipe'), existingManifold: owner })
  assert.equal(retained.wallCrossings, result.wallCrossings)
  assert.equal(retained.shapes.find((shape) => shape.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
  assert.deepEqual(scene, original, 'planning must not change the supplied drawing')
})

test('reserves both feeds of every allocated circuit before any coil and rejects a blocked source door', () => {
  const original = buildHeatingGrid(scene, 100, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const shared = shareSmallHeatingRooms(original, scene, 100, 16)
  const zone = heatingConnectionZone(original, scene, source, 12, 16, 80, 100)
  const omitted = new Set(heatingSourceRoom(original, source)!.cells)
  const { targets } = allocateHeatingCircuits(shared, source, 12, 100, 100, 100, 100, 3, omitted)
  const approaches = reserveHeatingAccess(shared, original.obstacle, scene, source, 100, 16, 12, 80, () => {}, {
    original, targets, spacingMm: 100, origin: original.point(zone.stubs[Math.floor(zone.stubs.length / 2)].at(-1)!)
  })
  const reserved = reserveHeatingFeedPairs(approaches, original, zone.stubs, zone.interior, targets, omitted, 100, 16, 80, 100, new Set(), () => {})
  assert.equal(reserved.feedPaths!.length, 24)
  const direct = heatingAccessDistances(original, zone.stubs.map((stub) => stub.at(-1)!), new Set(), true, () => {})
  assert.ok(reserved.feedDistances!.some((distance, cell) => direct[cell] >= 0 && distance > direct[cell]),
    'field length budgets include detours imposed by the complete bundle')
  const used = new Set<number>(), door = new Set<number>()
  for (let cell = 0; cell < original.wall.length; cell++) {
    const p = original.point(cell)
    if (original.wall[cell] && original.door[cell] && p.x > 780 && p.x < 844 && Math.abs(p.y - 544) <= original.step) door.add(cell)
  }
  for (const path of reserved.feedPaths!) {
    assert.ok(path.some((cell) => door.has(cell)), 'every supply and return uses the source door')
    for (const cell of path) {
      assert.ok(!used.has(cell), 'one pipe cannot consume another pipe reservation')
      used.add(cell)
      if (original.room[cell] > 0) assert.equal(reserved.loopObstacle[cell], 1, 'coils cannot consume feed space')
    }
  }
  assert.equal(original.feedReservation, undefined, 'the native coverage floor remains unchanged')
  assert.equal(shared.feedPaths, undefined, 'reservations do not mutate a previous candidate')
  const blocked = { ...approaches, obstacle: approaches.obstacle.slice() }
  for (const cell of door) blocked.obstacle[cell] = 1
  assert.throws(() => reserveHeatingFeedPairs(blocked, original, zone.stubs, zone.interior, targets, omitted, 100, 16, 80, 100, new Set(), () => {}),
    /Geen volledige aanvoer- en retourbundel.*nog geen kringen gelegd/)
})

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
