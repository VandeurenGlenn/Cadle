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
