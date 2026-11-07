import assert from 'node:assert/strict'
import test from 'node:test'
import { generateAutomaticHeatingPlan, planHeatingCircuits } from '../src/editor/automatic-heating-plan.ts'
import { buildHeatingGrid, routeHeating } from '../src/editor/heating-routing.ts'
import { heatingBounds, heatingFlowLmin, heatingLayout, heatingSchedule, presentHeatingTables } from '../src/editor/heating-plan.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import type { RectShape, Shape } from '../src/editor/model/types.ts'
import { rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'

const scene = (): Shape[] => {
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  return [...corners.map((start, i): Shape => ({ id: `wall-${i}`, kind: 'wall', start,
    end: corners[(i + 1) % 4], groupId: 'room-test', roomName: 'Living' })),
  { id: 'door-room-test', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } }]
}
const area = { x: 80, y: 80, width: 2216, height: 1384 }
const build = (shapes = scene()) => {
  let id = 0
  return generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 150 }, 100, () => `auto-${id++}`, area)
}

test('combines more than 24 provisional leg fields into twelve complete circuits', () => {
  const shapes: Shape[] = []
  for (let room = 0; room < 12; room++) {
    const x = 400 + room % 4 * 280, y = 400 + Math.floor(room / 4) * 280
    const corners = [{ x, y }, { x: x + 240, y }, { x: x + 240, y: y + 240 }, { x, y: y + 240 }]
    shapes.push(...corners.map((start, i): Shape => ({ id: `wall-${room}-${i}`, kind: 'wall', start,
      end: corners[(i + 1) % 4], groupId: `room-${room}`, roomName: `Room ${room + 1}` })))
    shapes.push({ id: `door-${room}`, kind: 'door', start: { x: x + 80, y }, end: { x: x + 160, y } })
    shapes.push({ id: `fridge-${room}`, kind: 'symbol', name: 'Refrigerator',
      path: 'symbols/Consumption appliances/Refrigerator.svg', position: { x: x + 120, y: y + 120 }, scale: 2 })
  }
  const position = { x: 180, y: 280 }, settings = { diameterMm: 16, spacingMm: 300 }
  const grid = buildHeatingGrid(shapes, 100, settings.spacingMm, position, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  const progress: number[] = [], rooms: string[] = []
  const budget = { routes: 1, onProgress: (value: { completedRooms?: number; roomName?: string }) => {
    progress.push(value.completedRooms ?? 0)
    if (value.roomName) rooms.push(value.roomName)
  } }
  const result = planHeatingCircuits(grid, settings, 100, position, { budget })
  assert.equal(budget.routes, 1, 'room merging must not consume the manifold routing budget')
  assert.equal(progress.at(-1), 12)
  assert.equal(rooms[0], 'Room 12', 'start merging the farthest room')
  assert.equal(rooms.at(-1), 'Room 1', 'finish with the nearest room')
  assert.equal(result.initialFieldCount, 48)
  assert.equal(result.jobs.length, 12)
  assert.equal(result.combiningFinished, true)
  assert.equal(new Set(result.jobs.map((job) => job.roomName)).size, 12)
  const boundedProgress: { completedRooms?: number; roomName?: string }[] = []
  const bounded = planHeatingCircuits(grid, settings, 100, position, { budget: {
    routes: 1, roomTimeMs: 0, onProgress: (value) => boundedProgress.push(value)
  } })
  assert.equal(bounded.combiningFinished, false)
  assert.equal(bounded.jobs.length, 48, 'an expired room keeps its unmerged leg fields')
  assert.equal(boundedProgress.at(-1)?.completedRooms, 12, 'one difficult room cannot prevent later rooms being processed')
  assert.equal(boundedProgress.find((p) => p.roomName)?.completedRooms, 0, 'announce the active room before its merge starts')
  assert.ok(Math.abs(bounded.jobs.reduce((sum, job) => sum + job.areaM2, 0) - result.jobs.reduce((sum, job) => sum + job.areaM2, 0)) < 1e-6)
  // An unfinished search must not be presented as a calculated demand for >24 circuits.
  assert.throws(() => generateAutomaticHeatingPlan(shapes, position, settings, 100, () => 'unused', area, 0, 0, { routes: 0 }),
    /deelvlakken nog niet volledig tot kringen samenvoegen/)
})

test('automatically detects rooms and connects full circuits to the manifold', () => {
  const result = build()
  assert.ok(result.rows.length > 0)
  assert.equal(result.shapes.filter((s) => s.heating?.kind === 'manifold').length, 1)
  assert.equal(result.shapes.filter((s) => s.heating?.kind === 'table').length, 1)
  for (const row of result.rows) {
    assert.ok(row.loopM > 0 && row.supplyM > 0 && row.returnM > 0)
    assert.ok(Math.abs(row.totalM - row.loopM - row.supplyM - row.returnM) < 1e-8)
    assert.ok(row.flowLmin > 0)
  }
  assert.deepEqual(heatingSchedule(sanitizeShapes(result.shapes) as RectShape[]), result.rows.map(({ checkMessages, ...row }) => row))
  const loops = result.rows.map((row) => row.loopM)
  assert.ok(Math.max(...loops) / Math.min(...loops) < 2)
  const restored = rescaleGroundPlan(rescaleGroundPlan([...scene(), ...result.shapes], 100, 50), 50, 100)
  for (const [index, shape] of [...scene(), ...result.shapes].entries()) {
    const original = shapeBounds(shape), actual = shapeBounds(restored[index])
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(original[key] - actual[key]) < 1e-8)
  }
  assert.ok(Math.abs(heatingFlowLmin(10) - 1.43485) < .001)
})

