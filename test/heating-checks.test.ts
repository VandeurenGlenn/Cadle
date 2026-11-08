import assert from 'node:assert/strict'
import test from 'node:test'
import { checkHeatingPlan, sanitizeHeatingAudit } from '../src/editor/heating-checks.ts'
import { createHeatingPipe, heatingDefaults, heatingSchedule, heatingScheduleCSV, heatingMarkup, presentHeatingTables, heatingTableSize, createHeatingScheduleTables } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { generateAutomaticHeatingPlan, openHeatingTurns, softenHeatingJogs } from '../src/editor/automatic-heating-plan.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import type { Point, RectShape, Shape } from '../src/editor/model/types.ts'

const pipe = (id: string, points: Point[], role: 'loop' | 'supply' | 'return' = 'loop') => createHeatingPipe(id, points,
  { ...heatingDefaults('pipe', 100), automatic: true, circuitId: id, pipeRole: role, roomName: 'Living', servedAreaM2: 10 })

test('curve length, minimum bend radius and transformed endpoints share the rendered geometry', () => {
  const shape = pipe('VV01', [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }])
  shape.heating!.design = { minBendRadiusMm: 100 }
  const geometry = heatingPipeGeometry(shape), r = 8
  assert.ok(Math.abs(geometry.length - (160 - 2 * r + Math.PI * r / 2)) < 1e-8)
  assert.ok(Math.abs(geometry.bends[0].radiusMm - 100) < 1e-8)
  shape.rotation = 90
  const rotated = heatingPipeGeometry(shape)
  assert.ok(Math.abs(rotated.points[0].x - 80) < 1e-8)
  assert.ok(Math.abs(rotated.points[0].y) < 1e-8)
  assert.equal(rotated.path, geometry.path)
})

test('opens a tight 150 mm meander end to fit an 80 mm product bend', () => {
  const points = openHeatingTurns([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 12 }, { x: 0, y: 12 }], 6.4)
  const shape = pipe('VV01', points), geometry = heatingPipeGeometry(shape)
  assert.ok(points.length > 4)
  assert.ok(geometry.bends.every((b) => b.radiusMm >= 79.9))
  assert.deepEqual(geometry.points[0], { x: 0, y: 0 })
  assert.deepEqual(geometry.points.at(-1), { x: 0, y: 12 })
})

test('16 mm pipe at 100 mm pitch retains R80 bends and clearance between adjacent widened turns', () => {
  // Four adjacent pairs exercise both ends of the meander, not just an isolated U.
  const original = Array.from({ length: 8 }, (_, i) => [{ x: i * 8, y: i % 2 ? 200 : 0 }, { x: i * 8, y: i % 2 ? 0 : 200 }]).flat()
  for (const mirrored of [false, true]) {
    const points = original.map(({ x, y }) => ({ x: mirrored && x !== 0 ? -x : x, y }))
    const opened = openHeatingTurns(points, 6.4, 1.28)
    const shape = pipe('VV01', opened)
    shape.heating!.spacingMm = 100
    const geometry = heatingPipeGeometry(shape)
    assert.ok(opened.length > original.length, '100 mm turns must be widened instead of left at R50')
    assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
    assert.equal(checkHeatingPlan([shape], []).errors, 0)
    assert.deepEqual(geometry.points[0], points[0])
    assert.deepEqual(geometry.points.at(-1), points.at(-1))
    for (let i = 0; i < 8; i++) assert.ok(geometry.pieces.some((piece) => Math.abs(piece.a.x - points[i * 2].x) < 1e-6 &&
      Math.abs(piece.b.x - points[i * 2].x) < 1e-6 && Math.abs(piece.b.y - piece.a.y) > 100), 'the long runs retain their 100 mm pitch')
  }
  const tooTight = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 8 }, { x: 0, y: 8 }]
  assert.deepEqual(openHeatingTurns(tooTight, 8, 1.6), tooTight, 'do not widen neighbouring bulbs into touching 20 mm pipes')
})

