import test from 'node:test'
import assert from 'node:assert/strict'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import type { HeatingGrid } from '../src/editor/heating-routing.ts'

const gridFor = (width = 30, height = 20): HeatingGrid => {
  const size = width * height
  return { width, height, origin: { x: 0, y: 0 }, step: 1, drawingScale: 100, wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size), room: new Int32Array(size), rooms: [], point: (i) => ({ x: i % width, y: Math.floor(i / width) }), index: (p) => p.y * width + p.x }
}
test('routes a whole bundle through a common opening without overlapping paths', () => {
  const grid = gridFor(), blocked = new Uint8Array(grid.wall.length)
  for (let y = 0; y < 20; y++) if (y < 6 || y > 11) blocked[y * grid.width + 15] = 1
  const sources = [61, 151, 241, 331], goals = [118, 238, 358, 478], before = blocked.slice()
  const paths = routeHeatingBundle(grid, sources, goals, blocked, {})!
  assert.equal(paths.length, goals.length)
  assert.equal(new Set(paths.map((p) => p.source)).size, sources.length)
  assert.deepEqual(paths.map((p) => p.cells.at(-1)), goals)
  assert.equal(new Set(paths.flatMap((p) => p.cells)).size, paths.reduce((n, p) => n + p.cells.length, 0))
  assert.ok(paths.every((p) => p.cells.every((c) => !blocked[c])))
  assert.deepEqual(blocked, before)
})
test('reports a genuine bundle bottleneck instead of returning partial paths', () => {
  const grid = gridFor(), blocked = new Uint8Array(grid.wall.length)
  for (let y = 0; y < 20; y++) if (y !== 8) blocked[y * grid.width + 15] = 1
  assert.equal(routeHeatingBundle(grid, [61, 151], [118, 238], blocked, {}), null)
})
test('bundle search checks its shared work deadline and leaves input masks unchanged', () => {
  const grid = gridFor(80, 80), blocked = new Uint8Array(grid.wall.length), stop = new Error('stop')
  let checks = 0
  assert.throws(() => routeHeatingBundle(grid, [81, 161], [6300, 6301], blocked, { checkpoint: () => { if (++checks > 2) throw stop } }), (error) => error === stop)
  assert.ok(blocked.every((v) => v === 0))
})
