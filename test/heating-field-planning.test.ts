import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHeatingGrid, routeHeating, simplifyHeatingPath, segmentDistance, type HeatingGrid } from '../src/editor/heating-routing.ts'
import { buildHeatingSpiralFields, openHeatingTurns, rectangularHeatingSpiral } from '../src/editor/heating-spiral.ts'
import { pruneRedundantHeatingFields, deferHeatingFeedRemnants } from '../src/editor/heating-field-pruning.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { balancedHeatingCuts } from '../src/editor/heating-field-balance.ts'
import { heatingConnectionZone } from '../src/editor/heating-connection-zone.ts'
import { mergeHeatingJobs } from '../src/editor/automatic-heating-plan.ts'
import { measureHeatingCoverage } from '../src/editor/heating-coverage.ts'

const settings = { diameterMm: 16, spacingMm: 100 }
const roomScene = (): Shape[] => {
  const corners = [{ x: 400, y: 400 }, { x: 640, y: 400 }, { x: 640, y: 640 }, { x: 400, y: 640 }]
  return [...corners.map((start, i): Shape => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] })),
    { id: 'door', kind: 'door', start: { x: 480, y: 400 }, end: { x: 560, y: 400 } }]
}

test('keeps a small overflow available for a neighbouring circuit instead of creating two half-loaded circuits', () => {
  const box = { left: 0, right: 100, top: 0, bottom: 30 }
  const measure = (part: typeof box) => part.right - part.left + 10
  const result = balancedHeatingCuts(box, 2, true, 100, 5, .02, { x: 0, y: 0 }, 0, [], measure, { atEnd: true, maxM: 90 })
  const lengths = result.cuts.slice(0, -1).map((start, i) => result.cuts[i + 1] - start + 10)
  assert.ok(lengths.every((length) => length <= 90))
  assert.ok(lengths[0] >= lengths[1] * 2)
  assert.equal(result.cuts[0], box.left)
  assert.equal(result.cuts.at(-1), box.right)
})

test('16/100 preserves both laying pitch and R80 on the routing grid', () => {
  const grid = buildHeatingGrid(roomScene(), 100, 100, { x: 500, y: 500 }, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const cellMm = grid.step * 100 / 8
  assert.equal(100 / cellMm, Math.round(100 / cellMm))
  assert.equal(80 / cellMm, Math.round(80 / cellMm))
  assert.ok(cellMm >= 16, 'adjacent routed tubes retain physical clearance')
})

test('removes a doorway-only field without removing a field that heats unique floor', () => {
  const grid = buildHeatingGrid(roomScene(), 100, 100, { x: 500, y: 500 })
  const main = buildHeatingSpiralFields(grid, settings, 100, { x: 180, y: 280 }).jobs
  assert.equal(main.length, 1)
  const doorway = { ...main[0], cells: [grid.index({ x: 500, y: 400 }), grid.index({ x: 502, y: 400 })] }
  const fields = [...main, doorway]
  pruneRedundantHeatingFields(grid, fields, settings, 100, () => {})
  assert.deepEqual(fields, main)
  const alone = [doorway, main[0]]
  pruneRedundantHeatingFields(grid, alone, settings, 100, () => {})
  assert.deepEqual(alone, main, 'the real floor field remains even when it is the last candidate')
})

test('removes a short redundant field even when it owns some nearest floor cells', () => {
  const width = 100, height = 100, size = width * height, step = 1.6
  const cells = Array.from({ length: 41 }, (_, y) => Array.from({ length: 5 }, (_, x) => (y + 30) * width + x + 48)).flat()
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 },
    rooms: [{ id: 1, name: 'Narrow strip', cells, minX: 48, maxX: 52, minY: 30, maxY: 70 }],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size).fill(1),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const fields = [49, 51].map((x) => ({ cells: Array.from({ length: 41 }, (_, y) => (y + 30) * width + x), roomName: 'Narrow strip', areaM2: .04, spacingMinMm: 100, spacingMaxMm: 100 }))
  const pipes = fields.map((field, i) => createHeatingPipe(`field-${i}`, field.cells.map(grid.point), { ...heatingDefaults('pipe', 100), ...settings, automatic: true, pipeRole: 'loop', circuitId: `VV${i}` }))
  const before = measureHeatingCoverage(grid, pipes, 100, 100, 100, () => {}, false)
  assert.ok([...before.areaByCircuit.values()].every((area) => area > 0))
  pruneRedundantHeatingFields(grid, fields, settings, 100, () => {})
  assert.equal(fields.length, 1)
  const remaining = createHeatingPipe('remaining', fields[0].cells.map(grid.point), { ...pipes[0].heating!, circuitId: 'remaining' })
  assert.equal(measureHeatingCoverage(grid, [remaining], 100, 100, 100, () => {}, false).coverage.rooms[0].gapM2, before.coverage.rooms[0].gapM2)
})

