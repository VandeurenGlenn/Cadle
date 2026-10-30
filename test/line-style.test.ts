import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import type { LineShape } from '../src/editor/model/types.ts'

test('exports an unstyled line as black with a two-pixel pen', () => {
  const line: LineShape = { id: 'line', kind: 'line', start: { x: 10, y: 20 }, end: { x: 100, y: 20 } }
  const markup = shapeMarkup(line, false)
  assert.match(markup, /stroke="#000000"/)
  assert.match(markup, /stroke-width: 2px/)
  const custom = shapeMarkup({ ...line, stroke: '#123456', strokeWidth: 4 }, false)
  assert.match(custom, /stroke="#123456"/)
  assert.match(custom, /stroke-width: 4px/)
})
