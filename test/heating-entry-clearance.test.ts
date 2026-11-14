import assert from 'node:assert/strict'
import test from 'node:test'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingEntryTangentConflict, retractHeatingFeedEntries } from '../src/editor/heating-clearance.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'

test('a collision-free joined tube can still block its own R80 inlet', () => {
  const points = [[20, 20], [120, 20], [120, 120], [40, 120], [40, 60], [14, 60], [14, -40], [160, -40], [160, -20]]
    .map(([x, y]) => ({ x, y }))
  const pipe = createHeatingPipe('joined', points, { ...heatingDefaults('pipe', 100), automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
  assert.equal(checkHeatingPlan([pipe], []).errors, 0, 'the existing tube itself does not cross')
  const conflict = heatingEntryTangentConflict(pipe)
  assert.ok(conflict, 'the proposed supply would hit the connector beside its own inlet')
  assert.ok(conflict.x < 20 && Math.abs(conflict.y - 20) < 1e-6)
})

test('free paired inlets remain usable and other reserved transit tubes are respected', () => {
  const points = [[20, 20], [120, 20], [120, 120], [20, 120], [20, 100], [100, 100], [100, 40], [20, 40]].map(([x, y]) => ({ x, y }))
  const settings = { ...heatingDefaults('pipe', 100), automatic: true, circuitId: 'VV01', pipeRole: 'loop' as const }
  const pipe = createHeatingPipe('loop', points, settings)
  assert.equal(heatingEntryTangentConflict(pipe), undefined)
  const transit = createHeatingPipe('transit', [{ x: 14, y: 0 }, { x: 14, y: 60 }], { ...settings, circuitId: 'VV02' })
  assert.ok(heatingEntryTangentConflict(pipe, [transit]))
})

test('opening a paired inlet retracts only the tips and preserves all laying runs and R80 bends', () => {
  const points = [[20, 20], [120, 20], [120, 120], [20, 120], [20, 104], [104, 104], [104, 28], [20, 28]]
    .map(([x, y]) => ({ x, y }))
  const original = structuredClone(points), opened = retractHeatingFeedEntries(points, 16, 100, 100, 80)
  assert.ok((opened[0].x - points[0].x) * 100 / 8 >= 80, 'a long straight tip leaves at least an R80 turning window')
  assert.equal(opened[0].x, opened.at(-1)!.x)
  assert.equal(opened[0].y, 20)
  assert.equal(opened.at(-1)!.y, 28)
  assert.deepEqual(opened.slice(1, -1), points.slice(1, -1))
  assert.deepEqual(points, original)
  const pipe = createHeatingPipe('open-inlet', opened, { ...heatingDefaults('pipe', 100), automatic: true, pipeRole: 'loop' })
  assert.ok(heatingPipeGeometry(pipe).bends.every((b) => b.radiusMm >= 79.9))
  assert.equal(checkHeatingPlan([pipe], []).errors, 0)
})
