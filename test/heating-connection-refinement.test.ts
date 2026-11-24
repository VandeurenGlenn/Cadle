import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { Point, RectShape } from '../src/editor/model/types.ts'
import type { HeatingGrid } from '../src/editor/heating-routing.ts'
import { refineHeatingConnectionBundle, type HeatingConnectionRefinementState } from '../src/editor/heating-connection-refinement.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingPointClearance } from '../src/editor/heating-clearance.ts'
import { sanitizeHeating } from '../src/editor/heating-plan.ts'
import { alignHeatingFlowLegs, alignHeatingFlowTrunk, roundHeatingFlowInlet, smoothHeatingFlowLanes } from '../src/editor/heating-flow-lanes.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { selectHeatingLanePairs } from '../src/editor/heating-lane-selection.ts'

test('two conflicting circuit pairs can move together while a clear circuit stays put', () => {
  const choices = selectHeatingLanePairs([[[0, 0], [1, 1]], [[0, 0], [1, 1]], [[0, 0], [1, 1]]],
    (i, a, j, b) => i < 2 && j < 2 && (!a[0] || !b[0]))
  assert.deepEqual(choices, [[1, 1], [1, 1], [0, 0]])
})

test('two short raster jogs become an R80 inlet without changing the terminal tangent', () => {
  const route = [{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 1.6, y: 60 },
    { x: 1.6, y: 71.2 }, { x: 15.2, y: 71.2 }, { x: 15.2, y: 75 }]
  const variants = [...roundHeatingFlowInlet(smoothHeatingFlowLanes(route, 6.4, 0), 6.4)]
  assert.ok(variants.some((points) => {
    const pipe = createHeatingPipe('inlet', points, { ...heatingPipeData(100), automatic: true, circuitId: 'VV02', bendRadiusMm: 80 })
    const geometry = heatingPipeGeometry(pipe)
    return geometry.bends.length === 2 && geometry.bends.every((bend) => bend.radiusMm >= 79.9) &&
      geometry.points.at(-2)?.x === 15.2 && geometry.points.at(-2)!.y < 75 &&
      geometry.points.at(-1)?.y === 75
  }))
})

test('overlapping loose source lanes are repaired locally without rerouting valid room approaches', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-loose-source-tails.json', import.meta.url), 'utf8')) as {
    source: Point; scale: number; coils: RectShape[]; points: Point[][]; radii: number[] }
  const width = 800, height = 500, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 600, y: 200 }, width, height, step,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(2), rooms: [],
    point: (cell) => ({ x: 600 + cell % width * step, y: 200 + Math.floor(cell / width) * step }),
    index: (p) => Math.round((p.y - 200) / step) * width + Math.round((p.x - 600) / step) }
  for (let cell = 0; cell < size; cell++) {
    const p = grid.point(cell)
    if (p.x >= 624.8 && p.x <= 863.2 && p.y >= 548.8 && p.y <= 619.2) grid.room[cell] = 1
  }
  const feed = (points: Point[], goal: number) => createHeatingPipe(`test-feed-${goal}`, points,
    { ...fixture.coils[goal >> 1].heating!, bendRadiusMm: fixture.radii[goal], pipeRole: 'supply' })
  assert.equal(checkHeatingPlan([...fixture.coils, ...fixture.points.map(feed)], [], { maxCircuitLengthM: 120 }).errors, 1)
  const paths = fixture.points.map((points) => points.map(grid.index)), sources = paths.map((_, i) => i)
  const count = fixture.coils.length, accepted = sources.slice(0, -2)
  const root = { paths, points: fixture.points, sources, bendRadiusMm: fixture.radii, refined: [], failures: [] }
  const state: HeatingConnectionRefinementState = { ...root, points: structuredClone(fixture.points), paths: structuredClone(paths),
    sources: [...sources], bendRadiusMm: [...fixture.radii], refined: [], failures: [],
    warmPairs: fixture.coils.map((coil, index) => ({ coilKey: JSON.stringify(heatingPipeGeometry(coil).points),
      points: fixture.points.slice(index * 2, index * 2 + 2), bendRadiusMm: fixture.radii.slice(index * 2, index * 2 + 2) })),
    priority: { rootDone: 0, root, queue: [], seen: [], expanded: 0,
    seedPolicy: 'native-room-local-order-v17', pendingSeeds: [], triedSeeds: [],
    seed: { order: fixture.coils.map((_, i) => i), next: count - 1, routes: { ...root, refined: accepted } } } }
  const stubs = paths.map((path) => [path[0], path[0] - width]), targetStubs = paths.map((path) => [path.at(-1)!])
  const deadline = Date.now() + 5000
  const result = refineHeatingConnectionBundle(grid, paths.map((cells, source) => ({ cells, source })), stubs, targetStubs,
    fixture.coils, { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 120 } }, 100,
    { fineGrid: true, state, sourcePosition: fixture.source, permittedWallCells: new Set(),
      checkpoint() { assert.ok(Date.now() < deadline, 'local lane repair must not start an expensive route search') } })
  assert.equal(result.refined.length, count * 2, JSON.stringify(result.failures))
  assert.equal(state.routeAttempts ?? 0, 0)
  assert.equal(state.priority!.rootDone, count, 'unchanged room approaches are audited and reused')
  assert.equal(checkHeatingPlan([...fixture.coils, ...result.points.map(feed)], [], { maxCircuitLengthM: 120 }).errors, 0)
  assert.ok(result.points.some((points, goal) => JSON.stringify(points[0]) !== JSON.stringify(fixture.points[goal][0])))
  for (const goal of sources) {
    assert.deepEqual(result.points[goal].slice(2), fixture.points[goal].slice(2), 'every room approach and later bend stays intact')
    assert.equal(grid.room[grid.index(result.points[goal][0])], 1, 'the free end remains inside the source room')
    assert.ok(heatingPipeGeometry(feed(result.points[goal], goal)).bends.every((bend) => bend.radiusMm >= 79.9))
  }
})

