import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Point, RectShape, Shape } from '../src/editor/model/types.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import { buildHeatingGrid, heatingCurveWallConflict, heatingSourceRoom } from '../src/editor/heating-routing.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { createHeatingPipe } from '../src/editor/heating-pipe.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { refineHeatingConnectionBundle, type HeatingConnectionRefinementState } from '../src/editor/heating-connection-refinement.ts'
import { routeDoorAdaptedHeatingFeeds, type HeatingDoorAdapterWork } from '../src/editor/heating-door-adapter.ts'

const shared = JSON.parse(readFileSync(new URL('./fixtures/heating-shared-doorway.json', import.meta.url), 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-door-adapter.json', import.meta.url), 'utf8'))
const scene = sanitizeShapes(shared.scene) as Shape[], scale = 100, source = fixture.source
const native = buildHeatingGrid(scene, scale, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
const coil = fixture.coil as RectShape, neighbors = fixture.neighbors as RectShape[], coils = [coil, ...neighbors]
const settings = fixture.settings, obstacles = heatingObstacleBounds(scene, shapeBounds)
const permitted = new Set<number>(shared.permittedWallCells)
const options = (work: HeatingDoorAdapterWork, checkpoint = () => {}) => ({ source, sourceRadiusMm: 1500,
  nativeFloor: native, nativeWallCells: permitted, permittedWallCells: permitted, obstacles,
  work, searchKey: 'real-room-door-adapter', checkpoint })
const feedsFor = (points: Point[][]) => points.map((vertices, index) => createHeatingPipe(`adapter-${index}`,
  index ? [...vertices].reverse() : vertices, { ...coil.heating!, pipeRole: index ? 'return' : 'supply', bendRadiusMm: 80 }))

test('a proven doorway adapter connects the full source pair at the original ports with all neighbouring coils retained', () => {
  const before = JSON.stringify(coils), work: HeatingDoorAdapterWork = {}, deadline = Date.now() + 15000
  const pair = routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale,
    options(work, () => assert.ok(Date.now() < deadline, 'the doorway witness avoids the exhausted seam search')))
  assert.ok(pair)
  assert.equal(work.local?.length, 2)
  const original = heatingPipeGeometry(coil).points
  assert.deepEqual([pair[0].at(-1), pair[1].at(-1)], [original[0], original.at(-1)])
  const feeds = feedsFor(pair), room = heatingSourceRoom(native, source)!
  assert.ok(pair.every((vertices) => native.room[native.index(vertices[0])] === room.id))
  assert.ok(pair.every((vertices) => Math.hypot(vertices[0].x - source.x, vertices[0].y - source.y) <= 120 + 1e-6))
  assert.equal(checkHeatingPlan([...coils, ...feeds], [], settings.design, obstacles).errors, 0)
  assert.ok(feeds.every((feed) => !heatingCurveWallConflict(native, heatingPipeGeometry(feed).pieces,
    { allowWalls: true, permittedWallCells: permitted })))
  assert.ok(feeds.every((feed) => heatingPipeGeometry(feed).bends.every((bend) => bend.radiusMm >= 79.9)))
  const total = [coil, ...feeds].reduce((sum, pipe) => sum + heatingPipeGeometry(pipe).length * scale / 8000, 0)
  assert.ok(feeds.every((feed, i) => heatingPipeGeometry(feed).length >= heatingPipeGeometry(work.local![i]).length),
    'both complete local doorway tails remain part of the measured leaders')
  assert.ok(total <= 120, `the full ${total.toFixed(3)}m includes both local tails within the circuit limit`)
  assert.equal(JSON.stringify(coils), before)
})

test('the production refiner installs complete adapted leaders and retains their query state', () => {
  const vertices = heatingPipeGeometry(coil).points
  const targets = [[vertices[0], vertices[1]], [vertices.at(-1)!, vertices.at(-2)!]].map(([head, next]) => {
    const root = native.index(head), dx = head.x - next.x, dy = head.y - next.y
    return [root, root + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * native.width)]
  })
  const roots = shared.sourceStubs as number[][]
  const flows = routeHeatingBundle(native, roots.map((stub) => stub.at(-1)!), targets.map((stub) => stub.at(-1)!), native.obstacle,
    { allowWalls: true, permittedWallCells: permitted })
  assert.ok(flows)
  const state: HeatingConnectionRefinementState = {}, deadline = Date.now() + 15000
  const result = refineHeatingConnectionBundle(native, flows, roots, targets, [coil], settings, scale,
    { scene, sourcePosition: source, sourceRadiusMm: 1500, permittedWallCells: permitted, obstacles, preserved: neighbors, state,
      checkpoint: () => assert.ok(Date.now() < deadline) })
  assert.deepEqual(result.refined, [0, 1])
  assert.deepEqual(result.failures, [])
  assert.equal(state.doorAdapters?.[0].work.local?.length, 2)
  assert.ok((state.routeAttempts ?? 0) < 20)
  assert.equal(checkHeatingPlan([...coils, ...feedsFor(result.points)], [], settings.design, obstacles).errors, 0)
})

test('door-adapter queries honour pause, resume and exhausted budgets without caching incomplete work', () => {
  const work: HeatingDoorAdapterWork = {}, pause = new Error('pause after completing the local entry')
  assert.throws(() => routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale,
    options(work, () => { if (work.local) throw pause })), (error) => error === pause)
  assert.equal(work.local?.length, 2, 'completed local geometry survives the pause')
  const pair = routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale, options(work))
  assert.ok(pair)
  assert.equal(checkHeatingPlan([...coils, ...feedsFor(pair)], [], settings.design, obstacles).errors, 0)
  const exhausted = { remaining: 0 }, untouched: HeatingDoorAdapterWork = {}
  assert.equal(routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale,
    { ...options(untouched), searchBudget: exhausted }), null)
  assert.deepEqual(untouched, {})
  assert.equal(exhausted.remaining, 0)
})

