import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingLengthMetres, drawingUnitsForMetres, rescaleGroundPlan } from '../src/editor/layout/drawing-scale.ts'
import { asNativeState } from '../src/editor/model/document-state.ts'
import { buildProjectTitleBlockMarkup } from '../src/editor/layout/project-title-block.ts'
import { createNativeSelectionChangedPayload } from '../src/editor/interaction/selection-payload.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('uses standard paper-to-building ratios at 1:50 and 1:100', () => {
  assert.equal(drawingUnitsForMetres(5, 50), 800)
  assert.equal(drawingUnitsForMetres(5, 100), 400)
  assert.equal(drawingLengthMetres(800, 50), 5)
  assert.equal(drawingLengthMetres(400, 100), 5)
  assert.equal(drawingUnitsForMetres(0.1, 50), 16)
})

test('changes the building scale without changing symbol sizes, text or pen widths', () => {
  const shapes: Shape[] = [
    { id: 'wall', kind: 'wall', start: { x: 100, y: 100 }, end: { x: 900, y: 100 }, strokeWidth: 6 },
    { id: 'switch', kind: 'symbol', name: 'Switch', path: 'switch.svg', position: { x: 200, y: 150 }, scale: 2, strokeWidth: 0.5 },
    { id: 'label', kind: 'text', position: { x: 700, y: 150 }, text: 'Living', scale: 1.2 },
    { id: 'wire', kind: 'line', start: { x: 100, y: 200 }, end: { x: 900, y: 200 },
      connection: { kind: 'wire', via: [{ x: 400, y: 300 }] } }
  ]
  const original = structuredClone(shapes)
  const scaled = rescaleGroundPlan(shapes, 50, 100)
  assert.deepEqual(shapes, original)
  assert.equal(scaled[0].kind === 'wall' && scaled[0].end.x - scaled[0].start.x, 400)
  assert.equal(scaled[1].kind === 'symbol' && scaled[1].scale, 2)
  assert.equal(scaled[1].kind === 'symbol' && scaled[1].strokeWidth, 0.5)
  assert.equal(scaled[2].kind === 'text' && scaled[2].scale, 1.2)
  assert.deepEqual(rescaleGroundPlan(scaled, 100, 50), original)
})

test('persists explicit scales and leaves an existing unknown scale unset', () => {
  const state = { version: 2, paperPreset: 'a4-landscape', worldWidth: 2376, worldHeight: 1680, printMargin: 10, shapes: [] }
  assert.equal(asNativeState({ ...state, drawingScale: 50 })?.drawingScale, 50)
  assert.equal(asNativeState({ ...state, drawingScale: 100 })?.drawingScale, 100)
  assert.equal(asNativeState(state)?.drawingScale, undefined)
  assert.equal(asNativeState({ ...state, drawingScale: 160 })?.drawingScale, undefined)
  assert.match(buildProjectTitleBlockMarkup(null, 'Ground plan', 2376, 1680, '', 1, 0, 0, 10, 50), /Schaal 1:50/)
  assert.match(buildProjectTitleBlockMarkup(null, 'Ground plan', 2376, 1680, '', 1, 0, 0, 10, null), /Schaal niet ingesteld/)
})

test('reports real architectural dimensions while keeping symbolic sizes on paper', () => {
  const wall = createNativeSelectionChangedPayload({ id: 'wall', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 800, y: 0 } }, 1, { drawingScale: 50 })
  assert.equal(wall.shape?.dimensions?.drawingScale, 50)
  const symbol = createNativeSelectionChangedPayload({ id: 's', kind: 'symbol', name: 'Switch', path: 'switch.svg', scale: 2, position: { x: 0, y: 0 } }, 1, { drawingScale: 50 })
  assert.equal(symbol.shape?.dimensions?.drawingScale, undefined)
})
