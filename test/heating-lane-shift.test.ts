import assert from 'node:assert/strict'
import test from 'node:test'
import { routeHeating, heatingPathPoints, type HeatingGrid } from '../src/editor/heating-routing.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('a small parallel lane change keeps R80 without demanding 160 mm of lateral space', () => {
  const width = 80, height = 24, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const start = 10 * width + 10, end = 11 * width + 60
  const options = { radiusCells: 8, preferArcs: true, startDirection: 1, endDirection: 1,
    pointFree: (p: { x: number; y: number }) => p.y >= 15.2 && p.y <= 18.4 }
  assert.equal(routeHeating(grid, start, end, options), null)
  const path = routeHeating(grid, start, end, { ...options, continuousTurns: true })!
  assert.ok(path)
  const points = heatingPathPoints(grid, path)
  assert.deepEqual(points[0], grid.point(start)); assert.deepEqual(points.at(-1), grid.point(end))
  const pipe = createHeatingPipe('lane-change', points, { ...heatingPipeData(100), diameterMm: 16, automatic: true, circuitId: 'VV01' })
  const geometry = heatingPipeGeometry(pipe)
  assert.ok(geometry.bends.length >= 2)
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(geometry.pieces.every((piece) => [piece.a, piece.b].every((p) => p.y >= 15.99 && p.y <= 17.61)))
  assert.equal(checkHeatingPlan([pipe], []).errors, 0)
})

test('a 130 mm lane change fits in a short 200 mm approach with one smooth R80 S', () => {
  const width = 60, height = 40, step = .8, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, step, width, height,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (i) => ({ x: i % width * step, y: Math.floor(i / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const start = 10 * width + 10, end = 23 * width + 30
  const path = routeHeating(grid, start, end, { radiusCells: 16, preferArcs: true, continuousTurns: true,
    startDirection: 1, endDirection: 1, pointFree: (p) => p.x >= 8 - 1e-7 && p.x <= 24 + 1e-7 && p.y >= 8 - 1e-7 && p.y <= 18.4 + 1e-7 })
  assert.ok(path, 'many 10–20 mm shifts cannot fit this short entrance; one complete S can')
  const pipe = createHeatingPipe('wide-lane-change', heatingPathPoints(grid, path),
    { ...heatingPipeData(100), diameterMm: 16, automatic: true, circuitId: 'VV01' })
  const geometry = heatingPipeGeometry(pipe)
  assert.equal(geometry.bends.length, 2)
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.equal(checkHeatingPlan([pipe], []).errors, 0)
})
