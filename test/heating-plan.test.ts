import assert from 'node:assert/strict'
import test from 'node:test'
import { createHeatingPipe, heatingDefaults, heatingLayout, heatingManifoldSize, heatingMarkup, heatingScheduleTotals, heatingScheduleCSV, sanitizeHeating } from '../src/editor/heating-plan.ts'
import { cloneShapes, sanitizeShapes } from '../src/editor/model/model.ts'
import { rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'
import { translateShape } from '../src/editor/interaction/shape-transforms.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import type { RectShape } from '../src/editor/model/types.ts'

const zone = (): RectShape => ({ id: 'zone', kind: 'rect', start: { x: 200, y: 200 }, end: { x: 520, y: 440 },
  heating: { ...heatingDefaults('zone', 100), name: 'Living' } })

test('fits a rounded double spiral and reports geometric lengths without leads', () => {
  const shape = zone(), layout = heatingLayout(shape)
  assert.equal(layout.areaM2, 12)
  assert.equal(layout.circuits.length, 1)
  assert.equal((layout.circuits[0].path.match(/M /g) ?? []).length, 1)
  assert.ok(Math.abs(layout.lengthM - 71.2934032815) < 1e-9)
  const divided = heatingLayout({ ...shape, heating: { ...shape.heating!, circuits: 2 } })
  assert.equal(divided.circuits.length, 2)
  assert.ok(Math.abs(divided.circuits[0].lengthM - divided.circuits[1].lengthM) < 1e-9)
  for (const circuit of divided.circuits) for (const p of [circuit.start, circuit.end]) {
    assert.ok(p.x >= 200 && p.x <= 520 && p.y >= 200 && p.y <= 440)
  }
  assert.ok(heatingLayout({ ...shape, end: { x: 205, y: 205 } }).warning)
})

test('keeps heating geometry and pipe lengths through cloning, moving, saving and scale changes', () => {
  const pipe = createHeatingPipe('pipe', [{ x: 200, y: 500 }, { x: 200, y: 580 }, { x: 360, y: 580 }], heatingDefaults('pipe', 100))
  assert.equal(heatingLayout(pipe).lengthM, 3)
  assert.deepEqual(sanitizeShapes([pipe]), [pipe])
  assert.deepEqual(cloneShapes([pipe]), [pipe])
  const moved = translateShape(pipe, 73, -17) as RectShape
  assert.equal(heatingLayout(moved).lengthM, 3)
  const scaled = rescaleGroundPlan([zone(), pipe], 100, 50) as RectShape[]
  assert.equal(scaled[0].heating!.drawingScale, 50)
  assert.ok(Math.abs(heatingLayout(scaled[0]).lengthM - heatingLayout(zone()).lengthM) < 1e-9)
  assert.equal(heatingLayout(scaled[1]).lengthM, 3)
  assert.deepEqual(rescaleGroundPlan(scaled, 50, 100), [zone(), pipe])
})

test('regenerates zone settings and shares safe markup with export', () => {
  const changed = updateSelectionProperties([zone()], { heating: { circuits: 2, spacingMm: 200, name: '<Living>' } },
    { selectedIds: new Set(['zone']), selectedId: 'zone', groupedSelection: false })[0] as RectShape
  assert.equal(heatingLayout(changed).circuits.length, 2)
  assert.equal(changed.heating!.spacingMm, 200)
  const markup = heatingMarkup(changed)
  assert.equal(markup, shapeMarkup(changed, false))
  assert.ok(markup.includes('&lt;Living&gt;'))
  assert.ok(!shapeMarkup(changed, false, '', 2, true).includes('#b42318'))
  assert.equal(sanitizeHeating({ kind: 'pipe', points: [{ x: Number.NaN, y: 0 }] }), undefined)
  assert.equal(sanitizeHeating({ ...heatingDefaults('zone'), circuits: 999 })!.circuits, 24)
})

test('uses a compact transparent manifold and preserves connected or custom geometry', () => {
  const old: RectShape = { id: 'manifold', kind: 'rect', start: { x: 100, y: 100 }, end: { x: 220, y: 164 },
    heating: { ...heatingDefaults('manifold', 100), circuits: 10 } }
  const compact = sanitizeShapes([old], 'groundplan')[0] as RectShape
  const size = heatingManifoldSize(10, 100)
  assert.equal(compact.end.x - compact.start.x, size.width)
  assert.equal(compact.end.y - compact.start.y, size.height)
  assert.ok(size.width < 120 * .6 && size.height < 64 * .5)
  const markup = heatingMarkup(compact)
  assert.match(markup, /<rect[^>]*fill="none"/)
  assert.ok(!markup.includes('white'))
  assert.equal(shapeMarkup(compact, false), markup)
  assert.deepEqual(heatingManifoldSize(10, 50), { width: size.width * 2, height: size.height * 2 })
  const expanded = updateSelectionProperties([compact], { heating: { circuits: 12 } },
    { selectedIds: new Set(['manifold']), selectedId: 'manifold', groupedSelection: false })![0] as RectShape
  assert.equal(expanded.end.x - expanded.start.x, heatingManifoldSize(12, 100).width)
  const pipe = createHeatingPipe('connected-pipe', [{ x: 110, y: 164 }, { x: 110, y: 240 }], heatingDefaults('pipe', 100))
  assert.deepEqual(sanitizeShapes([old, pipe], 'groundplan'), [old, pipe])
  const custom = { ...old, end: { x: 200, y: 150 } }
  assert.deepEqual(sanitizeShapes([custom], 'groundplan')[0], custom)
})

test('summarizes actual pipe lengths separately from reserve and exports aligned circuit columns', () => {
  const rows = [
    { id: 'VV01', room: 'Living', diameterMm: 16, spacingMm: 150, areaM2: 10, loopM: 60, supplyM: 4, returnM: 5,
      totalM: 69, allowanceM: 3, cutM: 72, flowLmin: 1.5 },
    { id: 'VV02', room: 'Kitchen', diameterMm: 16, spacingMm: 150, areaM2: 12, loopM: 70, supplyM: 6, returnM: 7,
      totalM: 83, flowLmin: 2 }
  ]
  assert.deepEqual(heatingScheduleTotals(rows), { circuits: 2, areaM2: 22, loopM: 130, supplyM: 10, returnM: 12,
    totalM: 152, allowanceM: 3, cutM: 155, flowLmin: 3.5 })
  assert.equal(heatingScheduleTotals([]).cutM, 0)
  const records = heatingScheduleCSV(rows).split('\r\n').map((line) => line.split(';').map((cell) => cell.replace(/^"|"$/g, '')))
  const header = records[1], first = records[2], total = records.find((record) => record[0] === 'TOTAAL')!
  assert.equal(first.length, header.length)
  assert.equal(first[header.indexOf('Getekend m')], '69,00')
  assert.equal(first[header.indexOf('Reserve m')], '3,00')
  assert.equal(first[header.indexOf('Kniplengte m')], '72,00')
  assert.equal(first[header.indexOf('Debiet l/min')], '1,50')
  assert.equal(total[header.indexOf('Kniplengte m')], '155,00')
})
