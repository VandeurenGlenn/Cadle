import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftShape } from '../src/editor/interaction/pointer-down-builders.ts'
import { updateDraftShapeEnd } from '../src/editor/interaction/pointer-move.ts'
import { canCommitDraft } from '../src/editor/interaction/pointer-up.ts'
import { cloneShape, sanitizeShapes, scaleShape, shapeBounds } from '../src/editor/model/model.ts'
import { stairGeometry } from '../src/editor/model/stair-geometry.ts'
import { buildSvgDocument, shapeMarkup } from '../src/editor/export/svg-export.ts'
import { cleanStairRoute, createStairRoute, snapStairRoutePoint, stairRouteError, stairRoutePoints, stairRouteWidth, stairShapeGeometry, visibleStairRoute } from '../src/editor/model/stair-route.ts'
import { translateShape } from '../src/editor/interaction/shape-transforms.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { createNativeSelectionChangedPayload } from '../src/editor/interaction/selection-payload.ts'
import { PAPER_PRESETS } from '../src/editor/constants.ts'
import type { LineShape, RectShape } from '../src/editor/model/types.ts'

for (const variant of ['stairs-straight', 'stairs-quarter-turn', 'stairs-double-quarter-turn', 'stairs-spiral'] as const) {
  test(`${variant} resizes with the pointer and retains its geometry after saving and scaling`, () => {
    const draft = createDraftShape(variant, { x: 100, y: 120 }, variant)
    assert.equal(draft.kind, 'rect')
    assert.equal(canCommitDraft(draft), false)
    const narrow = updateDraftShapeEnd(draft, { x: 180, y: 360 }, (point) => point)
    const wide = updateDraftShapeEnd(narrow, { x: 260, y: 420 }, (point) => point)
    assert.deepEqual(shapeBounds(narrow), { x: 100, y: 120, width: 80, height: 240 })
    assert.deepEqual(shapeBounds(wide), { x: 100, y: 120, width: 160, height: 300 })
    assert.equal(canCommitDraft(wide), true)
    assert.equal(canCommitDraft({ ...draft, end: { x: 100, y: 420 } }), false)
    const [saved] = sanitizeShapes(JSON.parse(JSON.stringify([wide])))
    assert.deepEqual(saved, wide)
    assert.deepEqual(cloneShape(saved), wide)
    const scaled = scaleShape(saved, 2, 2)
    assert.deepEqual(shapeBounds(scaled), { x: 200, y: 240, width: 320, height: 600 })
    const geometry = stairGeometry(shapeBounds(saved), variant)
    const markup = shapeMarkup(saved, false)
    assert.ok(markup.includes(`data-stair-variant="${variant}"`))
    for (const path of Object.values(geometry)) {
      assert.ok(markup.includes(`d="${path}"`))
      assert.doesNotMatch(path, /NaN|Infinity/)
    }
    assert.notEqual(stairGeometry(shapeBounds(scaled), variant).treads, geometry.treads)
  })
}

test('stair geometry follows reverse dragging and Shift constrains a spiral to a circle', () => {
  const draft = createDraftShape('spiral', { x: 300, y: 400 }, 'stairs-spiral')
  const resized = updateDraftShapeEnd(draft, { x: 120, y: 100 }, (point) => point, true)
  assert.deepEqual(shapeBounds(resized), { x: 0, y: 100, width: 300, height: 300 })
  const geometry = stairGeometry(shapeBounds(resized), 'stairs-spiral')
  assert.match(geometry.outline, /A 150 150/)
  assert.equal((geometry.treads.match(/M /g) ?? []).length, 12)
})

test('quarter-turn stairs have two perpendicular flights instead of a rectangular symbol', () => {
  const bounds = { x: 0, y: 0, width: 200, height: 300 }
  const turning = stairGeometry(bounds, 'stairs-quarter-turn')
  const straight = stairGeometry(bounds, 'stairs-straight')
  assert.match(turning.outline, /L 200 80 L 80 80 L 80 300/)
  assert.notEqual(turning.arrow, straight.arrow)
  assert.match(turning.arrow, /L 40 40 L 180 40/)
})

test('double-quarter-turn stairs have three flights, two winding corners and an open centre', () => {
  const geometry = stairGeometry({ x: 10, y: 20, width: 240, height: 300 }, 'stairs-double-quarter-turn')
  assert.equal(geometry.outline,
    'M 10 320 L 10 20 L 250 20 L 250 320 L 134 320 L 134 136 L 126 136 L 126 320 Z')
  assert.ok(geometry.treads.includes('M 10 20 L 126 136'))
  assert.ok(geometry.treads.includes('M 250 20 L 134 136'))
  assert.ok(!geometry.treads.includes('M 130 20'))
  assert.ok(geometry.arrow.startsWith('M 68 291 L 68 78 L 192 78 L 192 291'))
})

