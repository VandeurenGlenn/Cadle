import assert from 'node:assert/strict'
import test from 'node:test'
import { assignRoomLabel, isRoomLabel, nextRoomLabelId } from '../src/editor/room-labels.ts'
import { buildHeatingGrid } from '../src/editor/heating-routing.ts'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { createHeatingPipe, heatingDefaults, heatingSchedule, heatingScheduleCSV } from '../src/editor/heating-plan.ts'
import { cloneShapes, sanitizeShapes } from '../src/editor/model/model.ts'
import { rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import type { Point, Shape, RectShape } from '../src/editor/model/types.ts'

const walls = (corners: Point[], prefix: string): Shape[] => corners.map((start, i) =>
  ({ id: `${prefix}-${i}`, kind: 'wall', start, end: corners[(i + 1) % corners.length] }))
const rectangle = (x: number, prefix = 'room') => walls([{ x, y: 400 }, { x: x + 320, y: 400 },
  { x: x + 320, y: 720 }, { x, y: 720 }], prefix)
const anchor = { x: 180, y: 280 }
let id = 0
const next = () => `room-label-${++id}`
const gridFor = (shapes: Shape[]) => buildHeatingGrid(shapes, 100, 200, anchor)

test('click labels identify actual rooms and distinguish equal names by their ID', () => {
  let shapes = [...rectangle(400, 'left'), ...rectangle(720, 'right')]
  shapes = assignRoomLabel(shapes, gridFor(shapes), { x: 500, y: 500 }, { id: 'R01', name: 'Living' }, next).shapes
  assert.equal(nextRoomLabelId(shapes), 'R02')
  shapes = assignRoomLabel(shapes, gridFor(shapes), { x: 850, y: 500 }, { id: 'R02', name: 'Living' }, next).shapes
  assert.deepEqual(gridFor(shapes).rooms.map((room) => room.name).sort(), ['R01 – Living', 'R02 – Living'])
  const before = shapes.filter(isRoomLabel)
  shapes = assignRoomLabel(shapes, gridFor(shapes), { x: 520, y: 550 }, { id: 'R03', name: 'Kitchen' }, next).shapes
  const labels = shapes.filter(isRoomLabel)
  assert.equal(labels.length, 2)
  assert.equal(labels[0].id, before[0].id)
  assert.deepEqual(labels[0].position, before[0].position)
  assert.equal(labels[0].text, 'R03\nKitchen')
  assert.equal(nextRoomLabelId(shapes), 'R01')
  assert.throws(() => assignRoomLabel(shapes, gridFor(shapes), { x: 500, y: 500 }, { id: 'r02', name: 'Duplicate' }, next), /al in gebruik/)
  assert.throws(() => assignRoomLabel(shapes, gridFor(shapes), { x: 200, y: 200 }, { id: 'R04', name: 'Outside' }, next), /gesloten ruimte/)
})

test('an L-shaped room label does not name the neighbouring room inside its bounding box', () => {
  let shapes = [...walls([{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 560 },
    { x: 560, y: 560 }, { x: 560, y: 800 }, { x: 400, y: 800 }], 'L'),
    ...walls([{ x: 560, y: 560 }, { x: 800, y: 560 }, { x: 800, y: 800 }, { x: 560, y: 800 }], 'inner')]
  shapes = assignRoomLabel(shapes, gridFor(shapes), { x: 450, y: 650 }, { id: 'R01', name: 'Hall' }, next).shapes
  shapes = assignRoomLabel(shapes, gridFor(shapes), { x: 680, y: 680 }, { id: 'R02', name: 'Storage' }, next).shapes
  const g = gridFor(shapes)
  assert.equal(g.rooms.find((room) => room.id === g.room[g.index({ x: 700, y: 450 })])?.name, 'R01 – Hall')
  assert.equal(g.rooms.find((room) => room.id === g.room[g.index({ x: 680, y: 680 })])?.name, 'R02 – Storage')
})

test('room labels survive saving, undo cloning, scale changes and escaped SVG export', () => {
  const base = rectangle(400), result = assignRoomLabel(base, gridFor(base), { x: 500, y: 500 }, { id: 'R01', name: '<Living>' }, next)
  assert.deepEqual(sanitizeShapes(result.shapes), result.shapes)
  assert.deepEqual(cloneShapes(result.shapes), result.shapes)
  assert.deepEqual(rescaleGroundPlan(rescaleGroundPlan(result.shapes, 100, 50), 50, 100), result.shapes)
  assert.match(shapeMarkup(result.annotation, false), /&lt;Living&gt;/)
})

test('label edits update all three circuit parts and retain room heat loads without rerouting', () => {
  const base = rectangle(400), grid = gridFor(base), name = grid.rooms[0].name
  const loop = createHeatingPipe('loop', [{ x: 480, y: 480 }, { x: 640, y: 480 }],
    { ...heatingDefaults('pipe', 100), circuitId: 'VV01', pipeRole: 'loop', roomName: name })
  const supply = createHeatingPipe('supply', [anchor, { x: 480, y: 480 }],
    { ...loop.heating!, pipeRole: 'supply' })
  const returning = createHeatingPipe('return', [{ x: 640, y: 480 }, anchor], { ...loop.heating!, pipeRole: 'return' })
  const manifold: RectShape = { id: 'manifold', kind: 'rect', start: anchor, end: { x: 240, y: 308 },
    heating: { ...heatingDefaults('manifold'), design: { roomHeatLoadsW: { [name]: 500 } } } }
  const result = assignRoomLabel([...base, loop, supply, returning, manifold], grid, { x: 500, y: 550 }, { id: 'R01', name: 'Living' }, next)
  for (const original of [loop, supply, returning]) {
    const changed = result.shapes.find((shape) => shape.id === original.id)!
    assert.equal(changed.heating!.roomName, 'R01 – Living')
    assert.equal(changed.heating!.roomKey, result.annotation.id)
    assert.deepEqual(changed.heating!.points, original.heating!.points)
  }
  assert.deepEqual(result.shapes.find((shape) => shape.id === 'manifold')!.heating!.design!.roomHeatLoadsW, { 'R01 – Living': 500 })
  assert.equal(heatingSchedule(result.shapes.filter((shape): shape is RectShape => shape.kind === 'rect'))[0].room, 'R01 – Living')
})

test('generated circuits and CSV use the clicked room ID and name', () => {
  const base = rectangle(400), shapes = assignRoomLabel(base, gridFor(base), { x: 500, y: 500 }, { id: 'R01', name: 'Living' }, next).shapes
  const label = shapes.find(isRoomLabel)!
  const result = generateAutomaticHeatingPlan(shapes, anchor, { diameterMm: 16, spacingMm: 200 }, 100, next,
    { x: 80, y: 80, width: 2216, height: 1384 })
  assert.ok(result.rows.length)
  assert.ok(result.rows.every((row) => row.room === 'R01 – Living'))
  assert.ok(result.shapes.filter((shape) => shape.heating?.kind === 'pipe').every((shape) => shape.heating!.roomKey === label.id))
  assert.match(heatingScheduleCSV(result.rows), /R01 – Living/)
})
