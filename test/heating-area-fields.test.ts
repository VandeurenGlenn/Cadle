import assert from 'node:assert/strict'
import test from 'node:test'
import type { Shape } from '../src/editor/model/types.ts'
import { buildHeatingGrid, heatingCurveWallConflict } from '../src/editor/heating-routing.ts'
import { buildHeatingAreaFields } from '../src/editor/heating-area-fields.ts'
import { heatingPairedEntries } from '../src/editor/heating-spiral.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingEntryTangentConflict } from '../src/editor/heating-clearance.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('sharing a small room keeps both feed ends together and uses its doorway without closing the inlet', () => {
  const wall = (a: number[], b: number[], id: string): Shape => ({ kind: 'wall', id,
    start: { x: a[0], y: a[1] }, end: { x: b[0], y: b[1] } })
  const scene: Shape[] = [wall([0, 0], [240, 0], 'north'), wall([240, 0], [240, 160], 'east'),
    wall([240, 160], [0, 160], 'south'), wall([0, 160], [0, 0], 'west'), wall([160, 0], [160, 160], 'partition'),
    { kind: 'door', id: 'opening', start: { x: 160, y: 50 }, end: { x: 160, y: 110 } }]
  const source = { x: 10, y: 80 }, native = buildHeatingGrid(scene, 100, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
  assert.equal(native.rooms.length, 2)
  const group = { ...native.rooms[0], cells: native.rooms.flatMap((r) => r.cells),
    members: native.rooms.map((r) => ({ key: `region-${r.id}`, name: r.name })) }
  const settings = { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 120 } }
  const result = buildHeatingAreaFields({ ...native, rooms: [group] }, scene, settings, 100, source,
    { nativeGrid: native, targets: new Map([[`region-${group.id}`, 1]]), capacity: 1, fixedCounts: true, checkpoint() {} })
  assert.equal(result.failedRoom, undefined)
  assert.equal(result.jobs.length, 1, 'one shared room pair remains one hydraulic circuit')
  const points = result.jobs[0].points!
  assert.ok(heatingPairedEntries(points, 100, 100, native.step), 'inserting the second room preserves the host inlet pair')
  const pipe = createHeatingPipe('shared', points, { ...heatingDefaults('pipe', 100), ...settings,
    automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
  const geometry = heatingPipeGeometry(pipe)
  assert.equal(checkHeatingPlan([pipe], [], settings.design).errors, 0)
  assert.equal(heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() }), undefined)
  assert.equal(heatingEntryTangentConflict(pipe), undefined, 'the patch connectors leave both R80 feed approaches free')
  assert.ok(geometry.bends.every((b) => b.radiusMm >= 79.9))
  assert.ok(geometry.points.some((p) => p.x < 160) && geometry.points.some((p) => p.x > 160))
})

test('fragments of one room keep space for all eight feed tubes instead of just their local coils', () => {
  const vertices = [[0, 0], [640, 0], [640, 320], [0, 320]]
  const scene: Shape[] = vertices.map(([x, y], i) => ({ kind: 'wall', id: `outer-${i}`,
    start: { x, y }, end: { x: vertices[(i + 1) % 4][0], y: vertices[(i + 1) % 4][1] }, strokeWidth: 2 }))
  const source = { x: 40, y: 160 }, native = buildHeatingGrid(scene, 100, 100, source,
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true }), feedCorridor = new Uint8Array(native.wall.length)
  for (let cell = 0; cell < feedCorridor.length; cell++) if (Math.abs(native.point(cell).x - 320) <= native.step / 2) feedCorridor[cell] = 1
  const result = buildHeatingAreaFields({ ...native, feedCorridor }, scene,
    { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 120 } }, 100, source,
    { nativeGrid: native, reserveFeeds: true, targets: new Map([[`region-${native.rooms[0].id}`, 4]]),
      capacity: 4, fixedCounts: true, checkpoint() {} })
  assert.equal(result.failedRoom, undefined, result.failureDetail)
  assert.equal(result.jobs.length, 4)
  const points = result.jobs.flatMap((job) => job.points!)
  const marginMm = Math.min(...points.map((p) => Math.min(p.x, 640 - p.x, p.y, 320 - p.y))) * 100 / 8
  assert.ok(marginMm >= 80 + 8 * 20, 'the shared R80 approach accommodates the whole native room at 20 mm feed centres')
  assert.equal(checkHeatingPlan(result.jobs.map((job, i) => createHeatingPipe(`fragment-${i}`, job.points!,
    { ...heatingDefaults('pipe', 100), automatic: true, circuitId: `F${i}`, pipeRole: 'loop' })), [],
    { maxCircuitLengthM: 120 }).errors, 0)
})
