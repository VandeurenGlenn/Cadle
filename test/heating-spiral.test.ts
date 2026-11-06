import assert from 'node:assert/strict'
import test from 'node:test'
import { rectangularHeatingSpiral, openHeatingTurns } from '../src/editor/heating-spiral.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('double spirals wind inward and outward with R80 throughout, including the 100 mm centre return', () => {
  for (const scale of [50, 100] as const) for (const [width, height] of [[240, 240], [400, 320], [56, 56], [32, 80]]) {
    const factor = 100 / scale, settings = { diameterMm: 16, spacingMm: 100 }
    const raw = rectangularHeatingSpiral(width * factor, height * factor, settings, scale)!
    assert.ok(raw, `${width} × ${height} must have a valid spiral`)
    const turns = raw.slice(1, -1).map((p, i) => (p.x - raw[i].x) * (raw[i + 2].y - p.y) - (p.y - raw[i].y) * (raw[i + 2].x - p.x)).filter((turn) => Math.abs(turn) > 1e-6)
    assert.ok(turns.some((turn) => turn > 0))
    assert.ok(turns.some((turn) => turn < 0), 'the second arm must wind back out, not form a meander')
    assert.ok(turns.filter((turn, i) => i && turn * turns[i - 1] < 0).length <= 2)
    const shape = createHeatingPipe('spiral', openHeatingTurns(raw, 6.4 * factor, 1.28 * factor), {
      ...heatingDefaults('pipe', scale), ...settings, automatic: true, pattern: 'spiral', circuitId: 'VV01', pipeRole: 'loop'
    })
    const geometry = heatingPipeGeometry(shape)
    assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
    assert.equal(checkHeatingPlan([shape], []).errors, 0)
    assert.equal(Math.hypot(raw[0].x - raw.at(-1)!.x, raw[0].y - raw.at(-1)!.y), 8 * factor)
  }
})

test('rejects space that cannot contain a spiral and honours interruption inside contour construction', () => {
  assert.equal(rectangularHeatingSpiral(4, 4, { diameterMm: 16, spacingMm: 100 }, 100), null)
  const cancelled = new Error('stop spiral')
  let calls = 0
  assert.throws(() => rectangularHeatingSpiral(400, 320, { diameterMm: 16, spacingMm: 100 }, 100,
    () => { if (++calls === 3) throw cancelled }), (error) => error === cancelled)
})
