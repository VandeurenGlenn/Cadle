import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectTitleBlockMarkup,
  getProjectTitleBlockBounds
} from '../src/editor/layout/project-title-block.ts'
import { oneWireDestinationPageNumber, projectPageNumber } from '../src/editor/layout/page-numbering.ts'

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

test('numbers one-wire destination references by their actual project page', () => {
  const project = {
    pages: {
      ground: { name: 'Grondplan', creationTime: 1, order: 1 },
      schedule: { name: 'Kringentabel', creationTime: 2, order: 2 },
      oneWire: { name: 'One-wire diagram', creationTime: 3, order: 3, pageType: 'onewire' as const },
      destination: { name: 'One-wire diagram 2', creationTime: 4, order: 4, pageType: 'onewire' as const }
    }
  } as Project

  assert.equal(projectPageNumber(project, 'destination'), 4)
  assert.equal(oneWireDestinationPageNumber(project, 0), 4)
  assert.equal(oneWireDestinationPageNumber(project, 0, false), 3)
})

test('numbers newly generated one-wire sheets after existing project pages', () => {
  const project = {
    pages: {
      ground: { name: 'Grondplan', creationTime: 1, order: 1 },
      oneWire: { name: 'One-wire diagram', creationTime: 2, order: 2, pageType: 'onewire' as const },
      schedule: { name: 'Kringentabel', creationTime: 3, order: 3 }
    }
  } as Project

  assert.equal(oneWireDestinationPageNumber(project, 0), 4)
})
