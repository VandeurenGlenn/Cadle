import assert from 'node:assert/strict'
import test from 'node:test'
import { heatingDefaults, heatingLayout, heatingMarkup } from '../src/editor/heating-plan.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import type { RectShape } from '../src/editor/model/types.ts'

const zone = (): RectShape => ({ id: 'manual-zone', kind: 'rect', start: { x: 688, y: 260 }, end: { x: 1200, y: 528 },
  heating: { ...heatingDefaults('zone', 100), spacingMm: 100, circuits: 1, design: { maxCircuitLengthM: 200 } } })
const fixture = { x: 745, y: 260, width: 96, height: 144 }

test('one manual circuit remains one continuous tube around a fixture, rather than three separate circuits', () => {
  const shape = zone(), layout = heatingLayout(shape, [fixture])
  assert.equal(layout.circuits.length, 1)
  assert.equal((layout.circuits[0].path.match(/M /g) ?? []).length, 1)
  assert.ok(layout.lengthM > 150 && layout.lengthM < 160)
  assert.equal(layout.warning, undefined)
  for (const arc of layout.circuits[0].path.matchAll(/ A ([\d.e+-]+) ([\d.e+-]+)/g)) assert.ok(Number(arc[1]) >= 6.39 && Number(arc[2]) >= 6.39, 'all actual arcs retain R80 at scale 1:100')
  const markup = heatingMarkup(shape, false, false, [fixture])
  assert.equal((markup.match(/class="heating-circuit"/g) ?? []).length, 1)
  assert.equal((markup.match(/<circle /g) ?? []).length, 2)
  assert.doesNotMatch(markup, /data-circuit="[23]"/)
  assert.strictEqual(heatingLayout(shape, [fixture]), layout, 'unchanged previews reuse their validated result')
  const saved = sanitizeShapes(JSON.parse(JSON.stringify([shape])))[0] as RectShape
  assert.equal(saved.heating!.circuits, 1)
  assert.ok(Math.abs(heatingLayout(saved, [fixture]).lengthM - layout.lengthM) < 1e-9)
})

test('a manual circuit above the configured length limit is warned about without being silently split', () => {
  const shape = zone(); shape.heating!.design = { maxCircuitLengthM: 100 }
  const layout = heatingLayout(shape, [fixture])
  assert.equal(layout.circuits.length, 1)
  assert.match(layout.warning!, /boven de ingestelde grens van 100 m/)
  const markup = heatingMarkup(shape, false, false, [fixture])
  assert.match(markup, /nazien/)
  assert.doesNotMatch(markup, /<tspan[^>]*>[^<]*boven de ingestelde grens/)
})

test('a physically disconnected manual zone never invents extra circuits', () => {
  const shape = zone(), layout = heatingLayout(shape, [{ x: 900, y: 200, width: 80, height: 400 }])
  assert.equal(layout.circuits.length, 0)
  assert.match(layout.warning!, /niet veilig als één doorlopende buis/)
  assert.equal(shape.heating!.circuits, 1)
})

test('explicitly asking for two manual circuits still produces two circuits', () => {
  const shape = zone(); shape.heating!.circuits = 2
  assert.equal(heatingLayout(shape).circuits.length, 2)
})
