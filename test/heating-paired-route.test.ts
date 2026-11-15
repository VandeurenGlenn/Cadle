import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { offsetHeatingRoute, routePairedHeatingFeeds, heatingFeedPairCoherent } from '../src/editor/heating-paired-route.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import type { HeatingGrid } from '../src/editor/heating-routing.ts'

test('a shared R90 route produces separate R80 and R100 pipes at 20 mm centres', () => {
  const middle = [{ x: 0, y: 0 }, { x: 40, y: 0, bendRadiusMm: 90 }, { x: 40, y: 50 }]
  const pipes = [-.8, .8].map((offset, i) => createHeatingPipe(`parallel-${i}`, offsetHeatingRoute(middle, offset, 90, 100),
    { ...heatingPipeData(100), automatic: true, circuitId: `VV0${i + 1}` }))
  assert.deepEqual(pipes.map((p) => Math.round(heatingPipeGeometry(p).bends[0].radiusMm)).sort((a, b) => a - b), [80, 100])
  assert.equal(checkHeatingPlan(pipes, []).errors, 0)
  assert.ok(Math.abs(heatingPipeGeometry(pipes[0]).points[0].y - heatingPipeGeometry(pipes[1]).points[0].y) >= 1.59999)
})

test('individually clear feeds that wrap different sides of another room are not reused as a paired corridor', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-approach-lane-conflict.json', import.meta.url), 'utf8'))
  const pair = (id: string) => fixture.fixed.filter((pipe) => pipe.circuitId === id).map((pipe, i) =>
    createHeatingPipe(`cached-${id}-${i}`, pipe.points, { ...fixture.coils[0].heating, circuitId: id, pipeRole: 'supply' }))
  const divided = pair('VV10'), together = pair('VV02')
  assert.equal(checkHeatingPlan([...fixture.coils, ...divided], []).errors, 0, 'each cached leg is physically clear in isolation')
  assert.equal(heatingFeedPairCoherent(divided, 100, 100, fixture.source), false, 'a large enclosing detour can seal another circuit approach')
  assert.equal(heatingFeedPairCoherent(together, 100, 100, fixture.source), true)
})

for (const staggered of [false, true]) test(`both feeds pass an obstacle together and preserve their exact coil joints (${staggered})`, () => {
  const width = 300, height = 240, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => { const x = Math.round(p.x / step), y = Math.round(p.y / step); return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x } }
  const points = [[120, 30], [200, 30], [200, 150], [120, 150], [120, 134], [184, 134], [184, 38], [120, 38]].map(([x, y]) => ({ x, y }))
  if (staggered) points.at(-1)!.x -= 8
  const data = { ...heatingPipeData(100), automatic: true, diameterMm: 16, spacingMm: 100, circuitId: 'VV01' }
  const coil = createHeatingPipe('coil', points, { ...data, pipeRole: 'loop' })
  const obstacle = createHeatingPipe('fixed', [{ x: 90, y: 0 }, { x: 90, y: 70 }], { ...data, circuitId: 'VV02', pipeRole: 'supply' })
  const result = routePairedHeatingFeeds(grid, coil, [coil], [obstacle], data, 100,
    { source: { x: 30, y: 90 }, sourceRadiusMm: 500, permittedWallCells: new Set(), checkpoint() {} })
  assert.ok(result)
  const pipes = result.map((points, i) => createHeatingPipe(`feed-${i}`, points, { ...data, pipeRole: 'supply' }))
  for (const [i, pipe] of pipes.entries()) {
    const geometry = heatingPipeGeometry(pipe)
    assert.deepEqual(geometry.points.at(-1), points[i ? points.length - 1 : 0])
    assert.ok(geometry.bends.every((b) => b.radiusMm >= 79.9))
  }
  assert.equal(checkHeatingPlan([coil, obstacle, ...pipes], []).errors, 0)
})

