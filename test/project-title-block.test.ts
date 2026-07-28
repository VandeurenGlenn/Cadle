import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectTitleBlockMarkup,
  getProjectTitleBlockBounds
} from '../src/editor/layout/project-title-block.ts'

test('stacks project details above the page title in the top-right corner', () => {
  const scale = 0.65
  const bounds = getProjectTitleBlockBounds(2400, 1400, scale)
  assert.equal(bounds.y, 28 * scale)

  const markup = buildProjectTitleBlockMarkup(null, 'Eendraads deel II', 2400, 1400, '', scale)
  const detailsMatch = /class="project-title-block"[\s\S]*?<rect[^>]*\sy="([^"]+)"/.exec(markup)
  const pageMatch = /class="project-page-section"[\s\S]*?<rect[^>]*\sy="([^"]+)"/.exec(markup)
  assert.ok(detailsMatch)
  assert.ok(pageMatch)

  const detailsY = Number(detailsMatch[1])
  const pageY = Number(pageMatch[1])
  assert.equal(detailsY, bounds.y)
  assert.equal(pageY, bounds.y + bounds.height + 12 * scale)
  assert.ok(pageY > detailsY + bounds.height)
})
