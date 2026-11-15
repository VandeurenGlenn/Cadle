import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { exactHeatingSpliceCandidates } from '../src/editor/heating-paired-splice.ts'
import { rectangularHeatingSpiral, openHeatingTurns } from '../src/editor/heating-pattern-geometry.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { joinHeatingZoneFields } from '../src/editor/heating-zone-join.ts'

test('facing fractional fields join without moving retained R80 bends or feed ends', () => {
  const settings = { diameterMm: 16, spacingMm: 100, design: { minBendRadiusMm: 80 } }
  const raw = rectangularHeatingSpiral(160, 240, settings, 100)!
  assert.ok(raw)
  const a = raw.map((p) => ({ x: p.x + .37, y: p.y + .29 }))
  const b = raw.map((p) => ({ x: p.x + 168.73, y: p.y + .83 }))
  const pipe = (p: typeof a) => createHeatingPipe('joined', openHeatingTurns(p, 6.4, 1.28),
    { ...heatingPipeData(100), ...settings, automatic: true, circuitId: 'J', pipeRole: 'loop' })
  const proposals = [...exactHeatingSpliceCandidates(a, b, 8, 6.4)]
  const accepted = proposals.find((p) => !checkHeatingPlan([pipe(p)], [], settings.design).errors)
  assert.ok(accepted, 'a continuous physical splice exists between the differently phased fields')
  assert.deepEqual(accepted[0], a[0])
  assert.deepEqual(accepted.at(-1), a.at(-1))
  const geometry = heatingPipeGeometry(pipe(accepted))
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  assert.ok(accepted.some((p) => p.x === b[0].x || p.y === b[0].y), 'the inserted field retains its own exact coordinates')
})

test('three fractional pockets retain real R80 turns through successive merges', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-fractional-pocket-fields.json', import.meta.url), 'utf8'))
  const settings = { diameterMm: 16, spacingMm: 100, design: { minBendRadiusMm: 80 } }
  const prepare = (points: Parameters<typeof openHeatingTurns>[0]) => openHeatingTurns(points, 6.4, 1.28)
  const make = (points: Parameters<typeof prepare>[0], id: string) => createHeatingPipe(id, prepare(points),
    { ...heatingPipeData(100), ...settings, automatic: true, circuitId: id, pipeRole: 'loop' })
  const result = joinHeatingZoneFields(fixture.fields, fixture.bounds, [], 8, 6.4,
    (points, remaining) => !checkHeatingPlan([make(points, 'joined'), ...remaining.map((p, i) => make(p, `remaining-${i}`))],
      [], settings.design, [], { stopOnConflict: true }).errors, () => 'spiral', { prepare, timeMs: 2000, auditLimit: 512 })
  assert.ok(result, 'all three pockets form one continuous physically valid tube')
  assert.ok(heatingPipeGeometry(make(result.points, 'result')).bends.every((bend) => bend.radiusMm >= 79.9))
})