test('double-quarter-turn stairs keep a narrow well and matching wall-cut geometry', () => {
  for (const [width, height] of [[120, 600], [240, 300], [300, 300], [400, 300], [1, 1]]) {
    const shape: RectShape = { id: 'compact', kind: 'rect', variant: 'stairs-double-quarter-turn',
      start: { x: 0, y: 0 }, end: { x: width, y: height } }
    const geometry = stairShapeGeometry(shape)
    const points = pathPoints(geometry.outline)
    const gap = points[4].x - points[6].x
    assert.ok(gap > 0 && gap <= 8 + 1e-6, `well width ${gap}`)
    assert.equal(stairRouteWidth(shape), points[6].x)
    const route = stairRoutePoints(shape)
    assert.equal(route[0].x, points[6].x / 2)
    assert.equal(route[3].x, width - points[6].x / 2)
  }
})

test('double-quarter-turn stairs retain valid geometry in wide, shallow and tiny footprints', () => {
  for (const [width, height] of [[120, 600], [600, 120], [1, 1]]) {
    const geometry = stairGeometry({ x: 0, y: 0, width, height }, 'stairs-double-quarter-turn')
    for (const path of Object.values(geometry)) assert.doesNotMatch(path, /NaN|Infinity/)
    const points = pathPoints(geometry.outline)
    const flight = points[6].x
    assert.ok(width - 2 * flight > 0)
    assert.ok(geometry.outline.includes(`L ${width - flight} ${flight} L ${flight} ${flight}`))
  }
})

const route = [{ x: 100, y: 400 }, { x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 400 }]
const wall: LineShape = { id: 'wall', kind: 'wall', start: { x: 0, y: 250 }, end: { x: 400, y: 250 }, strokeWidth: 10 }
const pathPoints = (path: string) => {
  const numbers = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? []
  return Array.from({ length: numbers.length / 2 }, (_, i) => ({ x: numbers[2 * i], y: numbers[2 * i + 1] }))
}

test('a clicked route generates sized flights and winders and preserves its route through model operations', () => {
  const shape = createStairRoute('route', route, 80)
  assert.deepEqual(stairRoutePoints(shape), route)
  assert.equal(stairRouteWidth(shape), 80)
  const geometry = stairShapeGeometry(shape)
  assert.ok(geometry.outline.includes('L 340 60 L 60 60'))
  assert.ok(geometry.treads.includes('M 140 140 L 60 60'))
  assert.ok(geometry.treads.includes('M 260 140 L 340 60'))
  const [saved] = sanitizeShapes(JSON.parse(JSON.stringify([shape])))
  assert.deepEqual(saved, shape)
  const cloned = cloneShape(shape) as RectShape
  cloned.stairRoute!.points[0].x = 0
  assert.notDeepEqual(cloned.stairRoute, shape.stairRoute)
  const scaled = scaleShape(shape, 2, 2) as RectShape
  assert.equal(stairRouteWidth(scaled), 160)
  assert.deepEqual(stairRoutePoints(scaled), route.map((p) => ({ x: p.x * 2, y: p.y * 2 })))
  const moved = translateShape(shape, 50, 20) as RectShape
  assert.deepEqual(stairRoutePoints(moved), route.map((p) => ({ x: p.x + 50, y: p.y + 20 })))
})

test('route drawing snaps perpendicular flights, merges straight clicks and rejects degenerate routes', () => {
  assert.deepEqual(snapStairRoutePoint({ x: 295, y: 125 }, { x: 100, y: 100 }), { x: 295, y: 100 })
  assert.deepEqual(snapStairRoutePoint({ x: 115, y: 305 }, { x: 100, y: 100 }), { x: 100, y: 305 })
  assert.deepEqual(cleanStairRoute([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]),
    [{ x: 0, y: 0 }, { x: 100, y: 0 }])
  assert.match(stairRouteError([{ x: 0, y: 0 }, { x: 20, y: 0 }], 80)!, /te kort/)
  assert.match(stairRouteError([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], 80)!, /Keer niet/)
  assert.throws(() => createStairRoute('empty', [], 80), /minstens/)
  assert.deepEqual(sanitizeShapes([{ ...createStairRoute('invalid', route, 80), stairRoute: { points: [{ x: NaN, y: 0 }], width: 0 } }]), [])
})