test('a local doorway search that exhausts its query budget remains resumable', () => {
  // Close the actual lower-right doorway with an already laid pipe. The
  // first bounded search can fail without exhausting every local launch.
  const barrier = createHeatingPipe('occupied-room-doorway', [{ x: 1220, y: 596 }, { x: 1220, y: 684 }],
    { ...coil.heating!, circuitId: 'occupied-doorway', pipeRole: 'supply', bendRadiusMm: 80 })
  const work: HeatingDoorAdapterWork = {}, budget = { remaining: 1 }
  let searches = 0
  const deadline = Date.now() + 15000
  const pair = routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [barrier], settings, scale,
    { ...options(work, () => assert.ok(Date.now() < deadline)), searchBudget: budget, onSearch: () => searches++ })
  assert.equal(pair, null)
  assert.equal(searches, 1)
  assert.equal(budget.remaining, 0)
  assert.equal(work.local, undefined, 'an exhausted probe is not cached as an impossible doorway')
  assert.ok(work.localRejected?.some((attempts) => attempts.length > 0), 'completed failed queries survive for the next slice')
})

test('a cached local doorway pair leaves a one-query budget available for the global leaders', () => {
  const work: HeatingDoorAdapterWork = {}, pause = new Error('retain proven local pair')
  const deadline = Date.now() + 15000
  assert.throws(() => routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale,
    options(work, () => { assert.ok(Date.now() < deadline); if (work.local) throw pause })), (error) => error === pause)
  assert.equal(work.local?.length, 2)
  const local = JSON.stringify(work.local), budget = { remaining: 1 }
  let searches = 0
  const pair = routeDoorAdaptedHeatingFeeds(native, scene, coil, coils, [], settings, scale,
    { ...options(work, () => assert.ok(Date.now() < deadline)), searchBudget: budget, onSearch: () => searches++ })
  assert.ok(pair, 'the saved doorway witness must not spend the only global query again')
  assert.equal(searches, 1)
  assert.equal(budget.remaining, 0)
  assert.equal(JSON.stringify(work.local), local)
  const original = heatingPipeGeometry(coil).points
  assert.deepEqual([pair[0].at(-1), pair[1].at(-1)], [original[0], original.at(-1)])
  assert.equal(checkHeatingPlan([...coils, ...feedsFor(pair)], [], settings.design, obstacles).errors, 0)
  assert.ok(feedsFor(pair).every((feed) => !heatingCurveWallConflict(native, heatingPipeGeometry(feed).pieces,
    { allowWalls: true, permittedWallCells: permitted })))
})

test('reused adapter state separates changed source and actual doorway geometry', () => {
  const vertices = heatingPipeGeometry(coil).points
  const targets = [[vertices[0], vertices[1]], [vertices.at(-1)!, vertices.at(-2)!]].map(([head, next]) => {
    const root = native.index(head), dx = head.x - next.x, dy = head.y - next.y
    return [root, root + (Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * native.width)]
  })
  const roots = shared.sourceStubs as number[][]
  const flows = routeHeatingBundle(native, roots.map((stub) => stub.at(-1)!), targets.map((stub) => stub.at(-1)!), native.obstacle,
    { allowWalls: true, permittedWallCells: permitted })!
  const cache: NonNullable<HeatingConnectionRefinementState['doorAdapters']> = []
  const run = (drawing: readonly Shape[], position: Point) => {
    const state: HeatingConnectionRefinementState = { doorAdapters: cache }, deadline = Date.now() + 15000
    const result = refineHeatingConnectionBundle(native, flows, roots, targets, [coil], settings, scale,
      { scene: drawing, sourcePosition: position, sourceRadiusMm: 1500, permittedWallCells: permitted, obstacles,
        preserved: neighbors, state, checkpoint: () => assert.ok(Date.now() < deadline) })
    assert.deepEqual(result.refined, [0, 1])
  }
  run(scene, source)
  assert.equal(cache.length, 1)
  const initial = JSON.stringify(cache[0].work.local)
  run(scene, { x: source.x + 1, y: source.y })
  assert.equal(cache.length, 2, 'a different loose source owns a separate adapter query context')
  const changed = structuredClone(scene)
  const door = changed.find((shape) => shape.kind === 'door' && shape.start.x === 1220 && shape.start.y === 604)!
  assert.equal(door.kind, 'door')
  if (door.kind === 'door') { door.start.y += .01; door.end.y += .01 }
  run(changed, { x: source.x + 1, y: source.y })
  assert.equal(cache.length, 3, 'real doorway coordinates invalidate the old entry witness')
  assert.equal(JSON.stringify(cache[0].work.local), initial)
})
