import assert from 'node:assert/strict'
import test from 'node:test'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { buildHeatingGrid, routeHeating } from '../src/editor/heating-routing.ts'
import { heatingBounds, heatingFlowLmin, heatingLayout, heatingSchedule, presentHeatingTables } from '../src/editor/heating-plan.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import type { RectShape, Shape } from '../src/editor/model/types.ts'
import { rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'

const scene = (): Shape[] => {
  const corners = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 720 }, { x: 400, y: 720 }]
  return corners.map((start, i) => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4], groupId: 'room-test', roomName: 'Living' }))
}
const area = { x: 80, y: 80, width: 2216, height: 1384 }
const build = (shapes = scene()) => {
  let id = 0
  return generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 150 }, 100, () => `auto-${id++}`, area)
}

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
})