test('uses only rooms with a door or a staircase', () => {
  const shapes: Shape[] = []
  for (let room = 0; room < 3; room++) {
    const x = 400 + room * 320, corners = [{ x, y: 400 }, { x: x + 240, y: 400 },
      { x: x + 240, y: 640 }, { x, y: 640 }]
    shapes.push(...corners.map((start, i): Shape => ({ id: `access-wall-${room}-${i}`, kind: 'wall',
      start, end: corners[(i + 1) % corners.length] })))
  }
  shapes.push({ id: 'access-door', kind: 'door', start: { x: 480, y: 400 }, end: { x: 560, y: 400 } })
  shapes.push({ id: 'access-stairs', kind: 'symbol', name: 'Stairs', path: 'symbols/Floor plan/stairs-u-shaped.svg',
    position: { x: 920, y: 520 }, scale: 1 })
  const grid = buildHeatingGrid(shapes, 100, 150, { x: 180, y: 280 })
  assert.equal(grid.rooms.length, 2)
  const eligible = (point: { x: number; y: number }) => grid.rooms.some(({ id }) => grid.room[grid.index(point)] === id)
  assert.ok(eligible({ x: 520, y: 520 }), 'a room with a door remains eligible')
  assert.ok(eligible({ x: 920, y: 520 }), 'a room with stairs remains eligible')
  assert.ok(!eligible({ x: 1240, y: 520 }), 'a room with neither a door nor stairs is excluded')
})

