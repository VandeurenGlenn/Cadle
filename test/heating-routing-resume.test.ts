import assert from 'node:assert/strict'
import test from 'node:test'
import { routeHeating, heatingPathPoints, type HeatingGrid } from '../src/editor/heating-routing.ts'

test('an interrupted physical search resumes its frontier instead of restarting each time', () => {
  const width = 100, height = 70, step = 1, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    door: new Uint8Array(size), room: new Int32Array(size).fill(1), rooms: [],
    point: (cell) => ({ x: cell % width, y: Math.floor(cell / width) }), index: (p) => Math.round(p.y) * width + Math.round(p.x) }
  // A fully closed divider makes each search exhaust its frontier. This is
  // deliberately not a trivial path that can finish before its first pause.
  for (let y = 0; y < height; y++) grid.wall[y * width + 50] = 1
  const start = grid.index({ x: 10, y: 30 }), end = grid.index({ x: 90, y: 30 }), paused = new Error('pause')
  const options = { radiusCells: 6, preferArcs: true, arcOnly: true, continuousTurns: true, variableBends: true, resumeKey: 'unchanged-floor',
    pointFree: (p: { x: number; y: number }) => p.x < 49 || p.x > 51 }
  let finished = false, calls = 0, pauses = 0
  while (!finished && pauses < 80) {
    let sliceCalls = 0
    try {
      const path = routeHeating(grid, start, end, { ...options, checkpoint() { calls++; if (++sliceCalls >= 3) throw paused } })
      assert.equal(path, null); finished = true
    } catch (error) { assert.equal(error, paused); pauses++ }
  }
  assert.ok(pauses > 0, 'the query really was interrupted')
  assert.ok(finished, `resuming must advance the interrupted search (${calls} checkpoints)`)
  // A new physical query must not reuse the previous query's exhausted tree.
  const path = routeHeating(grid, start, grid.index({ x: 30, y: 30 }), { ...options, resumeKey: 'different-target' })
  assert.ok(path)
  assert.ok(heatingPathPoints(grid, path).at(-1)!.x < 50)
})

test('detours survive duplicate heap entries and pauses in the obstacle heuristic', () => {
  const width = 120, height = 90, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step: 1, width, height,
    wall: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    door: new Uint8Array(size), room: new Int32Array(size).fill(1), rooms: [],
    point: (cell) => ({ x: cell % width, y: Math.floor(cell / width) }), index: (p) => Math.round(p.y) * width + Math.round(p.x) }
  for (let y = 15; y < height; y++) grid.wall[y * width + 60] = 1
  const start = grid.index({ x: 10, y: 70 }), end = grid.index({ x: 110, y: 70 })
  const options = { radiusCells: 6, preferArcs: true, arcOnly: true, continuousTurns: true, variableBends: true,
    obstacleHeuristic: true, resumeKey: 'detour', pointFree: (p: { x: number; y: number }) => p.y < 14 || p.x < 59 || p.x > 61 }
  const baseline = routeHeating(grid, start, end, options)
  assert.ok(baseline)
  let result: number[] | null = null, pauses = 0, callbacks = 0
  const paused = new Error('pause')
  for (let slice = 0; slice < 256; slice++) {
    let calls = 0
    try {
      result = routeHeating(grid, start, end, { ...options, checkpoint() { callbacks++; if (++calls === 3) throw paused } })
      break
    } catch (error) { assert.equal(error, paused); pauses++ }
  }
  assert.ok(pauses > 0)
  assert.ok(callbacks >= pauses * 3)
  assert.ok(result, 'both the reverse-distance frontier and the physical search advance')
  assert.deepEqual(heatingPathPoints(grid, result), heatingPathPoints(grid, baseline))
})
