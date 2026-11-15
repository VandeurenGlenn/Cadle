import assert from 'node:assert/strict'
import test from 'node:test'
import { bringHeatingSourceEndInside } from '../src/editor/heating-source-ends.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

const data = { ...heatingPipeData(100), diameterMm: 16, circuitId: 'VV01', automatic: true }
const points = [{ x: 0, y: -1 }, { x: 0, y: -40 }, { x: 40, y: -40 }]

test('a doorway tip extends into the source room with no new bend and its exact added metres', () => {
  const before = createHeatingPipe('feed', points, data), result = bringHeatingSourceEndInside(points, 16, 100,
    { inside: (p) => p.y >= 0, valid: () => true, checkpoint() {} })!
  assert.ok(result)
  assert.deepEqual(result.slice(1), points.slice(1))
  assert.ok(result[0].y > 0)
  const after = createHeatingPipe('feed', result, data), a = heatingPipeGeometry(after), b = heatingPipeGeometry(before)
  assert.ok(Math.abs((a.length - b.length) / 80 - .016) < 1e-10)
  assert.deepEqual(a.bends.map((bend) => bend.radiusMm), b.bends.map((bend) => bend.radiusMm))
  assert.deepEqual(points[0], { x: 0, y: -1 }, 'the saved route is not mutated')
})

test('a threshold extension never crosses an already valid neighbouring feed', () => {
  const fixed = createHeatingPipe('fixed', [{ x: -20, y: .5 }, { x: 20, y: .5 }], { ...data, circuitId: 'VV02' })
  assert.equal(checkHeatingPlan([createHeatingPipe('feed', points, data), fixed], []).errors, 0)
  const result = bringHeatingSourceEndInside(points, 16, 100, { inside: (p) => p.y >= 0, checkpoint() {},
    valid: (vertices) => !checkHeatingPlan([createHeatingPipe('feed', vertices, data), fixed], []).errors })
  assert.equal(result, null)
})