test('generates a complete 16 mm / 100 mm plan rather than repeatedly rejecting its own bends', () => {
  let id = 0
  const result = generateAutomaticHeatingPlan(scene(), { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 100 },
    100, () => `pitch100-${id++}`, area, 0, 0, { routes: 600, deadline: Date.now() + 10000 })
  assert.ok(result.rows.length > 0)
  assert.equal(result.shapes.find((shape) => shape.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
  for (const row of result.rows) {
    assert.equal(row.spacingMm, 100)
    assert.ok(row.supplyM > 0 && row.loopM > 0 && row.returnM > 0)
    assert.ok(row.cutM! <= 100.05)
  }
  for (const pipe of result.shapes.filter((shape) => shape.heating?.kind === 'pipe')) {
    assert.equal(pipe.heating!.pattern, 'spiral')
    assert.ok(heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9), `${pipe.heating!.pipeRole} also requires R80`)
  }
})

test('completes seven rooms at 16/100 with a bounded number of distinct layouts and no tight connection bends', () => {
  const shapes: Shape[] = []
  for (let room = 0; room < 7; room++) {
    const x = 400 + room % 4 * 280, y = 400 + Math.floor(room / 4) * 280
    const corners = [{ x, y }, { x: x + 240, y }, { x: x + 240, y: y + 240 }, { x, y: y + 240 }]
    shapes.push(...corners.map((start, i): Shape => ({ id: `seven-${room}-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] })))
    shapes.push({ id: `door-${room}`, kind: 'door', start: { x: x + 80, y }, end: { x: x + 160, y } })
  }
  let id = 0
  const attempts = new Set<number>()
  const result = generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 100 },
    100, () => `seven-${id++}`, area, 0, 0, { routes: 600, deadline: Date.now() + 30000,
      onProgress: (p) => { if (p.phase === 'connections') attempts.add(p.attempt!) } })
  assert.equal(new Set(result.rows.map((row) => row.room)).size, 7)
  assert.ok(attempts.size <= 8)
  assert.ok(Math.max(...attempts) <= 8)
  assert.equal(result.shapes.find((shape) => shape.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
  for (const shape of result.shapes.filter((shape) => shape.heating?.kind === 'pipe')) {
    assert.ok(heatingPipeGeometry(shape).bends.every((bend) => bend.radiusMm >= 79.9))
  }
})

test('never runs a heating loop or its tails through a symbol footprint', () => {
  const obstacle: Shape = { id: 'cabinet', kind: 'symbol', name: 'Cabinet', path: 'custom.svg', position: { x: 600, y: 550 }, scale: 4 }
  const result = build([...scene(), obstacle]), box = shapeBounds(obstacle)
  for (const shape of result.shapes) {
    if (shape.heating?.kind !== 'pipe') continue
    const b = heatingBounds(shape), points = shape.heating.points!.map((p) => ({ x: b.x + p.x * b.width, y: b.y + p.y * b.height }))
    for (let i = 1; i < points.length; i++) for (let j = 0; j <= 100; j++) {
      const x = points[i - 1].x + (points[i].x - points[i - 1].x) * j / 100
      const y = points[i - 1].y + (points[i].y - points[i - 1].y) * j / 100
      assert.ok(!(x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height))
    }
  }
})

test('prefers a nearby door but permits a substantially shorter wall route', () => {
  const shapes = scene()
  shapes.push({ id: 'partition', kind: 'wall', start: { x: 600, y: 400 }, end: { x: 600, y: 720 } })
  shapes.push({ id: 'door', kind: 'door', start: { x: 600, y: 510 }, end: { x: 600, y: 570 }, wallId: 'partition' })
  const grid = buildHeatingGrid(shapes, 100, 150, { x: 180, y: 280 })
  const nearby = routeHeating(grid, grid.index({ x: 560, y: 540 }), grid.index({ x: 640, y: 540 }), { allowWalls: true })!
  assert.ok(nearby.some((i) => grid.door[i]))
  const shorter = routeHeating(grid, grid.index({ x: 560, y: 670 }), grid.index({ x: 640, y: 670 }), { allowWalls: true })!
  assert.ok(shorter.some((i) => grid.wall[i] && !grid.door[i]))
  assert.ok(!shorter.some((i) => grid.door[i]))
})

test('plans several rooms with doors and obstacles without manual zone drawing', () => {
  const shapes: Shape[] = []
  for (const [index, name] of ['Living', 'Kitchen'].entries()) {
    const x = 400 + index * 320, points = [{ x, y: 400 }, { x: x + 320, y: 400 }, { x: x + 320, y: 720 }, { x, y: 720 }]
    shapes.push(...points.map((start, i): Shape => ({ id: `${index}-${i}`, kind: 'wall', start, end: points[(i + 1) % 4], groupId: `room-${index}`, roomName: name })))
    shapes.push({ id: `obstacle-${index}`, kind: 'symbol', name: 'Refrigerator', path: 'symbols/Consumption appliances/Refrigerator.svg', position: { x: x + 160, y: 550 }, scale: 3 })
  }
  shapes.push({ id: 'door', kind: 'door', start: { x: 720, y: 520 }, end: { x: 720, y: 600 } })
  const result = build(shapes)
  assert.ok(result.rows.some((row) => row.room === 'Living'))
  assert.ok(result.rows.some((row) => row.room === 'Kitchen'))
  assert.ok(result.rows.length <= 24)
  assert.equal(result.shapes.find((s) => s.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
  assert.ok(result.rows.every((row) => row.cutM! <= 100.05))
})

test('puts the table on its own sheet when needed and recalculates totals from the source circuits', () => {
  const result = build([...scene(), { id: 'reserved', kind: 'rect', start: { x: 1000, y: 80 }, end: { x: 2100, y: 1400 } }])
  assert.equal(result.tableOnSeparatePage, true)
  const table = result.shapes.find((shape) => shape.heating?.kind === 'table')!
  table.heating!.sourcePageKey = 'source'
  const changed = result.shapes.filter((shape) => shape !== table).map((shape): RectShape => shape.heating?.pipeRole === 'supply'
    ? { ...shape, end: { ...shape.end, x: shape.end.x + 16 } } : shape)
  const live = presentHeatingTables([table], () => changed)[0] as RectShape
  assert.deepEqual(live.heating!.rows!.map(({ checkMessages, ...row }) => row), heatingSchedule(changed))
  assert.ok(live.heating!.audit!.issues.some((issue) => issue.code === 'continuity'))
  assert.notEqual(live.heating!.rows![0].totalM, result.rows[0].totalM)
})

test('keeps coils inside an L-shaped room rather than its rectangular bounding box', () => {
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 560 }, { x: 640, y: 560 }, { x: 640, y: 720 }, { x: 400, y: 720 }]
  const walls: Shape[] = corners.map((start, i) => ({ id: `l-${i}`, kind: 'wall', start, end: corners[(i + 1) % corners.length] }))
  walls.push({ id: 'l-door', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } })
  const result = build(walls)
  for (const shape of result.shapes.filter((s) => s.heating?.pipeRole === 'loop')) {
    const b = heatingBounds(shape)
    for (const p of shape.heating!.points!) {
      const x = b.x + p.x * b.width, y = b.y + p.y * b.height
      assert.ok(x > 400 && x < 800 && y > 400 && y < 720 && (x < 640 || y < 560))
    }
  }
})


test('the reported two-room plan has no geometry conflicts at 200 mm and a 90 m cut-length limit', () => {
  const shapes: Shape[] = []
  for (const room of [0, 1]) {
    const x = 400 + room * 320, corners = [{ x, y: 400 }, { x: x + 320, y: 400 }, { x: x + 320, y: 720 }, { x, y: 720 }]
    shapes.push(...corners.map((start, i): Shape => ({ id: `w-${room}-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4], groupId: `room-${room}`, roomName: `Room ${room}` })))
    shapes.push({ id: `fridge-${room}`, kind: 'symbol', name: 'Refrigerator', path: 'symbols/Consumption appliances/Refrigerator.svg', position: { x: x + 160, y: 550 }, scale: 3 })
  }
  shapes.push({ id: 'door', kind: 'door', start: { x: 720, y: 520 }, end: { x: 720, y: 600 } })
  let id = 0
  const result = generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 200, design: { minBendRadiusMm: 80, maxCircuitLengthM: 90, allowanceM: 3 } }, 100, () => `checked-${id++}`, area)
  const audit = result.shapes.find((s) => s.heating?.kind === 'manifold')!.heating!.audit!
  assert.equal(audit.errors, 0)
  assert.ok(result.rows.every((row) => row.cutM! <= 90.05))
  assert.ok(result.wallCrossings > 0, 'a manifold outside these rooms needs a wall passage')
  const owner = result.shapes.find((s) => s.heating?.kind === 'manifold')!
  const fixed = generateAutomaticHeatingPlan(shapes, owner.start, owner.heating!, 100, () => `fixed-${id++}`, area, 0, 0, {
    routes: 1, preserved: result.shapes.filter((s) => s.heating?.kind === 'pipe'), existingManifold: owner
  })
  assert.ok(fixed.wallCrossings > 0, 'retaining every circuit must retain its wall passage annotations')
  assert.equal(fixed.shapes.find((s) => s.heating?.kind === 'manifold')!.heating!.audit!.errors, 0)
})

test('stops an expired calculation before searching', () => {
  assert.throws(() => generateAutomaticHeatingPlan(scene(), { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 150 },
    100, () => 'unused', area, 0, 0, { routes: 600, deadline: Date.now() - 1 }), /rekentijd/)
})
