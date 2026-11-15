import assert from 'node:assert/strict'
import test from 'node:test'
import type { Shape } from '../src/editor/model/types.ts'
import { buildHeatingGrid, heatingCurveWallConflict, segmentDistance } from '../src/editor/heating-routing.ts'
import { buildHeatingAreaFields } from '../src/editor/heating-area-fields.ts'
import { heatingPairedEntries } from '../src/editor/heating-spiral.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingEntryTangentConflict } from '../src/editor/heating-clearance.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { shapeBounds } from '../src/editor/model/model.ts'

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

test('fields separated by a transit corridor orient towards their own nearby door', () => {
  const vertices = [[0, 0], [480, 0], [480, 160], [0, 160]]
  const scene: Shape[] = [...vertices.map(([x, y], i) => ({ kind: 'wall' as const, id: `boundary-${i}`,
    start: { x, y }, end: { x: vertices[(i + 1) % 4][0], y: vertices[(i + 1) % 4][1] }, strokeWidth: 2 })),
    { kind: 'door', id: 'left-access', start: { x: 0, y: 50 }, end: { x: 0, y: 110 } },
    { kind: 'door', id: 'right-access', start: { x: 480, y: 50 }, end: { x: 480, y: 110 } }]
  const source = { x: 40, y: 80 }, native = buildHeatingGrid(scene, 100, 100, source,
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true })
  const feedCorridor = Uint8Array.from(native.room, (_, cell) => Math.abs(native.point(cell).x - 240) <= native.step / 2 ? 1 : 0)
  const result = buildHeatingAreaFields({ ...native, feedCorridor }, scene,
    { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 120 } }, 100, source,
    { nativeGrid: native, reserveFeeds: true, targets: new Map([[`region-${native.rooms[0].id}`, 2]]),
      capacity: 2, fixedCounts: true, checkpoint() {} })
  assert.equal(result.failedRoom, undefined, result.failureDetail)
  assert.equal(result.jobs.length, 2)
  const right = result.jobs.find((job) => job.points!.every((p) => p.x > 240))!.points!
  assert.ok(right[0].x > right[1].x, 'the right-hand fragment faces its east doorway, despite the source being west')
  assert.ok(right.at(-1)!.x > right.at(-2)!.x)
  assert.equal(checkHeatingPlan(result.jobs.map((job, i) => createHeatingPipe(`doors-${i}`, job.points!,
    { ...heatingDefaults('pipe', 100), automatic: true, circuitId: `D${i}`, pipeRole: 'loop' })), [],
    { maxCircuitLengthM: 120 }).errors, 0)
})

test('allocation alternatives re-evaluate the shared bus when a neighbouring fragment gains a coil', () => {
  const vertices = [[0, 0], [800, 0], [800, 320], [0, 320]]
  const scene: Shape[] = vertices.map(([x, y], i) => ({ kind: 'wall', id: `allocation-wall-${i}`,
    start: { x, y }, end: { x: vertices[(i + 1) % 4][0], y: vertices[(i + 1) % 4][1] }, strokeWidth: 2 }))
  const source = { x: 40, y: 160 }, native = buildHeatingGrid(scene, 100, 100, source,
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true })
  const feedCorridor = Uint8Array.from(native.wall, (_, cell) => Math.abs(native.point(cell).x - 400) <= native.step / 2 ? 1 : 0)
  const settings = { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 120 } }
  const options = { nativeGrid: native, reserveFeeds: true, targets: new Map([[`region-${native.rooms[0].id}`, 4]]),
    capacity: 5, preferredMaxM: 70, checkpoint() {} }
  const result = buildHeatingAreaFields({ ...native, feedCorridor }, scene, settings, 100, source, options)
  assert.equal(result.failedRoom, undefined, result.failureDetail)
  assert.equal(result.jobs.length, 5, 'the fifth coil gives the better complete-length allocation')
  const points = result.jobs.flatMap((job) => job.points!)
  const marginMm = Math.min(...points.map((p) => Math.min(p.x, 800 - p.x, p.y, 320 - p.y))) * 100 / 8
  assert.ok(marginMm >= 80 + 10 * 20,
    `all ten feed tubes need their own bus margin; the earlier four-coil allocation left ${marginMm.toFixed(1)} mm`)
  const fixed = buildHeatingAreaFields({ ...native, feedCorridor }, scene, settings, 100, source,
    { ...options, targets: new Map([[`region-${native.rooms[0].id}`, 5]]), fixedCounts: true })
  assert.equal(fixed.failedRoom, undefined, fixed.failureDetail)
  assert.deepEqual(result.jobs.map((job) => job.points), fixed.jobs.map((job) => job.points),
    'an allocation explored after four coils uses the same geometry as a fresh five-coil calculation')
})

