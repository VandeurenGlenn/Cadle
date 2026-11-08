import assert from 'node:assert/strict'
import test from 'node:test'
import { routeHeating, heatingSharedDoors, heatingRouteCorridor, type HeatingGrid } from '../src/editor/heating-routing.ts'

const grid = (width: number, height: number): HeatingGrid => ({
  origin: { x: 0, y: 0 }, step: 1, width, height,
  wall: new Uint8Array(width * height), door: new Uint8Array(width * height),
  obstacle: new Uint8Array(width * height), loopObstacle: new Uint8Array(width * height),
  room: new Int32Array(width * height), rooms: [],
  point: (i) => ({ x: i % width, y: Math.floor(i / width) }),
  index: ({ x, y }) => y * width + x
})
const entries = (g: HeatingGrid, path: number[]) => path.filter((cell, i) =>
  g.wall[cell] && !g.door[cell] && (!i || !g.wall[path[i - 1]] || g.door[path[i - 1]])).length

test('paired leads stay on the same side of an intervening room', () => {
  const g = grid(81, 81)
  for (let y = 20; y <= 50; y++) for (let x = 20; x <= 50; x++) g.obstacle[g.index({ x, y })] = 1
  const supply = [
    ...Array.from({ length: 51 }, (_, i) => g.index({ x: 10, y: 10 + i })),
    ...Array.from({ length: 30 }, (_, i) => g.index({ x: 11 + i, y: 60 })),
    ...Array.from({ length: 5 }, (_, i) => g.index({ x: 40, y: 61 + i }))
  ]
  const corridor = heatingRouteCorridor(g, supply, 4)
  const returning = routeHeating(g, g.index({ x: 42, y: 65 }), g.index({ x: 12, y: 10 }), {
    radiusCells: 2, occupied: new Set(supply), requiredCorridor: corridor
  })!
  assert.ok(returning)
  assert.ok(returning.every((cell) => corridor.has(cell)))
  assert.ok(returning.filter((cell) => g.point(cell).y >= 20 && g.point(cell).y <= 50).every((cell) => g.point(cell).x < 20))
})

test('return routing prefers the supply doorway while retaining a wall-free alternative', () => {
  const g = grid(81, 51)
  for (let y = 0; y < g.height; y++) g.wall[g.index({ x: 40, y })] = 1
  for (const middle of [10, 30]) for (let y = middle - 1; y <= middle + 1; y++) g.door[g.index({ x: 40, y })] = 1
  const supply = routeHeating(g, g.index({ x: 20, y: 10 }), g.index({ x: 60, y: 10 }))!
  assert.ok(supply)
  const shared = heatingSharedDoors(g, supply)
  assert.ok(shared.has(g.index({ x: 40, y: 9 })), 'recognise the whole opening, not only the supply cells')
  const returning = routeHeating(g, g.index({ x: 60, y: 25 }), g.index({ x: 20, y: 25 }), { preferredDoors: shared })!
  assert.ok(returning.some((cell) => shared.has(cell)))
  assert.equal(entries(g, returning), 0)
})

for (const radiusCells of [undefined, 2]) {
  const algorithm = radiusCells ? 'bend-aware routing' : 'cell routing'
  test(`${algorithm}: allows a useful short penetration by the manifold while preferring nearby doors`, () => {
    const g = grid(61, 51)
    for (let y = 0; y < g.height; y++) g.wall[g.index({ x: 30, y })] = 1
    for (let y = 10; y <= 13; y++) g.door[g.index({ x: 30, y })] = 1
    const start = g.index({ x: 20, y: 25 }), end = g.index({ x: 40, y: 25 })
    const options = { allowWalls: true, radiusCells }
    const viaDoor = routeHeating(g, start, end, options)!
    assert.equal(entries(g, viaDoor), 0)
    assert.ok(viaDoor.some((cell) => g.door[cell]))
    const access = { point: { x: 30, y: 25 }, radius: 5, entryPenalty: 10 }
    const shortcut = routeHeating(g, start, end, { ...options, manifoldAccess: access })!
    assert.equal(entries(g, shortcut), 1)
    assert.ok(shortcut.length < viaDoor.length)
    const awayFromManifold = routeHeating(g, start, end, { ...options,
      manifoldAccess: { ...access, point: { x: 30, y: 45 } } })!
    assert.equal(entries(g, awayFromManifold), 0, 'the discount applies only near the manifold')
    const nearbyDoor = routeHeating(g, g.index({ x: 20, y: 13 }), g.index({ x: 40, y: 13 }), {
      ...options, manifoldAccess: { ...access, point: { x: 30, y: 13 } }
    })!
    assert.equal(entries(g, nearbyDoor), 0, 'an equally short doorway is always preferred')
  })

  test(`${algorithm}: chooses the shorter wall route over a long doorway detour`, () => {
    const g = grid(61, 51)
    for (let y = 0; y < g.height; y++) g.wall[g.index({ x: 30, y })] = 1
    for (let y = 5; y <= 8; y++) g.door[g.index({ x: 30, y })] = 1
    const start = g.index({ x: 20, y: 25 }), end = g.index({ x: 40, y: 25 })
    const path = routeHeating(g, start, end, { allowWalls: true, radiusCells, wallEntryPenalty: 1 })!
    assert.ok(path)
    assert.equal(entries(g, path), 1)
    assert.ok(path.length < 40, 'the direct wall route is shorter than the doorway detour')
  })

  test(`${algorithm}: prefers one penetration to several thin-wall penetrations`, () => {
    const g = grid(61, 41)
    g.obstacle.fill(1)
    for (let x = 5; x <= 55; x++) for (const y of [10, 30]) g.obstacle[g.index({ x, y })] = 0
    for (let y = 10; y <= 30; y++) for (const x of [5, 55]) g.obstacle[g.index({ x, y })] = 0
    for (const x of [20, 30, 40]) g.wall[g.index({ x, y: 10 })] = 1
    for (let x = 26; x <= 28; x++) g.wall[g.index({ x, y: 30 })] = 1
    const start = g.index({ x: 5, y: 20 }), end = g.index({ x: 55, y: 20 })
    const path = routeHeating(g, start, end, { allowWalls: true, radiusCells })!
    assert.ok(path)
    assert.equal(entries(g, path), 1)
    assert.ok(path.some((cell) => g.point(cell).y === 30))
    assert.equal(routeHeating(g, start, end, { radiusCells }), null, 'coils cannot use wall access')
  })

  test(`${algorithm}: interrupts an in-flight search and can safely reuse its workspace`, () => {
    const g = grid(160, 120), start = g.index({ x: 20, y: 60 }), end = g.index({ x: 140, y: 60 })
    for (let y = 0; y < g.height; y++) g.obstacle[g.index({ x: 80, y })] = 1
    const expired = new Error('room deadline'), options = { radiusCells }
    let checkpoints = 0
    assert.throws(() => routeHeating(g, start, end, { ...options,
      checkpoint: () => { if (++checkpoints === 2) throw expired } }), (error) => error === expired)
    assert.equal(checkpoints, 2, 'the second checkpoint must occur inside the active route search')
    assert.equal(routeHeating(g, start, end, options), null)
    g.obstacle.fill(0)
    const path = routeHeating(g, start, end, options)!
    assert.equal(path[0], start)
    assert.equal(path.at(-1), end)
    for (let i = 1; i < path.length; i++) assert.equal(Math.abs(path[i] - path[i - 1]), 1)
  })
}
