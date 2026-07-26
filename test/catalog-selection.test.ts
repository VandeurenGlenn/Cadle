import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCatalogSelectionDraft } from '../src/editor/layout/catalog-selection.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('builds a normalized catalog SVG without mutating source shapes', () => {
  const source: Shape[] = [
    {
      id: 'wall-1',
      kind: 'wall',
      start: { x: 100, y: 200 },
      end: { x: 200, y: 200 }
    }
  ]

  const draft = buildCatalogSelectionDraft(source, ['wall-1'])

  assert.equal(draft?.fallbackName, 'Wall symbol')
  assert.match(draft?.svgMarkup ?? '', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.deepEqual(source[0], {
    id: 'wall-1',
    kind: 'wall',
    start: { x: 100, y: 200 },
    end: { x: 200, y: 200 }
  })
  assert.notDeepEqual(draft?.shapes[0], source[0])
})

test('returns null when the selection has no matching shapes', () => {
  assert.equal(buildCatalogSelectionDraft([], ['missing']), null)
})

test('preserves custom colors and stroke widths in catalog geometry', () => {
  const draft = buildCatalogSelectionDraft(
    [
      {
        id: 'colored-circle',
        kind: 'rect',
        variant: 'circle',
        start: { x: 20, y: 30 },
        end: { x: 50, y: 60 },
        fill: '#ffcc33',
        stroke: '#2455cc',
        strokeWidth: 3
      }
    ],
    ['colored-circle']
  )

  assert.match(draft?.svgMarkup ?? '', /fill="#ffcc33"/)
  assert.match(draft?.svgMarkup ?? '', /stroke="#2455cc"/)
  assert.match(draft?.svgMarkup ?? '', /stroke-width: 3px/)
  assert.equal(draft?.shapes[0]?.fill, '#ffcc33')
  assert.equal(draft?.shapes[0]?.stroke, '#2455cc')
  assert.equal(draft?.shapes[0]?.strokeWidth, 3)
})
