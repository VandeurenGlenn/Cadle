import assert from 'node:assert/strict'
import test from 'node:test'
import { bindingLabelOffset, parseSvgViewBox } from '../src/editor/layout/symbol-layout.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('parses valid SVG view boxes and rejects invalid dimensions', () => {
  assert.deepEqual(parseSvgViewBox('0 0 24 36'), { minX: 0, minY: 0, width: 24, height: 36 })
  assert.equal(parseSvgViewBox('0 0 0 24'), null)
  assert.equal(parseSvgViewBox('not a view box'), null)
})

test('places binding labels symmetrically around non-symbol shapes', () => {
  const shape: Shape = {
    id: 'line-1',
    kind: 'line',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    bindingId: 'A1'
  }

  const left = bindingLabelOffset(shape, 'left')
  const right = bindingLabelOffset(shape, 'right')
  const top = bindingLabelOffset(shape, 'top')
  const bottom = bindingLabelOffset(shape, 'bottom')

  assert.equal(left.x, -right.x)
  assert.equal(left.y, 0)
  assert.equal(top.y, -bottom.y)
  assert.equal(top.x, 0)
})
