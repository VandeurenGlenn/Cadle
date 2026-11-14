import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { partitionHeatingArea, rectangularHeatingArea, heatingAreaComponents } from '../src/editor/heating-area-kernel.ts'
import { createHeatingPipe, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

test('a U-shaped room can split into two wings and a connecting strip instead of one trapped L-shaped circuit', () => {
  const area = { entry: { x: 0, y: 0 }, boundaries: [[[0, 0], [160, 0], [160, 240], [320, 240],
    [320, 0], [480, 0], [480, 320], [0, 320]].map(([x, y]) => ({ x, y }))] }
  const settings = { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 100 } }
  const signatures = new Set<string>()
  for (const variant of [0, 1]) {
    const result = partitionHeatingArea(area, 3, settings, 100, { axis: 'y', variant })
    assert.ok(result, 'two disconnected wings may share an intermediate allocation of two circuits')
    assert.equal(result.loops.length, 3)
    assert.ok(result.areas.every((area) => heatingAreaComponents(area).length === 1), 'every final circuit still has one connected field')
    assert.ok(result.loops.every((loop) => loop.gapRatio <= .02 && loop.lengthM <= 100))
    const pipes = result.loops.map((loop, i) => createHeatingPipe(`wing-${i}`, loop.points,
      { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: `U${i}`, pipeRole: 'loop' }))
    assert.equal(checkHeatingPlan(pipes, [], settings.design).errors, 0)
    assert.ok(pipes.every((pipe) => heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9)))
    signatures.add(JSON.stringify(result.areas.map((area) => area.boundaries)))
  }
  assert.equal(signatures.size, 2, 'a blocked layout can choose another real division of the floor')
})

test('automatic partitioning rejects incomplete spirals in an asymmetric U-shaped room', () => {
  const rings = [[[1.6,86.4],[1.6,78.4],[0,78.4],[0,59.2],[1.6,59.2],[1.6,57.6],[0,57.6],[0,0],
    [336,0],[336,278.4],[337.6,278.4],[337.6,280],[398.4,280],[398.4,278.4],[400,278.4],[400,56],
    [632,56],[632,352],[0,352],[0,86.4]], [[630,57],[406,57],[406,105],[630,105]]]
  const area = { boundaries: rings.map((ring) => ring.map(([x, y]) => ({ x, y }))), entry: { x: -4, y: 52 } }
  const settings = { diameterMm: 16, spacingMm: 100, edgeMm: 218, design: { maxCircuitLengthM: 120 } }
  const result = partitionHeatingArea(area, 3, settings, 100, {
    leadM: (p) => (Math.abs(p.x + 480) + Math.abs(p.y - 4)) / 80 })
  assert.ok(result)
  assert.equal(result.loops.length, 3)
  assert.ok(result.loops.every((loop) => loop.gapRatio <= .02), 'an apparently simple spiral may not leave a wing unheated')
  assert.ok(result.areas.every((area) => heatingAreaComponents(area).length === 1))
  assert.ok(result.maxM <= 120)
  assert.equal(checkHeatingPlan(result.loops.map((loop, i) => createHeatingPipe(`asymmetric-${i}`, loop.points,
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: `U${i}`, pipeRole: 'loop' })), [], settings.design).errors, 0)
})

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

test('circuit entrances follow the real access cost around obstacles and can use the short side of a tall field', () => {
  const area = rectangularHeatingArea({ x: 0, y: 0, width: 120, height: 240 })
  const settings = { diameterMm: 16, spacingMm: 100 }
  const west = partitionHeatingArea(area, 1, settings, 100, { leadM: (p) => Math.max(0, p.x) / 10 })!
  assert.ok(west)
  const p = west.loops[0].points
  assert.ok(Math.abs(p[0].y - p[1].y) < 1e-6, 'a tall field can enter horizontally from the west')
  assert.ok(Math.abs(p.at(-1)!.y - p.at(-2)!.y) < 1e-6)
  const south = partitionHeatingArea(area, 1, settings, 100, { leadM: (p) => Math.abs(p.y - 232) / 10 })!
  assert.ok(south.loops[0].points[0].y > 200 && south.loops[0].points.at(-1)!.y > 200,
    'a partition reached from below does not put its entrances behind the obstacle at the north')
})

test('an inaccessible field can choose a different paired entrance while retaining R80 geometry', () => {
  const area = rectangularHeatingArea({ x: 0, y: 0, width: 160, height: 240 }, { x: 0, y: 0 })
  const entrances = new Set<string>()
  for (const entryVariant of [0, 1, 2]) {
    const result = partitionHeatingArea(area, 1, { diameterMm: 16, spacingMm: 100, entryVariant }, 100)!
    assert.ok(result)
    const loop = result.loops[0]
    const pipe = createHeatingPipe(`entrance-${entryVariant}`, loop.points,
      { ...heatingDefaults('pipe', 100), automatic: true, circuitId: 'VV01', pipeRole: 'loop' })
    const geometry = heatingPipeGeometry(pipe)
    assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
    entrances.add(JSON.stringify([loop.points[0], loop.points.at(-1)!]
      .map((point) => [point.x, point.y]).sort((a, b) => a[0] - b[0] || a[1] - b[1])))
  }
  assert.equal(entrances.size, 3, 'swapping supply and return is not a different physical entrance')
})

test('a small room can face its actual door while lead lengths still follow the complete approach', () => {
  const area = rectangularHeatingArea({ x: 944, y: 548, width: 152, height: 72 }, { x: 1096, y: 580 })
  const result = partitionHeatingArea(area, 1, { diameterMm: 16, spacingMm: 100, edgeMm: 198 }, 100,
    { entryPoint: area.entry, leadM: (p) => (Math.abs(p.x - 744) + Math.abs(p.y - 592)) / 80 })!
  assert.ok(result)
  const p = result.loops[0].points
  assert.ok(p[1].x < p[0].x && Math.abs(p[1].y - p[0].y) < 1e-6, 'supply enters directly from the east-facing door')
  assert.ok(p.at(-2)!.x < p.at(-1)!.x && Math.abs(p.at(-2)!.y - p.at(-1)!.y) < 1e-6)
  assert.ok(result.maxM > result.loops[0].lengthM + 5, 'the door hint does not remove the source-to-room metres')
})

test('measured long approaches redistribute the same room into three complete circuits within 120 m', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-measured-lead-partition.json', import.meta.url), 'utf8'))
  const leadM = (p) => {
    const nearest = [...fixture.samples].sort((a, b) => Math.hypot(p.x - a.point.x, p.y - a.point.y) -
      Math.hypot(p.x - b.point.x, p.y - b.point.y))[0]
    return Math.max(nearest.leadM, (Math.abs(p.x - fixture.source.x) + Math.abs(p.y - fixture.source.y)) / 80)
  }
  const settings = { diameterMm: 16, spacingMm: 100, edgeMm: 218, design: { maxCircuitLengthM: 120 } }
  const result = partitionHeatingArea({ ...fixture.area, entry: { x: 1220, y: 520 } }, 3, settings, 100, { leadM, variant: 1 })!
  assert.ok(result)
  assert.equal(result.loops.length, 3, 'routing detours do not silently add another circuit')
  assert.ok(result.maxM <= 120)
  assert.ok(result.loops.every((loop) => loop.gapRatio <= .02))
  assert.equal(checkHeatingPlan(result.loops.map((loop, i) => createHeatingPipe(`measured-${i}`, loop.points,
    { ...heatingDefaults('pipe', 100), ...settings, automatic: true, circuitId: `M${i}`, pipeRole: 'loop' })), [], settings.design).errors, 0)
})