test('detects actual crossings, pipe footprint collisions and bends below the design minimum', () => {
  const a = pipe('VV01', [{ x: 0, y: 30 }, { x: 80, y: 30 }])
  const b = pipe('VV02', [{ x: 40, y: 0 }, { x: 40, y: 60 }])
  const tight = pipe('VV03', [{ x: 100, y: 0 }, { x: 102, y: 0 }, { x: 102, y: 20 }])
  const shapes = [a, b, tight], audit = checkHeatingPlan(shapes, heatingSchedule(shapes), undefined, [{ x: 65, y: 29.5, width: 4, height: 1 }])
  assert.ok(audit.issues.some((i) => i.code === 'collision' && i.circuits.includes('VV01') && i.circuits.includes('VV02')))
  assert.ok(audit.issues.some((i) => i.code === 'obstacle'))
  assert.ok(audit.issues.some((i) => i.code === 'bend' && i.circuits.includes('VV03')))
  assert.ok(audit.errors > 0)
})

test('allows a close supply and return pair inside the manifold connection zone', () => {
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 120, y: 64 },
    heating: { ...heatingDefaults('manifold', 100), points: [{ x: .25, y: .1 }, { x: .2583, y: .1 }] } }
  const supply = pipe('supply', [{ x: 30, y: 6.4 }, { x: 30, y: 50 }], 'supply')
  const returning = pipe('return', [{ x: 31, y: 50 }, { x: 31, y: 6.4 }], 'return')
  supply.heating!.circuitId = returning.heating!.circuitId = 'VV01'
  const audit = checkHeatingPlan([manifold, supply, returning], [], undefined, [], { stopOnConflict: true })
  assert.equal(audit.errors, 0)
  assert.ok(audit.issues.some((issue) => issue.code === 'collision' && issue.severity === 'review' && issue.circuits.includes('VV01')))
})

test('reports moved manifold, missing circuit parts and cut lengths beyond the configured maximum', () => {
  const shapes: Shape[] = [{ id: 'wall-0', kind: 'wall', start: { x: 400, y: 400 }, end: { x: 800, y: 400 } },
    { id: 'wall-1', kind: 'wall', start: { x: 800, y: 400 }, end: { x: 800, y: 720 } },
    { id: 'wall-2', kind: 'wall', start: { x: 800, y: 720 }, end: { x: 400, y: 720 } },
    { id: 'wall-3', kind: 'wall', start: { x: 400, y: 720 }, end: { x: 400, y: 400 } },
    { id: 'entrance', kind: 'door', start: { x: 560, y: 400 }, end: { x: 640, y: 400 } }]
  let id = 0
  const result = generateAutomaticHeatingPlan(shapes, { x: 180, y: 280 }, { diameterMm: 16, spacingMm: 150, design: { maxCircuitLengthM: 70, allowanceM: 3 } }, 100,
    () => String(id++), { x: 80, y: 80, width: 2216, height: 1384 })
  assert.ok(result.rows.length > 1)
  const manifold = result.shapes.find((s) => s.heating?.kind === 'manifold')!
  assert.ok(!manifold.heating!.audit!.issues.some((i) => i.code === 'continuity'))
  for (const row of result.rows) assert.ok(row.cutM! <= 70.05 || manifold.heating!.audit!.issues.some((i) => i.code === 'length' && i.circuits.includes(row.id)))
  manifold.start.x += 50; manifold.end.x += 50
  const audit = checkHeatingPlan(result.shapes, result.rows, { maxCircuitLengthM: 20 })
  assert.ok(audit.issues.some((i) => i.code === 'continuity' && i.message.includes('verdeler')))
  assert.ok(audit.issues.some((i) => i.code === 'length'))
  const incomplete = result.shapes.filter((s) => !(s.heating?.circuitId === 'VV01' && s.heating?.pipeRole === 'return'))
  assert.ok(checkHeatingPlan(incomplete, result.rows).issues.some((i) => i.message.includes('ontbreekt')))
})