test('the first crossed wall cuts off every subsequent flight, even when the route returns to the visible side', () => {
  const shape = createStairRoute('route', route, 80)
  const original = JSON.stringify(shape)
  const visible = visibleStairRoute(shape, [{ ...wall, id: 'further', start: { x: 0, y: 200 }, end: { x: 400, y: 200 } }, wall])
  assert.deepEqual(visible.points, [{ x: 100, y: 400 }, { x: 100, y: 255 }])
  assert.equal(visible.cut, true)
  const geometry = stairShapeGeometry(shape, [wall])
  for (const p of Object.values(geometry).flatMap(pathPoints)) assert.ok(p.y >= 255 - 1e-6, JSON.stringify(p))
  assert.ok(geometry.breakLine.length > 0)
  assert.equal(stairShapeGeometry(shape, []).outline, stairShapeGeometry(shape).outline)
  assert.equal(JSON.stringify(shape), original)
  assert.deepEqual(visibleStairRoute(shape, [{ ...wall, start: { x: 250, y: 250 } }]).points,
    [...route.slice(0, 3), { x: 300, y: 245 }])
})

test('wall truncation works after rotation and mirroring and ignores hidden, parallel and merely touching walls', () => {
  const straight = createStairRoute('route', [{ x: 100, y: 400 }, { x: 100, y: 100 }], 80)
  const rotated = { ...straight, rotation: 90 }
  const vertical: LineShape = { ...wall, start: { x: 100, y: 0 }, end: { x: 100, y: 500 } }
  assert.ok(visibleStairRoute(rotated, [vertical]).cut)
  assert.deepEqual(visibleStairRoute({ ...straight, flipY: true }, [wall]).points,
    [{ x: 100, y: 400 }, { x: 100, y: 255 }])
  const uncut = [
    { ...wall, hidden: true }, { ...wall, kind: 'line' as const },
    { ...wall, start: { x: 140, y: 400 }, end: { x: 140, y: 100 } },
    { ...wall, end: { x: 100, y: 250 } }
  ]
  assert.equal(visibleStairRoute(straight, uncut).cut, false)
  for (const variant of ['stairs-quarter-turn', 'stairs-double-quarter-turn'] as const) {
    const old: RectShape = { id: variant, kind: 'rect', variant, start: { x: 0, y: 0 }, end: { x: 400, y: 400 } }
    assert.ok(stairShapeGeometry(old, [wall]).breakLine)
  }
})

test('an angled wall clips the visible flight at its near face rather than letting tread edges cross it', () => {
  const shape = createStairRoute('route', [{ x: 100, y: 400 }, { x: 100, y: 100 }], 80)
  const angled: LineShape = { ...wall, start: { x: 0, y: 150 }, end: { x: 300, y: 450 } }
  const geometry = stairShapeGeometry(shape, [angled])
  for (const p of Object.values(geometry).flatMap(pathPoints)) {
    assert.ok(p.y - p.x >= 150 + 5 * Math.SQRT2 - 1e-6, JSON.stringify(p))
  }
})

test('a wall just after a turn cannot produce non-finite corner geometry', () => {
  const shape = createStairRoute('route', route, 80)
  const closeWall: LineShape = { ...wall, start: { x: 120, y: 0 }, end: { x: 120, y: 200 } }
  const geometry = stairShapeGeometry(shape, [closeWall])
  assert.ok(geometry.breakLine)
  for (const value of Object.values(geometry)) assert.doesNotMatch(value, /NaN|Infinity/)
})

test('the full-stair visibility option is editable and persists, and document export uses the same wall cut as the editor', () => {
  const shape = createStairRoute('route', route, 80)
  assert.equal(createNativeSelectionChangedPayload(shape, 1).shape?.stairClipAtWalls, true)
  const updated = updateSelectionProperties([shape], { stairClipAtWalls: false }, {
    selectedIds: new Set([shape.id]), selectedId: shape.id, groupedSelection: false
  })![0] as RectShape
  assert.deepEqual(visibleStairRoute(updated, [wall]).points, route)
  const [saved] = sanitizeShapes(JSON.parse(JSON.stringify([updated])))
  assert.equal((saved as RectShape).stairClipAtWalls, false)
  const exported = buildSvgDocument({ shapes: [shape, wall], selectedShape: null, paper: PAPER_PRESETS['a4-landscape'],
    worldWidth: 2376, worldHeight: 1680 })
  const geometry = stairShapeGeometry(shape, [wall])
  for (const value of Object.values(geometry)) assert.ok(exported.includes(`d="${value}"`))
  assert.ok(shapeMarkup(shape, false, '', undefined, false, [], [wall]).includes('class="stairs-break"'))
})
