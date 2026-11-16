import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import { shapeBounds } from '../src/editor/model/model.ts'
import type { RectShape, RoofVariant } from '../src/editor/model/types.ts'
import {
  DEFAULT_ROOF_FILL,
  DEFAULT_ROOF_STROKE,
  roofGeometry,
  roofPathData
} from '../src/editor/roof-geometry.ts'

const bounds = { x: 10, y: 20, width: 200, height: 80 }

test('builds mirrored 45-degree roof ends with the ridge on the opposite side', () => {
  const left = roofGeometry(bounds, 'roof-left')
  assert.deepEqual(left, {
    junction: { x: 50, y: 60 },
    ridgeEnd: { x: 210, y: 60 },
    segments: [
      { start: { x: 10, y: 20 }, end: { x: 50, y: 60 } },
      { start: { x: 10, y: 100 }, end: { x: 50, y: 60 } },
      { start: { x: 50, y: 60 }, end: { x: 210, y: 60 } }
    ]
  })

  const right = roofGeometry(bounds, 'roof-right')
  assert.deepEqual(right, {
    junction: { x: 170, y: 60 },
    ridgeEnd: { x: 10, y: 60 },
    segments: [
      { start: { x: 210, y: 20 }, end: { x: 170, y: 60 } },
      { start: { x: 210, y: 100 }, end: { x: 170, y: 60 } },
      { start: { x: 170, y: 60 }, end: { x: 10, y: 60 } }
    ]
  })
})

test('keeps the junction inside a tall narrow roof instead of crossing its centre', () => {
  const narrow = { x: 30, y: 40, width: 60, height: 200 }
  const left = roofGeometry(narrow, 'roof-left')
  const right = roofGeometry(narrow, 'roof-right')

  assert.deepEqual(left.junction, { x: 60, y: 140 })
  assert.deepEqual(right.junction, { x: 60, y: 140 })
  assert.deepEqual(left.ridgeEnd, { x: 90, y: 140 })
  assert.deepEqual(right.ridgeEnd, { x: 30, y: 140 })
})

test('draws a roof without a point as one straight full-width ridge', () => {
  const straight = roofGeometry(bounds, 'roof-straight')
  assert.deepEqual(straight, {
    junction: { x: 10, y: 60 },
    ridgeEnd: { x: 210, y: 60 },
    segments: [{ start: { x: 10, y: 60 }, end: { x: 210, y: 60 } }]
  })
  assert.equal(roofPathData(straight), 'M 10 60 L 210 60')
})

test('normalizes reverse drag bounds before producing roof geometry', () => {
  const forward: RectShape = {
    id: 'forward',
    kind: 'rect',
    variant: 'roof-left',
    start: { x: 10, y: 20 },
    end: { x: 210, y: 100 }
  }
  const reverse: RectShape = {
    ...forward,
    id: 'reverse',
    start: { x: 210, y: 100 },
    end: { x: 10, y: 20 }
  }

  assert.deepEqual(shapeBounds(reverse), shapeBounds(forward))
  assert.deepEqual(
    roofGeometry(shapeBounds(reverse), reverse.variant as RoofVariant),
    roofGeometry(shapeBounds(forward), forward.variant as RoofVariant)
  )
})

test('exports the roof outline, direction and three internal roof segments', () => {
  const shape: RectShape = {
    id: 'roof-a',
    kind: 'rect',
    variant: 'roof-left',
    start: { x: 10, y: 20 },
    end: { x: 210, y: 100 },
    rotation: 90
  }
  const markup = shapeMarkup(shape, false)
  const expectedPath = roofPathData(roofGeometry(shapeBounds(shape), 'roof-left'))

  assert.equal((markup.match(/<rect\b/g) ?? []).length, 1)
  assert.equal((markup.match(/<path\b/g) ?? []).length, 1)
  assert.match(markup, /class="shape shape-rect shape-roof /)
  assert.match(markup, /data-shape-id="roof-a"/)
  assert.match(markup, /data-roof-direction="left"/)
  assert.ok(markup.includes(`d="${expectedPath}"`))
  assert.match(markup, new RegExp(`fill="${DEFAULT_ROOF_FILL}"`))
  assert.equal((markup.match(new RegExp(`stroke="${DEFAULT_ROOF_STROKE}"`, 'g')) ?? []).length, 2)
  assert.match(markup, /transform="translate\(110 60\) rotate\(90\) translate\(-110 -60\)"/)
})

test('exports custom roof appearance for both the outline and roof lines', () => {
  const markup = shapeMarkup({
    id: 'roof-b',
    kind: 'rect',
    variant: 'roof-right',
    start: { x: 10, y: 20 },
    end: { x: 210, y: 100 },
    fill: '#abcdef',
    stroke: '#123456',
    strokeWidth: 4
  }, true)

  assert.match(markup, /data-selected="true"/)
  assert.match(markup, /data-roof-direction="right"/)
  assert.match(markup, /fill="#abcdef"/)
  assert.equal((markup.match(/stroke="#123456"/g) ?? []).length, 2)
  assert.match(markup, /style="stroke-width: 4px;"/)
})