test('uses supplied room loads, explicit reserve and delta T and keeps assumptions in export', () => {
  const loop = pipe('VV01', [{ x: 0, y: 0 }, { x: 80, y: 0 }])
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 100 }, end: { x: 120, y: 164 }, heating: { ...heatingDefaults('manifold'), automatic: true } }
  const estimated = heatingSchedule([loop, manifold])[0]
  assert.equal(estimated.flowEstimated, true)
  const special = { ...loop, heating: { ...loop.heating!, roomName: 'constructor', design: { roomHeatLoadsW: {} } } }
  assert.ok(Number.isFinite(heatingSchedule([special])[0].flowLmin))
  manifold.heating!.design = { roomHeatLoadsW: { Living: 1000 }, deltaTK: 10, allowanceM: 3 }
  const row = heatingSchedule([loop, manifold])[0]
  assert.equal(row.flowEstimated, false)
  assert.ok(Math.abs(row.flowLmin - estimated.flowLmin) < 1e-8)
  assert.equal(row.cutM, row.totalM + 3)
  const live = presentHeatingTables([loop, manifold]).find((s) => s.id === 'm')!
  const audit = live.heating!.audit!
  assert.ok(!audit.issues.some((i) => i.code === 'hydraulics'))
  assert.ok(audit.issues.some((i) => i.code === 'system'))
  const csv = heatingScheduleCSV([{ ...row, room: '=SUM(1;2)' }], audit)
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"\'=SUM(1;2)"'))
  assert.ok(csv.includes('Kniplengte'))
  const size = heatingTableSize(1), table: RectShape = { id: 't', kind: 'rect', start: { x: 0, y: 0 }, end: { x: size.width, y: size.height },
    heating: { ...heatingDefaults('table'), automatic: true, rows: [row], audit, design: manifold.heating!.design } }
  const markup = heatingMarkup(table)
  assert.ok(markup.includes('CONCEPT'))
  assert.ok(markup.includes('snijreserve'))
  assert.ok(markup.includes('Drukverlies'))
  assert.deepEqual(sanitizeHeatingAudit({ issues: [{ ...audit.issues[0], severity: 'bad' }] })?.issues, [])
})


test('softens short sideways jogs only across free floor', () => {
  const points = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 2 }, { x: 160, y: 2 }]
  const softened = softenHeatingJogs(points, 6.4, () => true, 2)
  assert.notDeepEqual(softened, points)
  assert.ok(heatingPipeGeometry(pipe('VV01', softened)).bends.every((bend) => bend.radiusMm >= 79.9))
  assert.deepEqual(softenHeatingJogs(points, 6.4, () => false, 2), points)
})


test('keeps product data when a single design field changes and after save/reopen', () => {
  const shape = pipe('VV01', [{ x: 0, y: 0 }, { x: 100, y: 0 }])
  shape.heating!.design = { product: 'Buis 16×2', minBendRadiusMm: 80, allowanceM: 3 }
  shape.heating!.manualRoute = true
  const changed = updateSelectionProperties([shape], { heating: { design: { deltaTK: 7 } } },
    { selectedIds: new Set([shape.id]), selectedId: shape.id, groupedSelection: false })[0]
  assert.deepEqual(changed.heating!.design, { product: 'Buis 16×2', minBendRadiusMm: 80, allowanceM: 3, deltaTK: 7 })
  const restored = sanitizeShapes(JSON.parse(JSON.stringify([changed])))[0]
  assert.deepEqual(restored.heating!.design, changed.heating!.design)
  assert.equal(restored.heating!.manualRoute, true)
  assert.ok(checkHeatingPlan([restored], heatingSchedule([restored as RectShape])).issues.some((i) => i.code === 'manual'))
})