test('rounded connections meet fractional coil endpoints exactly and keep their physical R80 clearance', () => {
  const width = 200, height = 200, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 400, y: 400 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: 400 + i % width * step, y: 400 + Math.floor(i / width) * step }),
    index: (p) => Math.round((p.y - 400) / step) * width + Math.round((p.x - 400) / step) }
  const settings = { diameterMm: 16, spacingMm: 100 }
  const points = [[600.8, 500.8], [700.8, 500.8], [700.8, 650.8], [600.8, 650.8], [600.8, 630.8], [680.8, 630.8], [680.8, 520.8], [600.8, 520.8]]
    .map(([x, y]) => ({ x, y }))
  const coil = createHeatingPipe('coil', points, { ...heatingPipeData(100), ...settings, automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
  const sourceStubs = [550, 570].map((y) => { const root = grid.index({ x: 440, y }); return Array.from({ length: 5 }, (_, i) => root + i) })
  const targetStubs = [points[0], points.at(-1)!].map((p) => { const cell = grid.index(p); return [cell, cell - 1] })
  const free = heatingPointClearance([coil], 16, 100, { joints: new Map([[coil.id, [points[0], points.at(-1)!]]]) })
  const blocked = Uint8Array.from(grid.wall, (_, cell) => free(grid.point(cell)) ? 0 : 1)
  for (const stub of [...sourceStubs, ...targetStubs]) for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  const flow = routeHeatingBundle(grid, sourceStubs.map((s) => s.at(-1)!), targetStubs.map((s) => s.at(-1)!), blocked, {})!
  assert.ok(flow)
  const refined = refineHeatingConnectionBundle(grid, flow, sourceStubs, targetStubs, [coil], settings, 100, { permittedWallCells: new Set() })
  assert.equal(refined.refined.length, 2, JSON.stringify(refined.failures))
  const supply = createHeatingPipe('supply', refined.points[0], { ...coil.heating!, pipeRole: 'supply' })
  const returning = createHeatingPipe('return', [...refined.points[1]].reverse(), { ...coil.heating!, pipeRole: 'return' })
  const end = heatingPipeGeometry(supply).points.at(-1)!, start = heatingPipeGeometry(returning).points[0]
  assert.ok(Math.hypot(end.x - points[0].x, end.y - points[0].y) < 1e-7)
  assert.ok(Math.hypot(start.x - points.at(-1)!.x, start.y - points.at(-1)!.y) < 1e-7)
  assert.equal(checkHeatingPlan([coil, supply, returning], []).errors, 0)
  assert.ok([supply, returning].every((pipe) => heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9)))
  const interrupted: HeatingConnectionRefinementState = {}, pause = new Error('cooperative pause')
  assert.throws(() => refineHeatingConnectionBundle(grid, flow, sourceStubs, targetStubs, [coil], settings, 100,
    { state: interrupted, permittedWallCells: new Set(), checkpoint: () => { if (interrupted.refined?.length === 1) throw pause } }),
    (error) => error === pause)
  assert.equal(interrupted.refined?.length, 0, 'an interrupted half-pair is rolled back')
  const completedLeg = interrupted.routeWork?.find((work) => work.result)
  assert.ok(completedLeg, 'the successful leg remains cached even though the half-pair is not committed')
  const resumed = refineHeatingConnectionBundle(grid, flow, sourceStubs, targetStubs, [coil], settings, 100,
    { state: interrupted, permittedWallCells: new Set() })
  assert.equal(resumed.refined.length, 2)
  assert.ok(interrupted.routeWork?.includes(completedLeg), 'resuming reuses the exact completed search')
  // Already completed pairs must survive another call without searching again.
  const retained = refineHeatingConnectionBundle(grid, flow, sourceStubs, targetStubs, [coil], settings, 100,
    { state: interrupted, permittedWallCells: new Set(), checkpoint: () => { throw new Error('completed pair was recomputed') } })
  assert.equal(retained.refined.length, 2)
  // An occupied virtual hardware port must not block loose zone ends.
  for (const stub of sourceStubs) grid.obstacle[stub[0]] = 1
  const source = { x: 440, y: 560 }
  const loose = refineHeatingConnectionBundle(grid, flow, sourceStubs, targetStubs, [coil], settings, 100,
    { sourcePosition: source, sourceRadiusMm: 500, permittedWallCells: new Set() })
  assert.equal(loose.refined.length, 2, JSON.stringify(loose.failures))
  const looseFeeds = loose.points.map((p, i) => createHeatingPipe(`loose-${i}`, i ? [...p].reverse() : p,
    { ...coil.heating!, pipeRole: i ? 'return' : 'supply' }))
  assert.equal(checkHeatingPlan([coil, ...looseFeeds], []).errors, 0)
  for (const p of loose.points) {
    assert.ok(Math.hypot(p[0].x - source.x, p[0].y - source.y) <= 40 + 1e-7)
    assert.equal(grid.obstacle[grid.index(p[0])], 0)
  }
})


