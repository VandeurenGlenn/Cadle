import assert from 'node:assert/strict'
import test from 'node:test'
import type { HeatingGrid } from '../src/editor/heating-routing.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { prepareHeatingGuardedBundle, mergeHeatingGuardedFeeds } from '../src/editor/heating-guarded-bundle.ts'

const fixture = () => {
  const width = 140, height = 100, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, width, height, step,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [], point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (point) => Math.round(point.y / step) * width + Math.round(point.x / step) }
  const data = { ...heatingPipeData(100), diameterMm: 16, spacingMm: 100, automatic: true, circuitId: 'VV01', design: { maxCircuitLengthM: 120 } }
  const coil = createHeatingPipe('coil', [{ x: 100, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 80 }, { x: 100, y: 80 }], { ...data, pipeRole: 'loop' })
  const incoming = createHeatingPipe('entry-in', [{ x: 60, y: 40 }, { x: 100, y: 40 }], { ...data, pipeRole: 'supply' })
  const outgoing = createHeatingPipe('entry-out', [{ x: 100, y: 80 }, { x: 60, y: 80 }], { ...data, pipeRole: 'return' })
  const roots = [40, 80].map((y) => { const cell = grid.index({ x: 16, y }); return [cell, cell + 1] })
  return { grid, coil, incoming, outgoing, roots }
}

test('guarded topology reserves real entry tails and merges leaders back at the untouched original coil ports', () => {
  const { grid, coil, incoming, outgoing, roots } = fixture(), blocked = grid.obstacle.slice()
  const before = JSON.stringify({ coil, incoming, outgoing, roots, blocked: [...blocked] })
  // An unrelated native reservation must survive the proxy conversion.
  const reservation = grid.index({ x: 32, y: 120 }); blocked[reservation] = 1
  const bundle = prepareHeatingGuardedBundle(grid, roots, [coil], [[incoming, outgoing]], blocked)
  assert.ok(bundle)
  assert.equal(bundle.flows.length, 2)
  assert.equal(bundle.blocked[reservation], 1)
  assert.equal(bundle.blocked[grid.index({ x: 80, y: 40 })], 1, 'another leader cannot cross a reserved local entry')
  assert.deepEqual(heatingPipeGeometry(bundle.coils[0]).points, [{ x: 60, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 80 }, { x: 60, y: 80 }])
  const merged = mergeHeatingGuardedFeeds(bundle, [[{ x: 16, y: 40 }, { x: 60, y: 40 }], [{ x: 16, y: 80 }, { x: 60, y: 80 }]])
  assert.ok(merged)
  assert.deepEqual(merged.map((points) => points.at(-1)), [{ x: 100, y: 40 }, { x: 100, y: 80 }])
  const feeds = merged.map((points, i) => createHeatingPipe(`leader-${i}`, i ? [...points].reverse() : points,
    { ...coil.heating!, pipeRole: i ? 'return' : 'supply' }))
  assert.equal(checkHeatingPlan([coil, ...feeds], [], { maxCircuitLengthM: 120 }).errors, 0)
  blocked[reservation] = 0
  assert.equal(JSON.stringify({ coil, incoming, outgoing, roots, blocked: [...blocked] }), before)
})

test('guarded topology rejects disconnected tail joints, blocked door terminals and mismatched merge endpoints', () => {
  const { grid, coil, incoming, outgoing, roots } = fixture()
  const invalid = createHeatingPipe('wrong-joint', [{ x: 60, y: 40 }, { x: 101, y: 40 }], incoming.heating!)
  assert.equal(prepareHeatingGuardedBundle(grid, roots, [coil], [[invalid, outgoing]], grid.obstacle), null)
  const blocked = grid.obstacle.slice(); blocked[grid.index({ x: 60, y: 40 }) - 1] = 1
  assert.equal(prepareHeatingGuardedBundle(grid, roots, [coil], [[incoming, outgoing]], blocked), null)
  const bundle = prepareHeatingGuardedBundle(grid, roots, [coil], [[incoming, outgoing]], grid.obstacle)!
  assert.ok(bundle)
  assert.equal(mergeHeatingGuardedFeeds(bundle, [[{ x: 16, y: 40 }, { x: 61, y: 40 }], [{ x: 16, y: 80 }, { x: 60, y: 80 }]]), null)
})

test('an entry inside the source room can remain unextended and cooperative pause leaves the inputs intact', () => {
  const { grid, coil, roots } = fixture(), before = JSON.stringify(coil), pause = new Error('pause')
  assert.throws(() => prepareHeatingGuardedBundle(grid, roots, [coil], [undefined], grid.obstacle,
    { checkpoint: () => { throw pause } }), (error) => error === pause)
  assert.equal(JSON.stringify(coil), before)
  const bundle = prepareHeatingGuardedBundle(grid, roots, [coil], [undefined], grid.obstacle)
  assert.ok(bundle)
  assert.equal(bundle.coils[0], coil)
  const points = [[{ x: 16, y: 40 }, { x: 100, y: 40 }], [{ x: 16, y: 80 }, { x: 100, y: 80 }]]
  assert.deepEqual(mergeHeatingGuardedFeeds(bundle, points), points)
})

test('invalid source roots and mismatched guard circuit metadata are rejected before residual routing', () => {
  const { grid, coil, incoming, outgoing, roots } = fixture()
  for (const invalid of [[[], roots[1]], [[Number.NaN], roots[1]], [[-1], roots[1]]]) {
    assert.equal(prepareHeatingGuardedBundle(grid, invalid, [coil], [[incoming, outgoing]], grid.obstacle), null)
  }
  const alien = { ...incoming, heating: { ...incoming.heating!, circuitId: 'VV02' } }
  assert.equal(prepareHeatingGuardedBundle(grid, roots, [coil], [[alien, outgoing]], grid.obstacle), null)
  const smallTube = { ...incoming, heating: { ...incoming.heating!, diameterMm: 8 } }
  assert.equal(prepareHeatingGuardedBundle(grid, roots, [coil], [[smallTube, outgoing]], grid.obstacle), null)
  assert.equal(prepareHeatingGuardedBundle(grid, roots, [], [], grid.obstacle), null)
})
