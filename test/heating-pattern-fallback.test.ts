import test from 'node:test'
import assert from 'node:assert/strict'
import { rectangularHeatingSpiral, rectangularHeatingField, openHeatingTurns, buildHeatingSpiralFields, rectangularHeatingMeander } from '../src/editor/heating-spiral.ts'
import { createHeatingPipe, heatingDefaults, heatingLayout, heatingMarkup, sanitizeHeating } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { joinHeatingZoneFields } from '../src/editor/heating-zone-join.ts'
import { buildHeatingGrid } from '../src/editor/heating-routing.ts'
import { heatingRoomKey } from '../src/editor/heating-coverage.ts'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import type { Point, RectShape, Shape } from '../src/editor/model/types.ts'

const settings = { diameterMm: 16, spacingMm: 100 }
const pipe = (points: Point[]) => createHeatingPipe('test-pipe', openHeatingTurns(points, 6.4, 1.28), { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: 'VV01', pipeRole: 'loop' })

test('keeps a valid spiral as the first choice', () => {
  const field = rectangularHeatingField(240, 240, settings, 100)!
  assert.equal(field.pattern, 'spiral')
  assert.deepEqual(field.points, rectangularHeatingSpiral(240, 240, settings, 100))
})

test('uses an actual meander when a narrow spiral would push R80 turns outside its field', () => {
  assert.equal(rectangularHeatingSpiral(160, 12.8, settings, 100, undefined, 'x'), null)
  const field = rectangularHeatingField(160, 12.8, settings, 100, undefined, 'x')!
  assert.equal(field.pattern, 'meander')
  assert.equal(field.points.length, 4, 'two long heating runs and one return')
  const geometry = heatingPipeGeometry(pipe(field.points))
  assert.ok(geometry.bends.length > 0)
  assert.ok(geometry.bends.every((b) => b.radiusMm >= 79.9))
  assert.ok(geometry.pieces.every((p) => [p.a, p.b].every((q) => q.x >= -1e-6 && q.y >= -1e-6 && q.x <= 160.000001 && q.y <= 12.800001)))
  assert.equal(checkHeatingPlan([pipe(field.points)], []).errors, 0)
})

test('a narrow manual zone falls back without adding circuits and reports its real pattern', () => {
  const shape: RectShape = { id: 'narrow', kind: 'rect', start: { x: 100, y: 100 }, end: { x: 276, y: 128.8 },
    heating: { ...heatingDefaults('zone', 100), ...settings, circuits: 1 } }
  const layout = heatingLayout(shape)
  assert.equal(layout.circuits.length, 1)
  assert.equal(layout.pattern, 'meander')
  assert.equal(layout.warning, undefined)
  assert.match(heatingMarkup(shape), /Meander/)
  assert.equal((layout.circuits[0].path.match(/M /g) ?? []).length, 1)
  assert.equal(sanitizeHeating({ ...shape.heating, pattern: 'meander' })!.pattern, 'meander')
  assert.equal(sanitizeHeating({ ...shape.heating, pattern: 'mixed' })!.pattern, 'mixed')
})

test('joins a spiral and a meander into one continuous mixed circuit with valid curves', () => {
  const left = rectangularHeatingSpiral(160, 160, settings, 100, undefined, 'x')!.map((p) => ({ x: 160 - p.x, y: p.y }))
  const right = rectangularHeatingMeander(160, 160, settings, 100, undefined, 'x')!.map((p) => ({ x: p.x + 184, y: p.y + 4 }))
  const joined = joinHeatingZoneFields([[left], [right]], { x: 0, y: 0, width: 344, height: 164 }, [], 8, 6.4,
    (points, remaining) => !checkHeatingPlan([points, ...remaining].map((p, i) => ({ ...pipe(p), id: `part-${i}`, heating: { ...pipe(p).heating!, circuitId: `VV${i + 1}` } })), []).errors,
    (points) => points === right ? 'meander' : 'spiral')!
  assert.ok(joined)
  assert.equal(joined.pattern, 'mixed')
  assert.equal(checkHeatingPlan([pipe(joined.points)], []).errors, 0)
  assert.equal((heatingPipeGeometry(pipe(joined.points)).path.match(/M /g) ?? []).length, 1)
})

test('a connection fallback changes only its failed room, retaining spirals elsewhere', () => {
  const shapes: Shape[] = []
  for (const x of [400, 680]) {
    const c = [{ x, y: 400 }, { x: x + 240, y: 400 }, { x: x + 240, y: 640 }, { x, y: 640 }]
    shapes.push(...c.map((start, i): Shape => ({ id: `w-${x}-${i}`, kind: 'wall', start, end: c[(i + 1) % 4] })),
      { id: `d-${x}`, kind: 'door', start: { x: x + 80, y: 400 }, end: { x: x + 160, y: 400 } })
  }
  const point = { x: 180, y: 280 }, grid = buildHeatingGrid(shapes, 100, 100, point), failed = heatingRoomKey(grid.rooms[0])
  const result = buildHeatingSpiralFields(grid, { ...settings, preferMeanderRoomKeys: [failed] }, 100, point)
  assert.ok(result.jobs.some((job) => job.roomKey === failed))
  assert.ok(result.jobs.filter((job) => job.roomKey === failed).every((job) => job.pattern === 'meander'))
  assert.ok(result.jobs.filter((job) => job.roomKey !== failed).every((job) => job.pattern === 'spiral'))
})

test('an automatic narrow-room fallback saves its actual pattern and complete supply/return geometry', () => {
  const c = [{ x: 400, y: 400 }, { x: 800, y: 400 }, { x: 800, y: 428.8 }, { x: 400, y: 428.8 }]
  const shapes: Shape[] = c.map((start, i) => ({ id: `narrow-wall-${i}`, kind: 'wall', start, end: c[(i + 1) % 4] }))
  shapes.push({ id: 'narrow-door', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } })
  let id = 0
  const result = generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { ...settings, connectionMode: 'zone', capacity: 12 }, 100,
    () => `fallback-${id++}`, { x: 80, y: 80, width: 2216, height: 1384 })
  const owner = result.shapes.find((s) => s.heating?.kind === 'manifold')!
  assert.equal(owner.heating!.pattern, 'meander')
  assert.equal(owner.heating!.audit!.errors, 0)
  assert.equal(result.rows.length, 1)
  assert.ok(result.rows[0].supplyM > 0 && result.rows[0].returnM > 0)
  assert.ok(result.shapes.filter((s) => s.heating?.kind === 'pipe').every((s) => sanitizeHeating(JSON.parse(JSON.stringify(s.heating)))!.pattern === 'meander'))
  assert.ok(result.shapes.filter((s) => s.heating?.kind === 'table').every((s) => heatingMarkup(s).includes('Meander')))
})