test('larger nested connection bends survive saving without changing the pipe product minimum', () => {
  const data = { ...heatingPipeData(100), automatic: true, bendRadiusMm: 120, design: { minBendRadiusMm: 80 } }
  const pipe = createHeatingPipe('nested-bend', [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }], data)
  const restored = { ...pipe, heating: sanitizeHeating(JSON.parse(JSON.stringify(pipe.heating)))! }
  assert.equal(restored.heating.design!.minBendRadiusMm, 80)
  assert.equal(restored.heating.bendRadiusMm, 120)
  assert.ok(heatingPipeGeometry(restored).bends.every((bend) => Math.abs(bend.radiusMm - 120) < 1e-6))
})

test('individual nested bend radii survive serialization and retain their exact drawn lengths', () => {
  const pipe = createHeatingPipe('individual-bends', [{ x: 0, y: 0 }, { x: 40, y: 0, bendRadiusMm: 80 },
    { x: 40, y: 40, bendRadiusMm: 120 }, { x: 80, y: 40 }],
    { ...heatingPipeData(100), automatic: true, design: { minBendRadiusMm: 80 } })
  const before = heatingPipeGeometry(pipe)
  const restored = { ...pipe, heating: sanitizeHeating(JSON.parse(JSON.stringify(pipe.heating)))! }
  const after = heatingPipeGeometry(restored)
  assert.deepEqual(after.bends.map((bend) => Math.round(bend.radiusMm)), [80, 120])
  assert.ok(Math.abs(after.length - before.length) < 1e-7)
  const resumed = createHeatingPipe('resumed-individual-bends', after.points, restored.heating)
  assert.deepEqual(heatingPipeGeometry(resumed).bends.map((bend) => Math.round(bend.radiusMm)), [80, 120],
    'world-coordinate snapshots must retain the chosen radius at each corner')
})