test('paginates 24 existing circuits over readable A4 tables without losing rows', () => {
  const pipes = Array.from({ length: 24 }, (_, i) => pipe(`VV${String(i + 1).padStart(2, '0')}`, [{ x: 400, y: 400 + i * 20 }, { x: 800, y: 400 + i * 20 }]))
  const rows = heatingSchedule(pipes)
  let id = 0
  const tables = createHeatingScheduleTables(rows, { ...heatingDefaults('table'), name: 'Kringentabel' }, () => `table-${id++}`, { x: 80, y: 80 })
  assert.equal(tables.length, 2)
  assert.deepEqual(tables.flatMap((t) => t.heating!.rows!.map((r) => r.id)), rows.map((r) => r.id))
  for (const table of tables) {
    assert.ok(table.end.y - table.start.y <= 1384)
    table.heating!.sourcePageKey = 'plan'
    const live = presentHeatingTables([table], () => pipes)[0]
    assert.deepEqual(live.heating!.rows!.map((r) => r.id), table.heating!.rows!.map((r) => r.id))
    assert.equal(live.end.y, table.end.y)
  }
})

test('does not report a missing automatic circuit as an empty successful design', () => {
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 120, y: 64 }, heating: { ...heatingDefaults('manifold'), automatic: true, circuits: 2 } }
  const audit = checkHeatingPlan([manifold], [])
  assert.equal(audit.errors, 2)
  assert.ok(audit.issues.every((i) => i.severity !== 'error' || i.code === 'continuity'))
})

test('a smooth short fillet is continuous, while a distant self-crossing remains an error', () => {
  const smooth = pipe('VV01', softenHeatingJogs([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 2 }, { x: 160, y: 2 }], 6.4, () => true, 2))
  assert.ok(!checkHeatingPlan([smooth], []).issues.some((i) => i.code === 'collision'))
  const crossed = pipe('VV02', [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }])
  assert.ok(checkHeatingPlan([crossed], []).issues.some((i) => i.code === 'collision'))
})

test('focused geometry checks compare new pipes with existing ones without repeating unrelated checks', () => {
  const first = pipe('VV01', [{ x: 0, y: 40 }, { x: 120, y: 40 }])
  const second = pipe('VV02', [{ x: 40, y: 0 }, { x: 40, y: 120 }])
  const distant = pipe('VV03', [{ x: 600, y: 600 }, { x: 700, y: 600 }])
  const shapes = [first, second, distant]
  const full = checkHeatingPlan(shapes, [])
  assert.equal(full.issues.filter((issue) => issue.code === 'collision').length, 1, 'multi-bucket crossing must be reported once')
  const focused = checkHeatingPlan(shapes, [], undefined, [], { focusPipeIds: new Set([first.id]) })
  assert.deepEqual(focused.issues, full.issues)
  const unchanged = checkHeatingPlan(shapes, [], undefined, [], { focusPipeIds: new Set([distant.id]) })
  assert.ok(!unchanged.issues.some((issue) => issue.code === 'collision'))
  const interrupted = new Error('stop geometry work')
  assert.throws(() => checkHeatingPlan(shapes, [], undefined, [], { checkpoint: () => { throw interrupted } }),
    (error) => error === interrupted)
})

test('candidate validation stops at the first conflict while the final audit still reports every conflict', () => {
  const shapes = [
    pipe('VV01', [{ x: 0, y: 40 }, { x: 120, y: 40 }]),
    pipe('VV02', [{ x: 40, y: 0 }, { x: 40, y: 120 }]),
    pipe('VV03', [{ x: 80, y: 0 }, { x: 80, y: 120 }])
  ]
  const full = checkHeatingPlan(shapes, [])
  assert.equal(full.issues.filter((issue) => issue.code === 'collision').length, 2)
  const early = checkHeatingPlan(shapes, [], undefined, [], { stopOnConflict: true })
  assert.equal(early.issues.length, 1)
  assert.deepEqual(early.issues[0], full.issues[0])
  assert.equal(early.errors, 1)
  assert.equal(early.reviews, 0)
})
