import assert from 'node:assert/strict'
import test from 'node:test'
import { fitLegacyGroundPlanToPrintArea, fitShapesToContentArea, scaleShapesBetweenPages } from '../src/editor/layout/page-scaling.js'
import { pageLayout } from '../src/editor/layout/page-layout.js'
import { shapeBounds } from '../src/editor/model/model.js'
import { oneWireSymbolStrokeWidthFor } from '../src/editor/layout/onewire-symbol-nodes.js'
import type { Shape } from '../src/editor/model/types.js'
import { renderedSymbolScale } from '../src/editor/model/symbol-scale.js'
import { transformShapeForSelection } from '../src/editor/interaction/selection-transforms.js'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.js'
import { oneWireLayoutBounds } from '../src/editor/layout/onewire-connections.js'

const legacyPlan = (): Shape[] =>
  Array.from({ length: 10 }, (_, index) => ({
    id: `wall-${index}`,
    kind: 'wall' as const,
    start: { x: 700 + index * 60, y: 300 },
    end: { x: 700 + index * 60, y: 1300 }
  }))

test('moves an existing plan clear of the address strip once, without cumulative shrinking', () => {
  const area = pageLayout(2376, 1680).content
  const original: Shape[] = [
    { id: 'plan', kind: 'rect', start: { x: 100, y: 100 }, end: { x: 2200, y: 1500 } },
    { id: 'device', kind: 'symbol', position: { x: 500, y: 1400 }, name: 'Lamp', path: 'Lighting.svg', scale: 1 },
    { id: 'hidden', kind: 'line', start: { x: -9000, y: 0 }, end: { x: 9000, y: 0 }, hidden: true }
  ]
  const fitted = fitShapesToContentArea(original, area)
  assert.equal(fitted.changed, true)
  for (const shape of fitted.shapes.filter((shape) => !shape.hidden)) {
    const bounds = shapeBounds(shape)
    assert.ok(bounds.y >= area.y)
    assert.ok(bounds.y + bounds.height <= area.y + area.height)
  }
  assert.equal(original[0].kind === 'rect' && original[0].end.y, 1500)
  const again = fitShapesToContentArea(fitted.shapes, area)
  assert.equal(again.changed, false)
  assert.deepEqual(again.shapes, fitted.shapes)
})

test('enlarges and centers a legacy ground plan inside the printable area', () => {
  const result = fitLegacyGroundPlanToPrintArea(legacyPlan(), {
    width: 2376,
    height: 1680,
    widthMm: 297,
    heightMm: 210,
    marginMm: 10
  })

  assert.equal(result.changed, true)
  assert.ok(result.scale > 1.2 && result.scale < 1.3)
  const first = result.shapes[0]
  const last = result.shapes.at(-1)
  assert.equal(first.kind, 'wall')
  assert.equal(last?.kind, 'wall')
  assert.ok(first.start.x > 0)
  assert.ok((last?.end.x ?? 0) < 2296)
  assert.ok((last?.end.y ?? 0) <= 1320)
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

test('all symbol resize paths preserve the physical pen width, including minimum scales', () => {
  for (const path of [
    'symbols/Protection devices/Residual-current circuit breaker.svg',
    'symbols/Switches/Double push button.svg',
    'symbols/Socket outlets/Wall outlet with grounding.svg'
  ]) {
    for (const scale of [0.2, 0.5, 2]) {
      const shape: Extract<Shape, { kind: 'symbol' }> = {
        id: 'device', kind: 'symbol', name: 'Device', path, scale,
        position: { x: 100, y: 100 }, strokeWidth: 0.8
      }
      const originalPen = shape.strokeWidth! * renderedSymbolScale(path, scale)
      const resized = [
        ...[0.5, 0.75, 1.485, 2].map((factor) => scaleShapesBetweenPages([shape], factor, 0, 0)[0]),
        transformShapeForSelection(shape, shape.position, 'scale-down'),
        ...updateSelectionProperties([shape], { scale: scale / 2 }, {
          selectedIds: new Set(['device']), selectedId: 'device', groupedSelection: false
        })!
      ]
      for (const result of resized) {
        assert.ok(result.kind === 'symbol')
        assert.ok(Math.abs(result.strokeWidth! * renderedSymbolScale(path, result.scale) - originalPen) < 1e-10)
      }
      assert.equal(shape.strokeWidth, 0.8)
    }
  }
})

test('rotated and mirrored labels stay clear of the address strip when fitting a page', () => {
  const area = pageLayout(2376, 1680).content
  for (const rotation of [33, 90, 270]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const label: Shape = {
          id: 'label', kind: 'text', text: 'Adres en technische beschrijving',
          position: { x: 100, y: 1300 }, scale: 2, rotation, flipX, flipY
        }
        const result = fitShapesToContentArea([label], area)
        const bounds = oneWireLayoutBounds(result.shapes[0])
        assert.ok(bounds.x >= area.x && bounds.y >= area.y)
        assert.ok(bounds.x + bounds.width <= area.x + area.width)
        assert.ok(bounds.y + bounds.height <= area.y + area.height)
        assert.equal(fitShapesToContentArea(result.shapes, area).changed, false)
      }
    }
  }
})
