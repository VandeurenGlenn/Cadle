import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import type { RectShape } from '../src/editor/model/types.ts'
import { roofPatternPathData } from '../src/editor/roof-geometry.ts'

test('generates optional tile, slate and standing-seam line patterns', () => {
  const bounds = { x: 0, y: 0, width: 200, height: 100 }
  assert.equal(roofPatternPathData(bounds, 'none'), '')
  for (const pattern of ['tiles', 'slates', 'standing-seam'] as const) {
    const path = roofPatternPathData(bounds, pattern)
    assert.match(path, /^M /)
    assert.ok(path.split(' M ').length >= 3, pattern)
  }
  assert.notEqual(roofPatternPathData(bounds, 'tiles'), roofPatternPathData(bounds, 'slates'))
})

test('exports a roof surface, optional pattern and ridge lines as one selectable object', () => {
  const roof: RectShape = {
    id: 'roof', kind: 'rect', variant: 'roof-left', roofPattern: 'tiles',
    start: { x: 10, y: 20 }, end: { x: 210, y: 100 },
    fill: '#aaaaaa', stroke: '#222222', strokeWidth: 3
  }
  const markup = shapeMarkup(roof, true)

  assert.match(markup, /class="shape shape-rect shape-roof /)
  assert.match(markup, /data-shape-id="roof"/)
  assert.match(markup, /data-selected="true"/)
  assert.match(markup, /data-roof-direction="left"/)
  assert.match(markup, /data-roof-pattern="tiles"/)
  assert.match(markup, /<rect[^>]+fill="#aaaaaa"[^>]+stroke="#222222"/s)
  assert.match(markup, /<path class="roof-pattern"/)
  assert.match(markup, /<path class="roof-ridges" d="M 10 20 L 50 60 M 10 100 L 50 60 M 50 60 L 210 60"/)
})

test('uses readable roof colors when imported roof JSON has no explicit style', () => {
  const markup = shapeMarkup({
    id: 'bare', kind: 'rect', variant: 'roof-right',
    start: { x: 0, y: 0 }, end: { x: 100, y: 50 }
  }, false)
  assert.match(markup, /fill="#b8b8b8"/)
  assert.match(markup, /stroke="#3b2c20"/)
})

