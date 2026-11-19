import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftShape } from '../src/editor/interaction/pointer-down-builders.ts'
import { updateDraftShapeEnd } from '../src/editor/interaction/pointer-move.ts'
import { canCommitDraft } from '../src/editor/interaction/pointer-up.ts'
import { cloneShape, sanitizeShapes, scaleShape, shapeBounds } from '../src/editor/model/model.ts'
import { stairGeometry } from '../src/editor/model/stair-geometry.ts'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'

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
    'M 10 320 L 10 20 L 250 20 L 250 320 L 170 320 L 170 100 L 90 100 L 90 320 Z')
  assert.ok(geometry.treads.includes('M 10 20 L 90 100'))
  assert.ok(geometry.treads.includes('M 250 20 L 170 100'))
  assert.ok(geometry.treads.includes('M 130 20 L 130 100'))
  assert.ok(geometry.arrow.startsWith('M 50 300 L 50 60 L 210 60 L 210 300'))
})

test('double-quarter-turn stairs retain an open centre in wide, shallow and tiny footprints', () => {
  for (const [width, height] of [[120, 600], [600, 120], [1, 1]]) {
    const geometry = stairGeometry({ x: 0, y: 0, width, height }, 'stairs-double-quarter-turn')
    for (const path of Object.values(geometry)) assert.doesNotMatch(path, /NaN|Infinity/)
    const flight = Math.min(width / 3, height * 0.4)
    assert.ok(width - 2 * flight > 0)
    assert.ok(geometry.outline.includes(`L ${width - flight} ${flight} L ${flight} ${flight}`))
  }
})