test('loose connections use the actual source zone when a virtual ordering lane is occupied', () => {
  const width = 250, height = 180, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 400, y: 400 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [],
    point: (cell) => ({ x: 400 + cell % width * step, y: 400 + Math.floor(cell / width) * step }),
    index: (p) => Math.round((p.y - 400) / step) * width + Math.round((p.x - 400) / step) }
  const obstacle = { x: 465, y: 535, width: 13, height: 50 }
  for (let cell = 0; cell < size; cell++) { const p = grid.point(cell); if (p.x >= 464 && p.x <= 480 && p.y >= 534 && p.y <= 586) grid.obstacle[cell] = 1 }
  const vertices = [[600, 480], [700, 480], [700, 640], [600, 640], [600, 624], [684, 624], [684, 488], [600, 488]]
    .map(([x, y]) => ({ x, y }))
  const data = { ...heatingPipeData(100), diameterMm: 16, spacingMm: 100, automatic: true, circuitId: 'source-zone' }
  const coil = createHeatingPipe('zone-coil', vertices, { ...data, pipeRole: 'loop' })
  const stubs = [550, 570].map((y) => { const cell = grid.index({ x: 470, y }); return [cell, cell + 1] })
  const targets = [vertices[0], vertices.at(-1)!].map((p) => { const cell = grid.index(p); return [cell, cell - 1] })
  const flows = targets.map((stub, i) => ({ source: i, cells: [stubs[i].at(-1)!, stub.at(-1)!] }))
  const source = { x: 440, y: 560 }, deadline = Date.now() + 5000
  const result = refineHeatingConnectionBundle(grid, flows, stubs, targets, [coil], data, 100,
    { sourcePosition: source, sourceRadiusMm: 500, permittedWallCells: new Set(), obstacles: [obstacle],
      checkpoint() { assert.ok(Date.now() < deadline, 'an occupied virtual target must not monopolise the search') } })
  assert.equal(result.refined.length, 2, JSON.stringify(result.failures))
  const feeds = result.points.map((points, i) => createHeatingPipe(`zone-feed-${i}`, points, { ...data, pipeRole: 'supply', bendRadiusMm: result.bendRadiusMm[i] }))
  assert.equal(checkHeatingPlan([coil, ...feeds], [], undefined, [obstacle]).errors, 0)
  assert.ok(result.points.every((points) => Math.hypot(points[0].x - source.x, points[0].y - source.y) <= 40 + 1e-6))
})

test('a complete multi-circuit cached solution also places doorway tips inside the native source room', () => {
  const width = 170, height = 180, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: -100 }, step, width, height,
    wall: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    door: new Uint8Array(size), room: new Int32Array(size), rooms: [],
    point: (cell) => ({ x: cell % width * step, y: -100 + Math.floor(cell / width) * step }),
    index: (p) => Math.round((p.y + 100) / step) * width + Math.round(p.x / step) }
  for (let cell = 0; cell < size; cell++) { const p = grid.point(cell); grid.room[cell] = p.y >= 0 ? 1 : 2; if (Math.abs(p.y) <= 2) grid.door[cell] = 1 }
  const data = { ...heatingPipeData(100), diameterMm: 16, spacingMm: 100, automatic: true }
  const coils = [20, 80].map((x, i) => createHeatingPipe(`interior-coil-${i}`,
    [{ x, y: -40 }, { x, y: -80 }, { x: x + 20, y: -80 }, { x: x + 20, y: -40 }],
    { ...data, circuitId: `I${i}`, pipeRole: 'loop' }))
  const points = [20, 40, 80, 100].map((x) => [{ x, y: -1 }, { x, y: -40 }])
  const paths = points.map((p) => p.map(grid.index)), sources = [0, 1, 2, 3], radii = [80, 80, 80, 80]
  const solution = { paths, points, sources, bendRadiusMm: radii, refined: [...sources], failures: [] }
  const state: HeatingConnectionRefinementState = { priority: { rootDone: 2, queue: [], seen: [], expanded: 0, solution } }
  const result = refineHeatingConnectionBundle(grid, paths.map((cells, source) => ({ cells, source })),
    paths.map((p) => [p[0], p[0] - width]), paths.map((p) => [p.at(-1)!]), coils, data, 100,
    { fineGrid: true, state, sourcePosition: { x: 10, y: 10 }, sourceRadiusMm: 1500, permittedWallCells: new Set() })
  assert.equal(result.refined.length, 4, JSON.stringify(result.failures))
  assert.ok(result.points.every((p) => grid.room[grid.index(p[0])] === 1), 'global solution return uses the same final source validation as one circuit')
  assert.ok(state.priority!.solution!.points.every((p) => grid.room[grid.index(p[0])] === 1), 'the completed checkpoint retains the corrected tips')
  const feeds = result.points.map((p, goal) => createHeatingPipe(`interior-feed-${goal}`, p,
    { ...data, circuitId: `I${goal >> 1}`, pipeRole: 'supply' }))
  assert.equal(checkHeatingPlan([...coils, ...feeds], []).errors, 0)
})

