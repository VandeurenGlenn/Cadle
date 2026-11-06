import assert from 'node:assert/strict'
import test from 'node:test'
import { snapWallPoint } from '../src/editor/interaction/wall-snap.ts'
import { applyDragMove } from '../src/editor/interaction/pointer-move.ts'
import { wallJunctionMarkup } from '../src/editor/layout/wall-junctions.ts'
import type { LineShape, Point } from '../src/editor/model/types.ts'

const wall = (id: string, start: Point, end: Point, strokeWidth = 8): LineShape => ({ id, kind: 'wall', start, end, strokeWidth })
const grid = (p: Point) => ({ x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 })

test('snaps to actual off-grid endpoints before rounding to the grid', () => {
  const target = wall('target', { x: 107, y: 113 }, { x: 307, y: 113 }), raw = { x: 109, y: 115 }
  assert.deepEqual(snapWallPoint(raw, [target], grid(raw)), { point: target.start, snapped: true })
  assert.deepEqual(snapWallPoint(raw, [{ ...target, hidden: true }], grid(raw)), { point: grid(raw), snapped: false })
  assert.deepEqual(snapWallPoint(raw, [target], grid(raw), { enabled: false }), { point: raw, snapped: false })
})

test('T-junctions meet the wall centreline without a gap, overshoot or small diagonal', () => {
  const target = wall('target', { x: 307, y: 100 }, { x: 307, y: 400 })
  for (const x of [303, 311]) {
    const raw = { x, y: 253 }
    assert.deepEqual(snapWallPoint(raw, [target], grid(raw), { start: { x: 107, y: 251 } }),
      { point: { x: 307, y: 251 }, snapped: true })
  }
  const angled = wall('angled', { x: 300, y: 100 }, { x: 400, y: 400 })
  assert.deepEqual(snapWallPoint({ x: 354, y: 254 }, [angled], { x: 360, y: 260 }, { start: { x: 100, y: 250 } }).point,
    { x: 350, y: 250 })
})

test('uses a consistent screen tolerance and keeps off-grid wall chains straight', () => {
  const target = wall('target', { x: 100, y: 100 }, { x: 300, y: 100 })
  for (const zoom of [.25, 1, 4]) {
    const near = { x: 100 - 8 / zoom, y: 100 }, far = { x: 100 - 12 / zoom, y: 100 }
    assert.equal(snapWallPoint(near, [target], grid(near), { zoom }).snapped, true)
    assert.equal(snapWallPoint(far, [target], grid(far), { zoom }).snapped, false)
  }
  const raw = { x: 300, y: 116 }
  assert.deepEqual(snapWallPoint(raw, [], grid(raw), { start: { x: 107, y: 113 } }).point, { x: 300, y: 113 })
  assert.deepEqual(snapWallPoint({ x: 300, y: 180 }, [], { x: 300, y: 180 }, { start: { x: 107, y: 113 }, orthogonal: true }).point,
    { x: 300, y: 113 })
})

test('moving a wall snaps its raw endpoint onto an existing wall without changing its length', () => {
  const moving = wall('moving', { x: 100, y: 200 }, { x: 200, y: 200 })
  const target = wall('target', { x: 307, y: 100 }, { x: 307, y: 400 })
  const drag = { ids: ['moving'], pointerStart: { x: 0, y: 0 }, initial: [moving] }
  const result = applyDragMove({ x: 103, y: 53 }, drag, grid, [moving, target])
  const moved = result.find((shape) => shape.id === 'moving') as LineShape
  assert.deepEqual(moved.end, { x: 307, y: 253 })
  assert.equal(moved.end.x - moved.start.x, 100)
  assert.deepEqual(moved.start, { x: 207, y: 253 })
  const free = applyDragMove({ x: 103, y: 53 }, drag, (p) => p, [moving, target], 1, false, false)
  assert.deepEqual((free[0] as LineShape).end, { x: 303, y: 253 })
})

test('sharp joints fill actual corners, including unequal widths, without extending free or disconnected ends', () => {
  const first = wall('first', { x: 0, y: 0 }, { x: 100, y: 0 }, 8)
  const second = wall('second', { x: 100, y: 0 }, { x: 100, y: 100 }, 12)
  const markup = wallJunctionMarkup([first, second])
  assert.match(markup, /M 100 0 L 100 -4 L 106 -4 L 106 0 Z/)
  assert.equal((markup.match(/wall-junction/g) ?? []).length, 1)
  assert.equal(wallJunctionMarkup([first]), '')
  assert.equal(wallJunctionMarkup([first, { ...second, start: { x: 101, y: 0 } }]), '')
  assert.equal(wallJunctionMarkup([first, { ...second, hidden: true }]), '')
})

test('a short new segment is not pulled back onto the current chain start', () => {
  const previous = wall('previous', { x: 100, y: 113 }, { x: 307, y: 113 })
  const raw = { x: 308, y: 121 }
  const result = snapWallPoint(raw, [previous], grid(raw), { start: previous.end })
  assert.deepEqual(result.point, { x: 307, y: 120 })
  assert.equal(result.snapped, false)
})
