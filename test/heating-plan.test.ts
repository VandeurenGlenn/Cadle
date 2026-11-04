import assert from 'node:assert/strict'
import test from 'node:test'
import { createHeatingPipe, heatingDefaults, heatingLayout, heatingMarkup, sanitizeHeating } from '../src/editor/heating-plan.ts'
import { cloneShapes, sanitizeShapes } from '../src/editor/model/model.ts'
import { rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'
import { translateShape } from '../src/editor/interaction/shape-transforms.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import type { RectShape } from '../src/editor/model/types.ts'

const zone = (): RectShape => ({ id: 'zone', kind: 'rect', start: { x: 200, y: 200 }, end: { x: 520, y: 440 },
  heating: { ...heatingDefaults('zone', 100), name: 'Living' } })

test('fits rounded meanders at exact spacing and reports geometric lengths without leads', () => {
  const shape = zone(), layout = heatingLayout(shape)
  assert.equal(layout.areaM2, 12)
  assert.equal(layout.circuits.length, 1)
  assert.equal((layout.circuits[0].path.match(/ A /g) ?? []).length, 17)
  assert.ok(Math.abs(layout.lengthM - (18 * (3.8 - .15) + .15 + 17 * Math.PI * .075)) < 1e-9)
  const divided = heatingLayout({ ...shape, heating: { ...shape.heating!, circuits: 2 } })
  assert.equal(divided.circuits.length, 2)
  assert.equal(divided.circuits[0].lengthM, divided.circuits[1].lengthM)
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
  assert.equal(heatingLayout(scaled[0]).lengthM, heatingLayout(zone()).lengthM)
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
