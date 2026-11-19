import assert from 'node:assert/strict'
import test from 'node:test'
import { ToolController } from '../src/editor/controllers/tool-controller.ts'

test('maps shell actions to editor tools', () => {
  const tools = new ToolController()
  assert.equal(tools.toolForShellAction('draw-wall'), 'wall')
  assert.equal(tools.toolForShellAction('draw-sliding-door'), 'sliding-door')
  assert.equal(tools.toolForShellAction('draw-sliding-window'), 'sliding-window')
  assert.equal(tools.toolForShellAction('draw-built-in-cabinet'), 'built-in-cabinet')
  assert.equal(tools.toolForShellAction('draw-stairs'), 'stairs-straight')
  assert.equal(tools.toolForShellAction('draw-stairs-quarter-turn'), 'stairs-quarter-turn')
  assert.equal(tools.selectForShellAction('draw-stairs-double-quarter-turn'), true)
  assert.equal(tools.current, 'stairs-double-quarter-turn')
  assert.equal(tools.shellAction(), 'draw-stairs-double-quarter-turn')
  assert.equal(tools.toolForShellAction('draw-stairs-spiral'), 'stairs-spiral')
  assert.equal(tools.toolForShellAction('draw-access-point'), 'symbol')
  assert.equal(tools.toolForShellAction('draw-room'), 'room')
  assert.equal(tools.toolForShellAction('draw-cable'), 'line')
  assert.equal(tools.toolForShellAction('unknown'), 'select')
})

test('maps the selected tool back to the canonical shell action', () => {
  const tools = new ToolController()
  tools.select('sliding-door')
  assert.equal(tools.shellAction(), 'draw-sliding-door')
  tools.select('rect')
  assert.equal(tools.shellAction(), 'draw-square')
})

test('maps all roof actions and tools in both directions', () => {
  const tools = new ToolController()
  for (const [action, tool] of [
    ['draw-roof-left', 'roof-left'],
    ['draw-roof-straight', 'roof-straight'],
    ['draw-roof-right', 'roof-right']
  ] as const) {
    assert.equal(tools.toolForShellAction(action), tool)
    assert.equal(tools.selectForShellAction(action), true)
    assert.equal(tools.current, tool)
    assert.equal(tools.shellAction(), action)
  }
})

test('reports whether selection actually changed', () => {
  const tools = new ToolController()
  assert.equal(tools.select('select'), false)
  assert.equal(tools.selectForShellAction('draw-symbol'), true)
  assert.equal(tools.current, 'symbol')
  assert.equal(tools.selectForShellAction('draw-symbol'), false)
})
