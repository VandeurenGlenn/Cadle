import assert from 'node:assert/strict'
import test from 'node:test'
import { measureHeatingCoverage, heatingCoverageSignature } from '../src/editor/heating-coverage.ts'
import { createHeatingPipe, heatingDefaults, sanitizeHeating } from '../src/editor/heating-plan.ts'
import { generateAutomaticHeatingPlan, heatingPlanScore } from '../src/editor/automatic-heating-plan.ts'
import { buildHeatingGrid, type HeatingGrid } from '../src/editor/heating-routing.ts'
import { buildHeatingSpiralFields } from '../src/editor/heating-spiral.ts'
import type { RectShape, Shape } from '../src/editor/model/types.ts'

const floor = (): HeatingGrid => {
  const width = 25, height = 17, size = width * height, wall = new Uint8Array(size), room = new Int32Array(size).fill(1)
  for (let i = 0; i < size; i++) if (! (i % width) || i % width === width - 1 || i < width || i >= size - width) wall[i] = 1
  return { origin: { x: 0, y: 0 }, step: 2, width, height, wall, room, door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    point: (i) => ({ x: i % width * 2, y: Math.floor(i / width) * 2 }), index: (p) => Math.round(p.y / 2) * width + Math.round(p.x / 2),
    rooms: [{ id: 1, name: 'Test', minX: 1, maxX: width - 2, minY: 1, maxY: height - 2, cells: [...room.keys()].filter((i) => !wall[i]) }] }
}
test('coverage follows drawn curves, measures real spacing and exposes missing floor', () => {
  const grid = floor()
  const pipes = [4, 12, 20, 28].map((y, i) => createHeatingPipe(`p${i}`, [{ x: 2, y }, { x: 46, y }], {
    ...heatingDefaults('pipe'), pipeRole: 'loop', circuitId: `VV0${i + 1}`, spacingMm: 100
  }))
  const full = measureHeatingCoverage(grid, pipes, 100, 100)
  assert.equal(full.coverage.rooms[0].gapM2, 0)
  assert.ok(Math.abs([...full.areaByCircuit.values()].reduce((a, b) => a + b, 0) - full.coverage.rooms[0].eligibleM2) < 1e-9)
  assert.ok([...full.spacingByCircuit.values()].every((s) => Math.abs(s.min - 100) < 1e-8 && Math.abs(s.max - 100) < 1e-8))
  const gap = measureHeatingCoverage(grid, [pipes[0]], 100, 100)
  assert.ok(gap.coverage.rooms[0].gapM2 > 0)
  assert.ok(gap.coverage.gaps.length > 0)
  const signature = heatingCoverageSignature(pipes)
  pipes[0].end.y++
  assert.notEqual(heatingCoverageSignature(pipes), signature)
})
const walls = (): Shape[] => {
  const c = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  return [...c.map((start, i): Shape => ({ id: `w${i}`, kind: 'wall', start, end: c[(i + 1) % 4] })),
    { id: 'door', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } }]
}
test('wall offset is independent of R80 and R100', () => {
  const position = { x: 180, y: 280 }, grid = buildHeatingGrid(walls(), 100, 150, position)
  const extent = (radius: number) => {
    const result = buildHeatingSpiralFields(grid, { diameterMm: 16, spacingMm: 150, edgeMm: 100, design: { minBendRadiusMm: radius } }, 100, position)
    return Math.min(...result.jobs.flatMap((job) => job.cells.map((cell) => grid.point(cell).x)))
  }
  assert.equal(extent(80), extent(100))
  assert.ok(extent(80) < 420, 'the wall offset must not grow to 320 mm because R80 is used')
})
test('capacity, exclusions and locked circuit settings survive saving', () => {
  const data = sanitizeHeating({ ...heatingDefaults('manifold'), capacity: 12, circuitLocked: true, excludedRoomKeys: ['region-2'], planningRooms: [{ key: 'region-2', name: 'Keuken' }] })!
  assert.equal(data.capacity, 12); assert.equal(data.circuitLocked, true); assert.deepEqual(data.excludedRoomKeys, ['region-2'])
  assert.equal(sanitizeHeating({ ...heatingDefaults('exclusion') })!.kind, 'exclusion')
})
test('a drawn forbidden zone blocks both loop and connection routing', () => {
  const source = walls()
  source.push({ id: 'forbidden', kind: 'rect', start: { x: 550, y: 500 }, end: { x: 650, y: 600 }, heating: heatingDefaults('exclusion') })
  const grid = buildHeatingGrid(source, 100, 100, { x: 180, y: 280 })
  const cell = grid.index({ x: 600, y: 550 })
  assert.equal(grid.obstacle[cell], 1)
  assert.equal(grid.loopObstacle[cell], 1)
})
test('complete proposal scoring compares connection cost after complete circuit lengths', () => {
  const make = (crossings: number, length: number): any => ({ shapes: [], wallCrossings: crossings, rows: [{ supplyM: length, returnM: length, totalM: 90 }] })
  const noWall = heatingPlanScore(make(0, 10)), shortcut = heatingPlanScore(make(1, 1))
  assert.ok(shortcut[5] < noWall[5])
  assert.ok(heatingPlanScore(make(0, 1))[6] < heatingPlanScore(make(1, 1))[6], 'prefer a doorway when connection lengths tie')
})
test('scoped recalculation preserves the other room, its ports and every fixed path', () => {
  const source = walls()
  source.push({ id: 'partition', kind: 'wall', start: { x: 600, y: 400 }, end: { x: 600, y: 720 } },
    { id: 'internal-door', kind: 'door', start: { x: 600, y: 520 }, end: { x: 600, y: 600 } })
  let id = 0
  const settings = { diameterMm: 16, spacingMm: 100, capacity: 12, edgeMm: 100 }
  const area = { x: 80, y: 80, width: 2216, height: 1384 }, point = { x: 180, y: 280 }
  const before = generateAutomaticHeatingPlan(source, point, settings, 100, () => `scope-${id++}`, area)
  const owner = before.shapes.find((s) => s.heating?.kind === 'manifold')!
  const keys = [...new Set(before.rows.map((r) => r.roomKey))]
  assert.equal(keys.length, 2)
  assert.equal(owner.heating!.capacity, 12)
  assert.equal(owner.heating!.points!.length, 24, 'unused ports remain available on the actual manifold')
  assert.throws(() => generateAutomaticHeatingPlan(source, point, { ...settings, capacity: 1 }, 100, () => `too-small-${id++}`, area), /verdeler heeft 1/)
  const preserved = before.shapes.filter((s) => s.heating?.kind === 'pipe' && s.heating.roomKey !== keys[0])
  const geometry = (s: RectShape) => JSON.stringify([s.id, s.start, s.end, s.heating!.points])
  const originals = preserved.map(geometry)
  const after = generateAutomaticHeatingPlan(source, point, settings, 100, () => `scope-${id++}`, area, 0, 0,
    { routes: 600, preserved, existingManifold: owner, onlyRoom: keys[0] })
  for (const old of originals) assert.ok(after.shapes.some((s) => s.heating?.kind === 'pipe' && geometry(s) === old))
  for (const pipe of preserved) {
    const port = Number(pipe.heating!.circuitId!.slice(2)) - 1
    const newOwner = after.shapes.find((s) => s.heating?.kind === 'manifold')!
    assert.deepEqual(newOwner.heating!.points!.slice(port * 2, port * 2 + 2), owner.heating!.points!.slice(port * 2, port * 2 + 2))
  }
  assert.equal(after.shapes.find((s) => s.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
})
