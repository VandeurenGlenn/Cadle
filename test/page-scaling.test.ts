import assert from 'node:assert/strict'
import test from 'node:test'
import { fitLegacyGroundPlanToPrintArea } from '../src/editor/layout/page-scaling.js'
import type { Shape } from '../src/editor/model/types.js'

const legacyPlan = (): Shape[] => Array.from({ length: 10 }, (_, index) => ({
  id: `wall-${index}`,
  kind: 'wall' as const,
  start: { x: 700 + index * 60, y: 300 },
  end: { x: 700 + index * 60, y: 1300 }
}))

test('enlarges and centers a legacy ground plan inside the printable area', () => {
  const result = fitLegacyGroundPlanToPrintArea(legacyPlan(), {
    width: 2376,
    height: 1680,
    widthMm: 297,
    heightMm: 210,
    marginMm: 10
  })

  assert.equal(result.changed, true)
  assert.ok(result.scale > 1.4 && result.scale < 1.6)
  const first = result.shapes[0]
  const last = result.shapes.at(-1)
  assert.equal(first.kind, 'wall')
  assert.equal(last?.kind, 'wall')
  assert.ok(first.start.x > 0)
  assert.ok((last?.end.x ?? 0) < 2376)
})

test('does not unexpectedly enlarge a small partial sketch', () => {
  const result = fitLegacyGroundPlanToPrintArea(legacyPlan().slice(0, 2), {
    width: 2376,
    height: 1680,
    widthMm: 297,
    heightMm: 210,
    marginMm: 10
  })

  assert.equal(result.changed, false)
  assert.equal(result.scale, 1)
})
