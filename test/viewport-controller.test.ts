import assert from 'node:assert/strict'
import test from 'node:test'
import { ViewportController } from '../src/editor/controllers/viewport-controller.ts'

test('converts screen coordinates to world coordinates', () => {
  const viewport = new ViewportController()
  viewport.setPan(20, 10)
  viewport.zoomAt({ x: 20, y: 10 }, 2)

  assert.deepEqual(viewport.screenToWorld({ x: 40, y: 30 }), { x: 10, y: 10 })
})

test('keeps the world point under the cursor fixed while zooming', () => {
  const viewport = new ViewportController()
  const anchor = { x: 120, y: 80 }
  const before = viewport.screenToWorld(anchor)

  viewport.zoomAt(anchor, 2)

  assert.deepEqual(viewport.screenToWorld(anchor), before)
})

test('fits and centers a world inside a container', () => {
  const viewport = new ViewportController()
  assert.equal(viewport.fit({ width: 1000, height: 600 }, { width: 1600, height: 900 }), true)
  assert.deepEqual(viewport.state, { zoom: 0.61, panX: 12, panY: 25.5 })
})

test('clamps zoom and rejects invalid factors', () => {
  const viewport = new ViewportController()
  viewport.zoomAt({ x: 0, y: 0 }, 100)
  assert.equal(viewport.state.zoom, 8)
  viewport.zoomAt({ x: 0, y: 0 }, 0.0001)
  assert.equal(viewport.state.zoom, 0.1)
  assert.equal(viewport.zoomAt({ x: 0, y: 0 }, Number.NaN), false)
})
