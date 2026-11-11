import test from 'node:test'
import assert from 'node:assert/strict'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { heatingAnchors, heatingMarkup, sanitizeHeating, heatingSchedule } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import type { Shape } from '../src/editor/model/types.ts'

const area = { x: 80, y: 80, width: 2216, height: 1384 }

test('two rooms get complete circuits through their partitions without an internal door', () => {
  const scene: Shape[] = []
  for (const [i, [x, y]] of [[400, 400], [600, 400], [400, 600]].entries()) {
    const corners = [{ x, y }, { x: x + 200, y }, { x: x + 200, y: y + 200 }, { x, y: y + 200 }]
    scene.push(...corners.map((start, j): Shape => ({ id: `wall-${i}-${j}`, kind: 'wall', start, end: corners[(j + 1) % 4] })))
    scene.push(i === 2 ? { id: `door-${i}`, kind: 'door', start: { x, y: y + 80 }, end: { x, y: y + 140 } }
      : { id: `door-${i}`, kind: 'door', start: { x: x + 80, y }, end: { x: x + 140, y } })
  }
  let id = 0
  const result = generateAutomaticHeatingPlan(scene, { x: 480, y: 500 },
    { connectionMode: 'zone', diameterMm: 16, spacingMm: 100, capacity: 2, heatSourceRoom: false }, 100, () => `wall-fed-${id++}`, area)
  const owner = result.shapes.find((shape) => shape.heating?.kind === 'manifold')!
  assert.equal(result.rows.length, 2)
  assert.equal(new Set(result.rows.map((row) => row.roomKey)).size, 2)
  assert.equal(owner.heating!.audit!.errors, 0)
  assert.ok(owner.heating!.audit!.issues.some((issue) => issue.code === 'penetration'))
  assert.ok(result.wallCrossings >= 2)
  for (const row of result.rows) {
    assert.ok(row.cutM! <= 100.05)
    const pipes = result.shapes.filter((shape) => shape.heating?.kind === 'pipe' && shape.heating.circuitId === row.id)
    assert.deepEqual(pipes.map((pipe) => pipe.heating!.pipeRole).sort(), ['loop', 'return', 'supply'])
    assert.ok(pipes.every((pipe) => heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9)))
  }
})

test('open tails need no manifold ports while retaining real continuity, lengths and R80 bends', () => {
  const corners = [{ x: 400, y: 400 }, { x: 640, y: 400 }, { x: 640, y: 640 }, { x: 400, y: 640 }]
  const scene: Shape[] = corners.map((start, i) => ({ id: `wall-${i}`, kind: 'wall', start, end: corners[(i + 1) % 4] }))
  scene.push({ id: 'door', kind: 'door', start: { x: 480, y: 400 }, end: { x: 560, y: 400 } })
  let id = 0
  const result = generateAutomaticHeatingPlan(scene, { x: 180, y: 280 }, { connectionMode: 'zone', diameterMm: 16, spacingMm: 100, capacity: 12 }, 100, () => `zone-${id++}`, area)
  const owner = result.shapes.find((s) => s.heating?.kind === 'manifold')!
  assert.equal(owner.heating!.audit!.errors, 0)
  assert.ok(owner.heating!.audit!.issues.some((i) => i.code === 'open-connections'))
  assert.equal(owner.heating!.points, undefined)
  assert.deepEqual(heatingAnchors(owner), [])
  const markup = heatingMarkup(owner)
  assert.match(markup, /heating-connection-position/)
  assert.doesNotMatch(markup, /<rect/)
  assert.equal(sanitizeHeating(JSON.parse(JSON.stringify(owner.heating)))!.connectionMode, 'zone')
  assert.ok(result.shapes.filter((s) => s.heating?.kind === 'table').every((s) => heatingMarkup(s).includes('Verdeleraansluitingen ontbreken nog')))
  assert.ok(result.rows.every((r) => r.supplyM > 0 && r.returnM > 0 && r.cutM! <= 100.05))
  for (const shape of result.shapes.filter((s) => s.heating?.kind === 'pipe')) assert.ok(heatingPipeGeometry(shape).bends.every((b) => b.radiusMm >= 79.9))
  const broken = structuredClone(result.shapes)
  const supply = broken.find((s) => s.heating?.pipeRole === 'supply')!
  supply.start.x -= 200
  const audit = checkHeatingPlan([...scene, ...broken], heatingSchedule(broken))
  assert.ok(audit.issues.some((i) => i.code === 'continuity'), 'a zone must not disable actual continuity validation')
})