test('routes around an obstacle inside the rounded corner, beyond the square rays', () => {
  const width = 240, height = 240, size = width * height, step = .8
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 }, rooms: [],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const start = 160 * width + 40, end = 40 * width + 200
  const shortest = routeHeating(grid, start, end, { radiusCells: 16, startDirection: 1, endDirection: -width })!
  assert.ok(shortest)
  const make = (cells: number[]) => createHeatingPipe('route', openHeatingTurns(simplifyHeatingPath(cells.map(grid.point)), 6.4, 1.28),
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, pipeRole: 'supply' })
  const original = heatingPipeGeometry(make(shortest))
  const arc = original.pieces.find((piece) => Math.abs(piece.a.x - piece.b.x) > .01 && Math.abs(piece.a.y - piece.b.y) > .01 && !shortest.includes(grid.index({ x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 })))!
  const obstacle = grid.index({ x: (arc.a.x + arc.b.x) / 2, y: (arc.a.y + arc.b.y) / 2 })
  assert.ok(!shortest.includes(obstacle), 'the obstruction lies inside the arc, off the square rays')
  const point = grid.point(obstacle), occupied = new Set<number>()
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) occupied.add(obstacle + y * width + x)
  const routed = routeHeating(grid, start, end, { radiusCells: 16, startDirection: 1, endDirection: -width, occupied })!
  assert.ok(routed, 'a safe alternative is found')
  const geometry = heatingPipeGeometry(make(routed))
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(geometry.pieces.every((piece) => segmentDistance(point, piece.a, piece.b) >= 1.28))
})

test('an unfinished isolated field does not prevent a valid merge elsewhere', () => {
  const width = 200, height = 150, size = width * height, step = 1.6
  const cells = Array.from({ length: size }, (_, i) => i)
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 },
    rooms: [{ id: 1, name: 'Shared zone', cells, minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size).fill(1),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  for (let y = 90; y <= 140; y++) for (let x = 145; x <= 190; x++) if (x === 145 || x === 190 || y === 90 || y === 140) grid.obstacle[y * width + x] = 1
  const raster = (x: number, y: number, span: number) => {
    const vertices = rectangularHeatingSpiral(span * step, span * step, settings, 100)!.map((p) => grid.index({ x: x * step + p.x, y: y * step + p.y }))
    const path = [vertices[0]]
    for (const end of vertices.slice(1)) {
      const start = path.at(-1)!, stride = start % width === end % width ? Math.sign(end - start) * width : Math.sign(end - start)
      for (let cell = start + stride; cell !== end + stride; cell += stride) path.push(cell)
    }
    return path
  }
  const jobs = [[40, 40, 40], [90, 40, 40], [150, 100, 30]].map(([x, y, span], i) => ({
    cells: raster(x, y, span), sourceMask: 1 << i, rectangular: true, roomName: 'Shared zone', roomKey: 'region-1',
    areaM2: (span * .02) ** 2, spacingMinMm: 100, spacingMaxMm: 100 }))
  const source = grid.point(15 * width + 20), zone = heatingConnectionZone(grid, [], source, 12, 16, 80, 100)
  mergeHeatingJobs(grid, jobs, new Set(jobs.flatMap((job) => job.cells)), { ...settings, connectionMode: 'zone', shareSmallRooms: true }, 100, source, 1, 2,
    { connectionZone: zone, targetCount: 2, routes: 600, deadline: Date.now() + 4000, roomDeadline: Date.now() + 3000 })
  assert.equal(jobs.length, 2)
  assert.ok(jobs.some((job) => job.sourceMask === 3), 'the two reachable fields merge')
  assert.ok(jobs.some((job) => job.sourceMask === 4), 'the unfinished field stays present for subsequent planning')
})

