import assert from 'node:assert/strict'
import test from 'node:test'
import { clearHeatingConcaveTurns } from '../src/editor/heating-pattern-geometry.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('concave floor corners retain R80 and exact inlet ends using tangent lane changes', () => {
  const points = [{ x: -40, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 40 }]
  const inside = (p: { x: number; y: number }) => p.x >= -1e-6 || p.y <= 1e-6
  const repaired = clearHeatingConcaveTurns(points, 6.4, inside)
  assert.ok(repaired)
  assert.deepEqual(repaired[0], points[0])
  assert.deepEqual(repaired.at(-1), points.at(-1))
  const pipe = createHeatingPipe('concave', repaired, {
    ...heatingPipeData(100), diameterMm: 16, spacingMm: 100, automatic: true, circuitId: 'VV01', pipeRole: 'loop'
  })
  const geometry = heatingPipeGeometry(pipe)
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(geometry.pieces.every(({ a, b }) => inside(a) && inside(b)), 'all rendered curves stay outside the excluded quadrant')
  assert.equal(checkHeatingPlan([pipe], []).errors, 0)
  assert.equal(clearHeatingConcaveTurns(points, 6.4, () => true), null)
  assert.equal(clearHeatingConcaveTurns([{ x: -4, y: 0 }, ...points.slice(1)], 6.4, inside), null,
    'insufficient tangent space must not create a reduced-radius substitute')
})
