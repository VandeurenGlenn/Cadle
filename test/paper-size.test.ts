import assert from 'node:assert/strict'
import test from 'node:test'
import { paperWorldSize } from '../src/editor/constants.ts'

test('keeps A4 document dimensions independent from the viewport', () => {
  const portrait = paperWorldSize('a4-portrait')
  const landscape = paperWorldSize('a4-landscape')

  assert.equal(portrait.width / portrait.height, 210 / 297)
  assert.equal(landscape.width / landscape.height, 297 / 210)
  assert.deepEqual(landscape, { width: portrait.height, height: portrait.width })
})
