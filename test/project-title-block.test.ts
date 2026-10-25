import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectTitleBlockMarkup,
  getProjectTitleBlockBounds
} from '../src/editor/layout/project-title-block.ts'

test('reserves a full-width 30 mm details strip within 10 mm A4 margins', () => {
  for (const [width, height] of [[2376, 1680], [1680, 2376]]) {
    const bounds = getProjectTitleBlockBounds(width, height)
    assert.deepEqual(bounds, { x: 80, y: height - 320, width: width - 160, height: 240 })
    const markup = buildProjectTitleBlockMarkup(null, 'Eendraads deel II', width, height)
    assert.match(markup, /INSTALLATIEADRES/)
    assert.match(markup, /EENDRAADS DEEL II/)
    assert.match(markup, /BLAD 1\/1/)
    assert.match(markup, /ADRESGEGEVENS AANVULLEN/)
  }
})

test('keeps details at the same physical size for a translated, scaled sheet', () => {
  const scale = 0.5
  const bounds = getProjectTitleBlockBounds(2376 * scale, 1680 * scale, scale, 100, 200)
  assert.deepEqual(bounds, { x: 140, y: 880, width: 1108, height: 120 })
})
