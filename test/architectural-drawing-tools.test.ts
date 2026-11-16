import assert from 'node:assert/strict'
import test from 'node:test'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import { cloneShape, sanitizeShapes, scaleShape, slidingDoorGeometry, slidingWindowGeometry } from '../src/editor/model/model.ts'
import type { LineShape, RectShape } from '../src/editor/model/types.ts'
import { createDraftShape } from '../src/editor/interaction/pointer-down-builders.ts'

const slidingDoor: LineShape = {
  id: 'sliding-door',
  kind: 'door',
  doorStyle: 'sliding',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 }
}

test('renders a sliding panel, track and direction without a swing arc', () => {
  const markup = shapeMarkup(slidingDoor, false)

  assert.match(markup, /shape-sliding-door-track/)
  assert.match(markup, /shape-door-leaf/)
  assert.match(markup, /shape-sliding-door-arrow/)
  assert.doesNotMatch(markup, /shape-door-arc|shape-door-hinge/)
  assert.match(markup, /shape-sliding-door-panel/)
  assert.match(markup, /d="M 0 9 L 100 9 L 100 15 L 0 15 Z"/)
  assert.match(markup, /shape-sliding-door-jamb/)
  const geometry = slidingDoorGeometry(slidingDoor)
  assert.equal(geometry.arrowTip.x - geometry.arrowStart.x, 60)
  assert.equal(geometry.arrowStart.y, -14)
})

test('persists and transforms the sliding style and mirrors its panel side', () => {
  const [saved] = sanitizeShapes([JSON.parse(JSON.stringify(slidingDoor))])
  assert.deepEqual(cloneShape(saved), slidingDoor)
  assert.deepEqual(scaleShape(saved, 2, 2), {
    ...slidingDoor,
    start: { x: 0, y: 0 },
    end: { x: 200, y: 0 }
  })

  const geometry = slidingDoorGeometry({ ...slidingDoor, flipSide: true })
  assert.equal(geometry.leafStart.y, -12)
})

test('renders overlapping window sashes with a clear slide-direction arrow away from the glass', () => {
  const window: LineShape = {
    id: 'sliding-window',
    kind: 'window',
    windowStyle: 'sliding',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  }
  const markup = shapeMarkup(window, false)
  const geometry = slidingWindowGeometry(window)

  assert.match(markup, /shape-sliding-window-track/)
  assert.match(markup, /shape-sliding-window-panel/)
  assert.match(markup, /shape-sliding-window-arrow/)
  assert.equal(geometry.upperStart.y, 4)
  assert.equal(geometry.lowerStart.y, -4)
  assert.ok(geometry.upperEnd.x > geometry.lowerStart.x, 'the two sashes overlap')
  assert.equal(geometry.arrowTip.x - geometry.arrowStart.x, 60)
  assert.equal(geometry.arrowStart.y, -18)
  assert.equal((markup.match(/shape-sliding-window-glass/g) ?? []).length, 2)
  assert.deepEqual(cloneShape(sanitizeShapes([JSON.parse(JSON.stringify(window))])[0]), window)
})

test('draws and preserves built-in cabinet footprints', () => {
  const draft = createDraftShape('cabinet', { x: 10, y: 20 }, 'built-in-cabinet')
  assert.equal(draft.kind, 'rect')
  if (draft.kind !== 'rect') return
  assert.equal(draft.variant, 'built-in-cabinet')

  const cabinet: RectShape = { ...draft, end: { x: 110, y: 70 } }
  const markup = shapeMarkup(cabinet, false)
  assert.match(markup, /shape-built-in-cabinet-inset/)
  assert.match(markup, /shape-built-in-cabinet-divider/)
  assert.equal(sanitizeShapes([JSON.parse(JSON.stringify(cabinet))])[0].kind, 'rect')
})