test('a pair can leave a shallow apron by narrowing inside its turn', () => {
  const width = 300, height = 260, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: Uint8Array.from({ length: size }, (_, i) => Math.floor(i / width) >= 248 ? 1 : 0),
    door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => { const x = Math.round(p.x / step), y = Math.round(p.y / step); return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x } }
  const points = [[120, 30], [200, 30], [200, 150], [120, 150], [120, 134], [184, 134], [184, 38], [120, 38]]
    .map(([x, y]) => ({ x: y + 60, y: 308.8 - x }))
  const data = { ...heatingPipeData(100), automatic: true, diameterMm: 16, spacingMm: 100, circuitId: 'VV01' }
  const coil = createHeatingPipe('shallow-coil', points, { ...data, pipeRole: 'loop' })
  const result = routePairedHeatingFeeds(grid, coil, [coil], [], data, 100,
    { source: { x: 30, y: 180 }, sourceRadiusMm: 500, permittedWallCells: new Set(), checkpoint() {} })
  assert.ok(result, '100 mm-spaced ends turn into a 20 mm pair in less than a 140 mm apron')
  const feeds = result.map((p, i) => createHeatingPipe(`shallow-feed-${i}`, p, { ...data, pipeRole: 'supply' }))
  assert.equal(checkHeatingPlan([coil, ...feeds], []).errors, 0)
  for (const feed of feeds) {
    const geometry = heatingPipeGeometry(feed)
    assert.ok(geometry.bends.every((b) => b.radiusMm >= 79.9))
    assert.ok(geometry.pieces.every((piece) => piece.a.y < 198.4 && piece.b.y < 198.4))
  }
})

test('a tight opposite turn after the launch retains both R80 fillets', () => {
  const width = 300, height = 260, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: Uint8Array.from({ length: size }, (_, i) => Math.floor(i / width) >= 248 ? 1 : 0),
    door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => { const x = Math.round(p.x / step), y = Math.round(p.y / step); return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x } }
  const vertices = [[120, 30], [200, 30], [200, 150], [120, 150], [120, 134], [184, 134], [184, 38], [120, 38]]
    .map(([x, y]) => ({ x: y + 60, y: 296 - x }))
  const data = { ...heatingPipeData(100), automatic: true, diameterMm: 16, spacingMm: 100, circuitId: 'tight' }
  const coil = createHeatingPipe('tight-coil', vertices, { ...data, pipeRole: 'loop' }), source = { x: 76, y: 194 }
  const result = routePairedHeatingFeeds(grid, coil, [coil], [], data, 100,
    { source, sourceRadiusMm: 50, permittedWallCells: new Set(), checkpoint() {} })
  assert.ok(result)
  const feeds = result.map((points, i) => createHeatingPipe(`tight-${i}`, points, { ...data, pipeRole: 'supply' }))
  assert.equal(checkHeatingPlan([coil, ...feeds], []).errors, 0)
  assert.ok(feeds.every((pipe) => heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9)))
  assert.ok(result.every((points) => Math.hypot(points[0].x - source.x, points[0].y - source.y) <= 4.01))
})

test('pausing a paired query preserves its budget slot until the query completes', () => {
  const width = 300, height = 240, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => { const x = Math.round(p.x / step), y = Math.round(p.y / step); return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x } }
  const data = { ...heatingPipeData(100), automatic: true, diameterMm: 16, spacingMm: 100, circuitId: 'budget' }
  const coil = createHeatingPipe('budget-coil', [[120, 30], [200, 30], [200, 150], [120, 150], [120, 134], [184, 134], [184, 38], [120, 38]]
    .map(([x, y]) => ({ x, y })), { ...data, pipeRole: 'loop' })
  const searchBudget = { remaining: 1 }, paused = new Error('pause')
  let started = false
  const options = { source: { x: 30, y: 90 }, sourceRadiusMm: 500, permittedWallCells: new Set<number>(), searchBudget, searchKey: 'budget-test' }
  assert.throws(() => routePairedHeatingFeeds(grid, coil, [coil], [], data, 100,
    { ...options, onSearch() { started = true }, checkpoint() { if (started) throw paused } }), (error) => error === paused)
  assert.equal(searchBudget.remaining, 1, 'an unfinished query has not consumed its slot')
  const result = routePairedHeatingFeeds(grid, coil, [coil], [], data, 100, { ...options, checkpoint() {} })
  assert.ok(result, 'resuming can complete the same query with its retained slot')
  assert.equal(searchBudget.remaining, 0)
})
