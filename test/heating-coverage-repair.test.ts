import assert from 'node:assert/strict'
import test from 'node:test'
import type { Shape } from '../src/editor/model/types.ts'
import { buildHeatingGrid, heatingCurveWallConflict, type HeatingGrid } from '../src/editor/heating-routing.ts'
import { generateHeatingAreaLoop, rectangularHeatingArea } from '../src/editor/heating-area-kernel.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { measureHeatingCoverage } from '../src/editor/heating-coverage.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { heatingCoverageRepairGaps, repairHeatingCoverageLoops } from '../src/editor/heating-coverage-repair.ts'

const fixture = () => {
  const corners = [[0, 0], [480, 0], [480, 240], [0, 240]]
  const scene: Shape[] = corners.map(([x, y], i) => ({ kind: 'wall', id: `wall-${i}`, start: { x, y },
    end: { x: corners[(i + 1) % 4][0], y: corners[(i + 1) % 4][1] }, strokeWidth: 2 }))
  const settings = { diameterMm: 16, spacingMm: 100, edgeMm: 100, design: { maxCircuitLengthM: 120, minBendRadiusMm: 80 } }
  const native = buildHeatingGrid(scene, 100, 100, { x: 32, y: 12 },
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true })
  const body = generateHeatingAreaLoop(rectangularHeatingArea({ x: 20, y: 20, width: 144, height: 192 }, { x: 20, y: 20 }), settings, 100)!
  assert.ok(body)
  const data = { ...heatingPipeData(100), ...settings, automatic: true, circuitId: 'VV01', roomKey: `region-${native.rooms[0].id}` }
  const loop = createHeatingPipe('loop', body.points, { ...data, pipeRole: 'loop' })
  const first = body.points[0], last = body.points.at(-1)!
  const outward = (head: typeof first, next: typeof first) => {
    const length = Math.hypot(head.x - next.x, head.y - next.y)
    return { x: head.x + (head.x - next.x) / length * 16, y: head.y + (head.y - next.y) / length * 16 }
  }
  const supply = createHeatingPipe('supply', [outward(first, body.points[1]), first], { ...data, pipeRole: 'supply' })
  const returning = createHeatingPipe('return', [last, outward(last, body.points.at(-2)!)], { ...data, pipeRole: 'return' })
  assert.equal(checkHeatingPlan([loop, supply, returning], [], settings.design).errors, 0)
  return { native, settings, loop, supply, returning, pipes: [loop, supply, returning] }
}

test('a bounded interior patch improves full coverage while preserving the circuit and fixed feed ports', () => {
  const { native, settings, loop, supply, returning, pipes } = fixture()
  const feedBytes = JSON.stringify([supply, returning]), inputBytes = JSON.stringify(pipes)
  const baseline = measureHeatingCoverage(native, pipes, 100, 100, 100, () => {}, false).coverage
  assert.equal(baseline.gaps.length, 2000, 'the preview overlay alone is truncated')
  let checkpoints = 0
  const result = repairHeatingCoverageLoops(native, pipes, settings, 100,
    { baselineCoverage: baseline, maxAccepted: 1, maxCandidates: 96, searchMs: 6000, onAccepted: () => { checkpoints++ } })
  assert.equal(result.acceptedPatches.length, 1, JSON.stringify(result.rejected))
  assert.equal(checkpoints, 1)
  assert.deepEqual(result.changedCircuitIds, ['VV01'])
  assert.equal(result.pipes.length, 3)
  assert.equal(result.pipes[1], supply)
  assert.equal(result.pipes[2], returning)
  assert.equal(JSON.stringify([supply, returning]), feedBytes)
  assert.equal(JSON.stringify(pipes), inputBytes, 'the input plan is immutable')
  const previous = heatingPipeGeometry(loop), next = heatingPipeGeometry(result.pipes[0])
  for (const [a, b] of [[previous.points[0], next.points[0]], [previous.points.at(-1)!, next.points.at(-1)!]]) {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7)
  }
  const heading = (a: typeof previous.points) => [Math.sign(a[1].x - a[0].x), Math.sign(a[1].y - a[0].y),
    Math.sign(a.at(-1)!.x - a.at(-2)!.x), Math.sign(a.at(-1)!.y - a.at(-2)!.y)]
  assert.deepEqual(heading(next.points), heading(previous.points))
  assert.ok(next.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.equal(heatingCurveWallConflict(native, next.pieces, { permittedWallCells: new Set() }), undefined)
  assert.equal(checkHeatingPlan(result.pipes, [], settings.design).errors, 0)
  assert.ok(result.pipes.reduce((sum, p) => sum + heatingPipeGeometry(p).length * 100 / 8000, 0) <= 120)
  const measured = measureHeatingCoverage(native, result.pipes, 100, 100, 100, () => {}, false).coverage
  assert.deepEqual(result.coverage, measured)
  assert.ok(measured.rooms[0].gapM2 < baseline.rooms[0].gapM2 - 1)
  assert.ok(result.uncoveredCells > 2000, 'later uncovered cells remain reported instead of being truncated')
})

