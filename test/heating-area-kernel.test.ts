import assert from 'node:assert/strict'
import test from 'node:test'
import { partitionHeatingArea } from '../src/editor/heating-area-kernel.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('a thin threshold remnant does not prevent splitting the usable floor into connected R80 circuits', () => {
  const vertices = [[278.4, 14.4], [352, 14.4], [352, 134.4], [377.6, 134.4], [377.6, 419.2],
    [33.6, 419.2], [33.6, 262.4], [278.4, 262.4], [278.4, 17.6], [169.6, 17.6], [169.6, 12.8],
    [3.2, 12.8], [3.2, 17.6], [0, 17.6], [0, 0], [278.4, 0]]
  const settings = { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 100 } }
  const result = partitionHeatingArea({ boundaries: [vertices.map(([x, y]) => ({ x, y }))], entry: { x: 0, y: 20 } }, 2, settings, 100)!
  assert.ok(result)
  assert.equal(result.loops.length, 2)
  assert.ok(result.loops.every((loop) => loop.gapRatio < .02 && loop.lengthM < 100))
  const pipes = result.loops.map((loop, i) => createHeatingPipe(`part-${i}`, loop.points,
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: `VV${i}`, pipeRole: 'loop' }))
  for (const pipe of pipes) {
    const geometry = heatingPipeGeometry(pipe)
    assert.equal((geometry.path.match(/M /g) ?? []).length, 1)
    assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  }
  assert.equal(checkHeatingPlan(pipes, [], settings.design).errors, 0)
})