test('a tight offset joins with real R80 curves rather than a staircase or a long detour', () => {
  const width = 200, height = 200, size = width * height, step = 1.6
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 },
    rooms: [{ id: 1, name: 'Zone', cells: Array.from({ length: size }, (_, i) => i), minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 }],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size).fill(1),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const jobs = [[60, 50, 100], [65, 107, 157]].map(([x, first, last], i) => ({
    cells: Array.from({ length: last - first + 1 }, (_, y) => (y + first) * width + x), sourceMask: 1 << i,
    roomName: 'Zone', areaM2: .1, spacingMinMm: 100, spacingMaxMm: 100, points: undefined as { x: number; y: number }[] | undefined }))
  const source = { x: 32, y: 24 }, zone = heatingConnectionZone(grid, [], source, 12, 16, 80, 100)
  mergeHeatingJobs(grid, jobs, new Set(jobs.flatMap((job) => job.cells)), { ...settings, connectionMode: 'zone' }, 100, source, 1, 0,
    { connectionZone: zone, targetCount: 1, routes: 100, deadline: Date.now() + 3000 })
  assert.equal(jobs.length, 1)
  assert.ok(jobs[0].points?.some((p, i, all) => i > 0 && Math.abs(p.x - all[i - 1].x) > .01 && Math.abs(p.y - all[i - 1].y) > .01))
  const pipe = createHeatingPipe('joined', openHeatingTurns(jobs[0].points!, 6.4, 1.28), { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
  const geometry = heatingPipeGeometry(pipe)
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(geometry.length / 80 < 2.5)
})


test('feed remnants remain part of the native floor coverage calculation', () => {
  const width = 100, height = 100, size = width * height, step = 1.6, cells = Array.from({ length: size }, (_, i) => i)
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 },
    rooms: [{ id: 1, name: 'Room', cells, minX: 0, minY: 0, maxX: 99, maxY: 99 }],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size).fill(1), feedReservation: new Uint8Array(size),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  for (let y = 20; y <= 60; y++) grid.feedReservation![y * width + 30] = 1
  const fields = [35, 90].map((x) => ({ cells: Array.from({ length: 41 }, (_, i) => (i + 20) * width + x), roomName: 'Room', areaM2: .04, spacingMinMm: 100, spacingMaxMm: 100 }))
  const far = fields[1], original = grid.rooms[0].cells.slice()
  deferHeatingFeedRemnants(grid, fields, 100, 100, () => {})
  assert.deepEqual(fields, [far], 'a remote strip still needs its own laying geometry')
  assert.deepEqual(grid.rooms[0].cells, original, 'deferred strips are still measured against the actual completed pipes')
  assert.ok(grid.loopObstacle.every((value) => value === 0))
})

test('parallel rounded feeds may share space discarded by their virtual square corners', () => {
  const width = 120, height = 145, size = width * height, step = .4
  const grid: HeatingGrid = { drawingScale: 100, width, height, step, origin: { x: 0, y: 0 }, rooms: [],
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const world = (x: number, y: number) => ({ x: x * step, y: y * step })
  const outer = createHeatingPipe('outer', [world(10, 30), world(80, 30), world(80, 130)],
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, pipeRole: 'supply', circuitId: 'outer', design: { minBendRadiusMm: 100 } })
  const geometry = heatingPipeGeometry(outer), occupied = new Set<number>(), corridor = new Set<number>()
  for (let cell = 0; cell < size; cell++) {
    const p = grid.point(cell), x = cell % width, y = Math.floor(cell / width)
    if (geometry.pieces.some((piece) => segmentDistance(p, piece.a, piece.b) < 1.28 - 1e-6)) occupied.add(cell)
    if (y === 34 && x >= 10 && x <= 60 || x === 76 && y >= 50 && y <= 130 ||
      x >= 60 && x <= 76 && y >= 34 && y <= 50 && Math.abs(Math.hypot(x - 60, y - 50) - 16) <= .7) corridor.add(cell)
  }
  assert.ok(occupied.has(34 * width + 76), 'the square control corner lies on the neighbouring outer arc')
  const cells = routeHeating(grid, 34 * width + 10, 130 * width + 76,
    { radiusCells: 32, startDirection: 1, endDirection: width, occupied, requiredCorridor: corridor })
  assert.ok(cells, 'the tangent-point search finds the physically clear inner arc')
  const inner = createHeatingPipe('inner', simplifyHeatingPath(cells.map(grid.point)),
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, pipeRole: 'return', circuitId: 'inner' })
  const result = heatingPipeGeometry(inner)
  assert.ok(result.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(result.pieces.every((piece) => geometry.pieces.every((other) => {
    // Every sample on the rendered inner tube retains full physical clearance.
    return segmentDistance(piece.a, other.a, other.b) >= 1.28 - .01 && segmentDistance(piece.b, other.a, other.b) >= 1.28 - .01
  })))
})