test('locked circuits, the mutable allowlist and search bounds preserve all shapes', () => {
  const { native, settings, pipes, loop } = fixture()
  for (const options of [{ mutableCircuitIds: new Set<string>() }, { maxCandidates: 0 }, { maxAccepted: 0 }, { searchMs: 0 }]) {
    const result = repairHeatingCoverageLoops(native, pipes, settings, 100, options)
    assert.equal(result.attempts, 0)
    assert.deepEqual(result.changedCircuitIds, [])
    result.pipes.forEach((pipe, i) => assert.equal(pipe, pipes[i]))
  }
  loop.heating!.circuitLocked = true
  const locked = repairHeatingCoverageLoops(native, pipes, settings, 100, { mutableCircuitIds: new Set(['VV01']) })
  assert.equal(locked.attempts, 0)
  assert.equal(locked.pipes[0], loop)
  loop.heating!.circuitLocked = false
  pipes[1].locked = true
  const lockedFeed = repairHeatingCoverageLoops(native, pipes, settings, 100, { mutableCircuitIds: new Set(['VV01']) })
  assert.equal(lockedFeed.attempts, 0, 'a lock on any circuit part protects the entire hydraulic circuit')
  assert.equal(lockedFeed.pipes[0], loop)
  const cancelled = new Error('pause requested by caller')
  assert.throws(() => repairHeatingCoverageLoops(native, pipes, settings, 100,
    { checkpoint: () => { throw cancelled } }), (error) => error === cancelled)
})

test('a host without spare length cannot gain a patch or change its feeds', () => {
  const { native, settings, pipes } = fixture()
  for (const pipe of pipes) pipe.heating!.design = { ...settings.design, maxCircuitLengthM: 20 }
  const before = JSON.stringify(pipes)
  const result = repairHeatingCoverageLoops(native, pipes, settings, 100, { maxCandidates: 8, searchMs: 2000 })
  assert.deepEqual(result.changedCircuitIds, [])
  assert.equal(JSON.stringify(result.pipes), before)
  assert.ok(result.rejected['length-budget'] > 0)
})

const transitFixture = () => {
  const corners = [[24, -240], [58, -240], [58, 20], [164, 20], [164, 212], [20, 212], [20, 20], [24, 20]]
  const scene: Shape[] = corners.map(([x, y], i) => ({ kind: 'wall', id: `transit-${i}`, start: { x, y },
    end: { x: corners[(i + 1) % corners.length][0], y: corners[(i + 1) % corners.length][1] }, strokeWidth: 2 }))
  const settings = { diameterMm: 16, spacingMm: 100, edgeMm: 100, design: { maxCircuitLengthM: 120, minBendRadiusMm: 80 } }
  const native = buildHeatingGrid(scene, 100, 100, { x: 38.4, y: -220 },
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true })
  const body = generateHeatingAreaLoop(rectangularHeatingArea({ x: 20, y: 20, width: 144, height: 192 }, { x: 20, y: 20 }), settings, 100)!
  const data = { ...heatingPipeData(100), ...settings, automatic: true, circuitId: 'VV01', roomKey: `region-${native.rooms[0].id}` }
  const loop = createHeatingPipe('transit-loop', body.points, { ...data, pipeRole: 'loop' })
  const first = body.points[0], last = body.points.at(-1)!
  const supply = createHeatingPipe('transit-supply', [{ x: first.x, y: -220 }, first], { ...data, pipeRole: 'supply' })
  const returning = createHeatingPipe('transit-return', [last, { x: last.x, y: -220 }], { ...data, pipeRole: 'return' })
  return { native, settings, loop, supply, returning, pipes: [loop, supply, returning] }
}