test('improving coil interiors reuses safe unchanged entrances without searching the feeds again', () => {
  const width = 170, height = 180, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: -100 }, step, width, height,
    wall: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    door: new Uint8Array(size), room: new Int32Array(size), rooms: [],
    point: (cell) => ({ x: cell % width * step, y: -100 + Math.floor(cell / width) * step }),
    index: (p) => Math.round((p.y + 100) / step) * width + Math.round(p.x / step) }
  for (let cell = 0; cell < size; cell++) grid.room[cell] = grid.point(cell).y >= 0 ? 1 : 2
  const data = { ...heatingPipeData(100), diameterMm: 16, spacingMm: 100, automatic: true }
  const makeCoils = (bottom: number) => [20, 80].map((x, i) => createHeatingPipe(`coverage-coil-${i}`,
    [{ x, y: -40 }, { x, y: bottom }, { x: x + 20, y: bottom }, { x: x + 20, y: -40 }],
    { ...data, circuitId: `C${i}`, pipeRole: 'loop' }))
  const before = makeCoils(-70), after = makeCoils(-80)
  const points = [20, 40, 80, 100].map((x) => [{ x, y: 10 }, { x, y: -40 }])
  const paths = points.map((p) => p.map(grid.index))
  const state: HeatingConnectionRefinementState = { warmPairs: before.map((coil, i) => ({
    coilKey: JSON.stringify(heatingPipeGeometry(coil).points), points: points.slice(i * 2, i * 2 + 2), bendRadiusMm: [80, 80] })) }
  const result = refineHeatingConnectionBundle(grid, paths.map((cells, source) => ({ cells, source })),
    paths.map((p) => [p[0], p[0] - width]), paths.map((p) => [p.at(-1)!]), after, data, 100,
    { fineGrid: true, state, sourcePosition: { x: 10, y: 10 }, sourceRadiusMm: 1500, permittedWallCells: new Set(),
      checkpoint() { assert.equal(state.routeAttempts ?? 0, 0, 'unchanged safe entrances do not start a new route search') } })
  assert.equal(result.refined.length, 4, JSON.stringify(result.failures))
  assert.deepEqual(result.points, points)
  const feeds = result.points.map((p, goal) => createHeatingPipe(`coverage-feed-${goal}`, p,
    { ...data, circuitId: `C${goal >> 1}`, pipeRole: 'supply' }))
  assert.equal(checkHeatingPlan([...after, ...feeds], []).errors, 0)
})


test('flow lane suggestions preserve coil tangents and round short jogs at R80', () => {
  const guide = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 3.2 }, { x: 80, y: 3.2 }]
  const rounded = smoothHeatingFlowLanes(guide, 6.4, 0)
  const pipe = createHeatingPipe('lane', rounded, { ...heatingPipeData(100), automatic: true, circuitId: 'lane' })
  const curve = heatingPipeGeometry(pipe)
  assert.deepEqual(curve.points[0], guide[0])
  assert.deepEqual(curve.points.at(-1), guide.at(-1))
  assert.equal(curve.bends.length, 2)
  assert.ok(curve.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.deepEqual(guide[1], { x: 40, y: 0 })

  const route = [{ x: 2, y: 0 }, { x: 2, y: 30 }, { x: 50, y: 30 }, { x: 50, y: 40 }]
  const lanes = [{ x: 4, y: 0 }, { x: 4, y: 32 }, { x: 50, y: 32 }, { x: 50, y: 40 }]
  const candidates = [...alignHeatingFlowLegs(route, lanes, 6.4, 1.6)]
  assert.ok(candidates.some((points) => points[0].x === 4 && points[1].x === 4))
  assert.ok(candidates.every((points) => points.at(-1)!.x === 50 && points.at(-2)!.x === 50))

  const rooted = [{ x: 2, y: 0 }, { x: 2, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 60 }, { x: 120, y: 60 }]
  const assigned = [{ x: 5, y: 0 }, { x: 5, y: 28 }, { x: 100, y: 28 }]
  const trunk = [...alignHeatingFlowTrunk(rooted, assigned, 6.4, 1.6)]
  assert.ok(trunk.some((points) => points[1].x === 5 && points[2].y === 28))
  assert.ok(trunk.every((points) => points.at(-1) === rooted.at(-1) && points.at(-2)!.y === 60))
})
