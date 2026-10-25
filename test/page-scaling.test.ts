import assert from 'node:assert/strict'
import test from 'node:test'
import { fitLegacyGroundPlanToPrintArea, scaleShapesBetweenPages } from '../src/editor/layout/page-scaling.js'
import { oneWireSymbolStrokeWidthFor } from '../src/editor/layout/onewire-symbol-nodes.js'
import type { Shape } from '../src/editor/model/types.js'

const legacyPlan = (): Shape[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `wall-${index}`,
    kind: 'wall' as const,
    start: { x: 700 + index * 60, y: 300 },
    end: { x: 700 + index * 60, y: 1300 }
  }))

test('enlarges and centers a legacy ground plan inside the printable area', () => {
  const result = fitLegacyGroundPlanToPrintArea(legacyPlan(), {
    width: 2376,
    height: 1680,
    widthMm: 297,
    heightMm: 210,
    marginMm: 10
  })

  assert.equal(result.changed, true)
  assert.ok(result.scale > 1.4 && result.scale < 1.6)
  const first = result.shapes[0]
  const last = result.shapes.at(-1)
  assert.equal(first.kind, 'wall')
  assert.equal(last?.kind, 'wall')
  assert.ok(first.start.x > 0)
  assert.ok((last?.end.x ?? 0) < 2376)
})

test('keeps breaker strokes equal to conductors when resizing a page', () => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const shapes: Shape[] = [
    {
      id: 'breaker',
      kind: 'symbol',
      name: 'Automaat',
      path,
      position: { x: 50, y: 50 },
      scale: 2,
      strokeWidth: oneWireSymbolStrokeWidthFor(path, 2)
    },
    { id: 'wire', kind: 'line', start: { x: 50, y: 60 }, end: { x: 50, y: 100 }, strokeWidth: 2 }
  ]
  for (const factor of [0.75, 1.485, 2]) {
    const [breaker, wire] = scaleShapesBetweenPages(shapes, factor, 0, 0)
    assert.ok(breaker.kind === 'symbol')
    assert.ok(Math.abs((breaker.strokeWidth! * 24 * breaker.scale) / 28.8265 - wire.strokeWidth!) < 1e-9)
  }
})

test('does not unexpectedly enlarge a small partial sketch', () => {
  const result = fitLegacyGroundPlanToPrintArea(legacyPlan().slice(0, 2), {
    width: 2376,
    height: 1680,
    widthMm: 297,
    heightMm: 210,
    marginMm: 10
  })

  assert.equal(result.changed, false)
  assert.equal(result.scale, 1)
})