test('a narrow transit strip is covered by spreading a feed interior while retaining both ends and the complete circuit', () => {
  // This 60 mm uncovered strip cannot contain an R80 U patch. The two actual
  // transit pipes can spread through it without changing the circuit's ports.
  const { native, settings, loop, supply, returning } = transitFixture()
  const pipes = [loop, supply, returning], bytes = JSON.stringify(pipes)
  assert.equal(checkHeatingPlan(pipes, [], settings.design).errors, 0)
  const baseline = measureHeatingCoverage(native, pipes, 100, 100, 100, () => {}, false).coverage
  const result = repairHeatingCoverageLoops(native, pipes, settings, 100,
    { baselineCoverage: baseline, maxCandidates: 16, maxAccepted: 1, searchMs: 3000 })
  assert.equal(result.acceptedPatches.length, 1, JSON.stringify(result.rejected))
  assert.equal(result.pipes.length, 3)
  assert.equal(result.pipes[0], loop)
  assert.equal(result.pipes[2], returning)
  assert.notEqual(result.pipes[1], supply)
  assert.ok(result.acceptedPatches[0].bounds.width * 100 / 8 < 160)
  const before = heatingPipeGeometry(supply), after = heatingPipeGeometry(result.pipes[1])
  assert.deepEqual(after.points[0], before.points[0])
  assert.deepEqual(after.points.at(-1), before.points.at(-1))
  assert.equal(Math.sign(after.points[1].y - after.points[0].y), Math.sign(before.points[1].y - before.points[0].y))
  assert.equal(Math.sign(after.points.at(-1)!.y - after.points.at(-2)!.y), Math.sign(before.points.at(-1)!.y - before.points.at(-2)!.y))
  assert.ok(after.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.equal(heatingCurveWallConflict(native, after.pieces, { permittedWallCells: new Set() }), undefined)
  assert.equal(checkHeatingPlan(result.pipes, [], settings.design).errors, 0)
  assert.ok(result.pipes.reduce((sum, p) => sum + heatingPipeGeometry(p).length * 100 / 8000, 0) <= 120)
  assert.equal(result.coverage.rooms[0].eligibleM2, baseline.rooms[0].eligibleM2)
  assert.ok(result.coverage.rooms[0].gapM2 < baseline.rooms[0].gapM2 - .09)
  assert.equal(JSON.stringify(pipes), bytes)
  supply.locked = true
  const locked = repairHeatingCoverageLoops(native, pipes, settings, 100, { maxAccepted: 1, searchMs: 3000 })
  assert.equal(locked.attempts, 0, 'locking a feed also protects its coil and its partner feed')
  assert.deepEqual(locked.pipes, pipes)
})

test('a third host receives a patch attempt before two nearer trapped coils exhaust the search budget', () => {
  const { native, settings, loop } = fixture(), roomKey = `region-${native.rooms[0].id}`
  const trapped = (id: string, x: number) => {
    const body = generateHeatingAreaLoop(rectangularHeatingArea({ x, y: 20, width: 64, height: 64 }, { x, y: 20 }), settings, 100)!
    const pipe = createHeatingPipe(id, body.points, { ...heatingPipeData(100), ...settings, automatic: true,
      circuitId: id, roomKey, pipeRole: 'loop' })
    pipe.heating!.design = { ...settings.design, maxCircuitLengthM: heatingPipeGeometry(pipe).length / 80 + 60 }
    return pipe
  }
  const nearA = trapped('near-a', 260), nearB = trapped('near-b', 350)
  // Solid fixtures surround the nearer coils. They retain ample hydraulic
  // slack, but no splice can escape without crossing a solid fixture.
  const obstacles = [260, 350].flatMap((x) => [
    { x: x - 10, y: 10, width: 84, height: 4 }, { x: x - 10, y: 90, width: 84, height: 4 },
    { x: x - 10, y: 10, width: 4, height: 84 }, { x: x + 70, y: 10, width: 4, height: 84 },
  ])
  for (let cell = 0; cell < native.obstacle.length; cell++) {
    const p = native.point(cell)
    if (obstacles.some((box) => p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)) native.obstacle[cell] = 1
  }
  const pipes = [nearA, nearB, loop], before = JSON.stringify(pipes)
  assert.equal(checkHeatingPlan(pipes, [], settings.design, obstacles).errors, 0)
  const baseline = measureHeatingCoverage(native, pipes, 100, 100, 100, () => {}, false).coverage
  const result = repairHeatingCoverageLoops(native, pipes, settings, 100,
    { baselineCoverage: baseline, obstacles, maxCandidates: 40, maxAccepted: 1, searchMs: 6000 })
  assert.equal(result.acceptedPatches.length, 1, JSON.stringify(result.rejected))
  assert.deepEqual(result.changedCircuitIds, ['VV01'])
  assert.ok(result.rejected.connector >= 32, 'both nearer hosts must actually fail their first variant')
  assert.ok(result.attempts <= 40)
  assert.equal(result.pipes[0], nearA)
  assert.equal(result.pipes[1], nearB)
  assert.equal(JSON.stringify(pipes), before)
  const oldGeometry = heatingPipeGeometry(loop), geometry = heatingPipeGeometry(result.pipes[2])
  for (const [a, b] of [[geometry.points[0], oldGeometry.points[0]], [geometry.points.at(-1)!, oldGeometry.points.at(-1)!]]) {
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7)
  }
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(geometry.length / 80 <= 120)
  assert.equal(checkHeatingPlan(result.pipes, [], settings.design, obstacles).errors, 0)
  assert.ok(result.coverage.rooms[0].gapM2 < baseline.rooms[0].gapM2 - 5)
  assert.equal(result.coverage.rooms[0].eligibleM2, baseline.rooms[0].eligibleM2)
})

