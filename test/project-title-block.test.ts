import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectTitleBlockMarkup,
  getProjectTitleBlockBounds
} from '../src/editor/layout/project-title-block.ts'

test('reserves a compact 14 mm details strip within 10 mm A4 margins', () => {
  for (const [width, height] of [[2376, 1680], [1680, 2376]]) {
    const bounds = getProjectTitleBlockBounds(width, height)
    assert.deepEqual(bounds, { x: 80, y: height - 192, width: width - 160, height: 112 })
    const markup = buildProjectTitleBlockMarkup(null, 'Eendraads deel II', width, height)
    assert.match(markup, /INSTALLATIEADRES/)
    assert.match(markup, /Eendraads deel II/)
    assert.match(markup, />1\/1</)
    assert.match(markup, /INSTALLATIEADRES · AANVULLEN/)
    assert.equal([...markup.matchAll(/data-title-field=/g)].length, 4)
  }
})

test('keeps details at the same physical size for a translated, scaled sheet', () => {
  const scale = 0.5
  const bounds = getProjectTitleBlockBounds(2376 * scale, 1680 * scale, scale, 100, 200)
  assert.deepEqual(bounds, { x: 140, y: 944, width: 1108, height: 56 })
})