test('actual feed routes keep physical wall clearance without adding an approach setback to their field cuts', () => {
  const vertices = [[0, 0], [320, 0], [320, 160], [0, 160]]
  const scene: Shape[] = vertices.map(([x, y], i) => ({ kind: 'wall', id: `feed-wall-${i}`,
    start: { x, y }, end: { x: vertices[(i + 1) % 4][0], y: vertices[(i + 1) % 4][1] }, strokeWidth: 2 }))
  scene.push({ kind: 'rect', id: 'full-height-fixture', start: { x: 0, y: 0 }, end: { x: 40, y: 160 }, heatingObstacle: true })
  const source = { x: 160, y: 20 }, native = buildHeatingGrid(scene, 100, 100, source,
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }, { includeClosedRooms: true })
  const centre = native.point(native.index({ x: 160, y: 80 })).x
  const feedPaths = [centre, centre + native.step].map((x) => native.rooms[0].cells
    .filter((cell) => Math.abs(native.point(cell).x - x) < 1e-6).sort((a, b) => a - b))
  const feedCorridor = new Uint8Array(native.wall.length)
  for (const path of feedPaths) for (const cell of path) feedCorridor[cell] = 1
  const settings = { diameterMm: 16, spacingMm: 100, edgeMm: 100, design: { maxCircuitLengthM: 120 } }
  const result = buildHeatingAreaFields({ ...native, feedCorridor, feedPaths }, scene, settings, 100, source,
    { nativeGrid: native, reserveFeeds: true, targets: new Map([[`region-${native.rooms[0].id}`, 2]]),
      capacity: 2, fixedCounts: true, checkpoint() {} })
  assert.equal(result.failedRoom, undefined, result.failureDetail)
  assert.equal(result.jobs.length, 2)
  const loops = result.jobs.map((job, i) => createHeatingPipe(`feed-field-${i}`, job.points!,
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: `L${i}`, pipeRole: 'loop' }))
  const feeds = feedPaths.map((path, i) => createHeatingPipe(`transit-${i}`,
    [native.point(path[0]), native.point(path.at(-1)!)],
    { ...heatingDefaults('pipe', 100), ...settings, automatic: false, circuitId: `T${i}`, pipeRole: 'supply' }))
  const pieces = [...loops, ...feeds].flatMap((pipe) => heatingPipeGeometry(pipe).pieces)
  const points = loops.flatMap((pipe) => heatingPipeGeometry(pipe).pieces.flatMap((piece) => [piece.a, piece.b]))
  const wallMarginMm = Math.min(...points.map((p) => Math.min(p.x, 320 - p.x, p.y, 160 - p.y))) * 100 / 8
  assert.ok(wallMarginMm >= settings.edgeMm, 'the requested physical wall clearance is preserved')
  const cutMarginMm = Math.min(...points.map((p) => Math.min(Math.abs(p.x - centre), Math.abs(p.x - centre - native.step)))) * 100 / 8
  assert.ok(cutMarginMm <= 80, `an artificial cut needs a half-pitch margin, not a ${cutMarginMm.toFixed(0)} mm wall/approach margin`)
  const fixtureMarginMm = Math.min(...points.filter((p) => p.x < centre).map((p) => p.x - 40)) * 100 / 8
  assert.ok(fixtureMarginMm >= 7.9 && fixtureMarginMm < 75,
    `a fixture keeps the tube envelope clear without adding the ${settings.edgeMm} mm wall setback (${fixtureMarginMm.toFixed(1)} mm)`)
  for (const x of [centre - 8, centre + native.step + 8]) {
    const sample = { x, y: 80 }, distanceMm = Math.min(...pieces.map((piece) => segmentDistance(sample, piece.a, piece.b))) * 100 / 8
    assert.ok(distanceMm <= 65, `the floor beside the transit bundle is heated (${distanceMm.toFixed(0)} mm to the nearest tube)`)
  }
  assert.equal(checkHeatingPlan([...loops, ...feeds], [], settings.design, heatingObstacleBounds(scene, shapeBounds)).errors, 0)
  for (const pipe of loops) {
    const geometry = heatingPipeGeometry(pipe)
    assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
    assert.equal(heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() }), undefined)
  }
})