test('bounded native gap proposals retain broad patches and later rooms beside many larger narrow components', () => {
  const width = 260, height = 140, step = 1.6, size = width * height
  const room = new Int32Array(size).fill(-1), firstCells: number[] = [], laterCells: number[] = []
  const rectangle = (cells: number[], id: number, left: number, top: number, w: number, h: number) => {
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) {
      const cell = y * width + x
      room[cell] = id; cells.push(cell)
    }
  }
  // Every 80 mm strip has more cells than either broad patch. A global area
  // top-24 alone therefore omits both the broad first-room patch and room 2.
  for (let i = 0; i < 30; i++) rectangle(firstCells, 1, 4 + i * 7, 5, 4, 120)
  rectangle(firstCells, 1, 215, 100, 15, 15)
  rectangle(laterCells, 2, 235, 40, 20, 20)
  const native: HeatingGrid = { origin: { x: 0, y: 0 }, step, width, height, wall: new Uint8Array(size),
    door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room,
    rooms: [firstCells, laterCells].map((cells, i) => ({ id: i + 1, name: `Room ${i + 1}`, cells,
      minX: 0, maxX: width - 1, minY: 0, maxY: height - 1 })),
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const baseline = measureHeatingCoverage(native, [], 100, 100, 100, () => {}, false).coverage
  const turnMinimum = (80 * 2 + 16) * 8 / 100
  const proposals = heatingCoverageRepairGaps(native, [], 100, 100, 100, 0, () => {}, undefined, turnMinimum)
  assert.equal(proposals.rectangles.length, 24)
  assert.equal(proposals.uncovered, firstCells.length + laterCells.length)
  assert.ok(proposals.rectangles.some((box) => box.roomKey === 'region-1' && Math.min(box.width, box.height) >= turnMinimum))
  assert.ok(proposals.rectangles.some((box) => box.roomKey === 'region-1' && Math.min(box.width, box.height) < turnMinimum))
  assert.ok(proposals.rectangles.some((box) => box.roomKey === 'region-2' && Math.min(box.width, box.height) >= turnMinimum))
  assert.deepEqual(measureHeatingCoverage(native, [], 100, 100, 100, () => {}, false).coverage, baseline,
    'proposal diversity must preserve the native floor mask and coverage criteria')
})


test('spreading a feed preserves its existing source-wall crossing without opening new wall cells', () => {
  const { native, settings, pipes } = transitFixture()
  const wallRow = Math.floor(native.index({ x: 40, y: -216 }) / native.width)
  for (let x = 0; x < native.width; x++) native.wall[wallRow * native.width + x] = 1
  const allowed = pipes.map((pipe) => {
    const cells = new Set<number>()
    for (const piece of heatingPipeGeometry(pipe).pieces) {
      const count = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (native.step / 2)))
      for (let i = 0; i <= count; i++) {
        const cell = native.index({ x: piece.a.x + (piece.b.x - piece.a.x) * i / count,
          y: piece.a.y + (piece.b.y - piece.a.y) * i / count })
        if (cell >= 0 && native.wall[cell] && !native.door[cell]) cells.add(cell)
      }
    }
    return cells
  })
  assert.ok(allowed[1].size > 0 && allowed[2].size > 0)
  const baseline = measureHeatingCoverage(native, pipes, 100, 100, 100, () => {}, false).coverage
  const result = repairHeatingCoverageLoops(native, pipes, settings, 100,
    { baselineCoverage: baseline, maxCandidates: 16, maxAccepted: 1, searchMs: 3000 })
  assert.equal(result.acceptedPatches.length, 1, JSON.stringify(result.rejected))
  assert.notEqual(result.pipes[1], pipes[1])
  result.pipes.forEach((pipe, i) => assert.equal(heatingCurveWallConflict(native, heatingPipeGeometry(pipe).pieces,
    { allowWalls: true, permittedWallCells: allowed[i] }), undefined))
  assert.ok(heatingCurveWallConflict(native, heatingPipeGeometry(result.pipes[1]).pieces, { permittedWallCells: new Set() }),
    'the repaired feed still uses its existing source-wall crossing')
  const before = heatingPipeGeometry(pipes[1]), after = heatingPipeGeometry(result.pipes[1])
  assert.deepEqual(after.points[0], before.points[0])
  assert.deepEqual(after.points.at(-1), before.points.at(-1))
  assert.ok(after.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.equal(checkHeatingPlan(result.pipes, [], settings.design).errors, 0)
  assert.ok(result.coverage.rooms[0].gapM2 < baseline.rooms[0].gapM2 - .09)
})
