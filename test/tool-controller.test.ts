import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolController } from '../src/editor/controllers/tool-controller.ts'

test('maps shell actions to editor tools', () => {
  const tools = new ToolController()
  assert.equal(tools.toolForShellAction('draw-wall'), 'wall')
  assert.equal(tools.toolForShellAction('draw-cable'), 'line')
  assert.equal(tools.toolForShellAction('unknown'), 'select')
})

test('maps the selected tool back to the canonical shell action', () => {
  const tools = new ToolController()
  tools.select('rect')
  assert.equal(tools.shellAction(), 'draw-square')
})

test('reports whether selection actually changed', () => {
  const tools = new ToolController()
  assert.equal(tools.select('select'), false)
  assert.equal(tools.selectForShellAction('draw-symbol'), true)
  assert.equal(tools.current, 'symbol')
  assert.equal(tools.selectForShellAction('draw-symbol'), false)
})
