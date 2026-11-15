import assert from 'node:assert/strict'
import test from 'node:test'
import type { Point } from '../src/editor/model/types.ts'
import { refineHeatingConnectionBundle, type HeatingConnectionRefinementState } from '../src/editor/heating-connection-refinement.ts'
import { heatingMeasuredLeadEstimate, mergeHeatingMeasuredLeads } from '../src/editor/heating-area-fields.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingSchedule } from '../src/editor/heating-plan.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import type { HeatingGrid } from '../src/editor/heating-routing.ts'

const physicalPairs = () => {
  const width = 701, height = 321, step = 1.6, size = width * height
  const grid: HeatingGrid = { drawingScale: 100, origin: { x: 0, y: 0 }, width, height, step,
    wall: new Uint8Array(size), door: new Uint8Array(size), obstacle: new Uint8Array(size), loopObstacle: new Uint8Array(size),
    room: new Int32Array(size).fill(1), rooms: [],
    point: (cell) => ({ x: cell % width * step, y: Math.floor(cell / width) * step }),
    index: (p) => Math.round(p.y / step) * width + Math.round(p.x / step) }
  const settings = { diameterMm: 16, spacingMm: 100, design: { maxCircuitLengthM: 20, allowanceM: 2 } }
  const data = { ...heatingPipeData(100), ...settings, automatic: true }
  const coils = [
    [[400, 80], [960, 80], [960, 240], [400, 240], [400, 224], [944, 224], [944, 88], [400, 88]],
    [[400, 320], [560, 320], [560, 480], [400, 480], [400, 464], [544, 464], [544, 328], [400, 328]]
  ].map((vertices, i) => createHeatingPipe(`body-${i}`, vertices.map(([x, y]) => ({ x, y })),
    { ...data, pipeRole: 'loop', circuitId: `VV0${i + 1}` }))
  const points = [80, 88, 320, 328].map((y) => [{ x: 100, y }, { x: 400, y }])
  const paths = points.map((vertices) => vertices.map(grid.index))
  const stubs = paths.map((path) => [path[0], path[0] + 1]), targets = paths.map((path) => [path.at(-1)!])
  const flows = paths.map((cells, source) => ({ cells, source }))
  const state: HeatingConnectionRefinementState = { warmPairs: coils.map((coil, i) => ({
    coilKey: JSON.stringify(heatingPipeGeometry(coil).points), points: points.slice(i * 2, i * 2 + 2), bendRadiusMm: [80, 80] })) }
  const options = { fineGrid: true, state, sourcePosition: { x: 100, y: 200 }, sourceRadiusMm: 3000,
    permittedWallCells: new Set<number>(), checkpoint() {
      assert.equal(state.routeAttempts ?? 0, 0, 'proved warm pairs must be measured before searching another root')
    } }
  return { grid, settings, coils, flows, stubs, targets, state, options }
}

test('an independently proved overlong pair reports actual supply and return before the next root or global search', () => {
  const f = physicalPairs(), reports: number[] = []
  const result = refineHeatingConnectionBundle(f.grid, f.flows, f.stubs, f.targets, f.coils, f.settings, 100,
    { ...f.options, onPreparedPair(circle, feeds) {
      reports.push(circle)
      assert.deepEqual(feeds.map((pipe) => pipe.heating!.pipeRole), ['supply', 'return'])
      assert.equal(checkHeatingPlan([...f.coils, ...feeds], [], f.settings.design).errors, 0,
        'the feedback comes from real collision-free R80 curves')
      const row = heatingSchedule([f.coils[circle], ...feeds])[0]
      assert.ok(Math.abs(row.supplyM - 3.75) < 1e-6)
      assert.ok(Math.abs(row.returnM - 3.75) < 1e-6)
      assert.equal(row.cutM, row.totalM + 2, 'the measured decision includes the configured reserve')
      assert.ok(row.cutM! > 20.05)
      return false
    } })
  assert.deepEqual(reports, [0])
  assert.equal(f.state.priority!.rootDone, 0)
  assert.equal(f.state.priority!.solution, undefined)
  assert.equal(result.refined.length, 0, 'an overlong independent pair is not a complete accepted plan')
  assert.deepEqual(result.failures.map((failure) => failure.reason), ['measured-length', 'measured-length'])
})

test('a callback pause re-audits its hint and reports the same pair again instead of skipping it', () => {
  const f = physicalPairs(), pause = new Error('pause while reporting measured leads')
  const run = (callback: (circle: number) => boolean) => refineHeatingConnectionBundle(f.grid, f.flows,
    f.stubs, f.targets, f.coils, f.settings, 100, { ...f.options, onPreparedPair: callback })
  assert.throws(() => run((circle) => { assert.equal(circle, 0); throw pause }), (error) => error === pause)
  assert.equal(f.state.priority!.rootDone, 0)
  assert.ok(f.state.warmPairs!.some((pair) => pair.coilKey === JSON.stringify(heatingPipeGeometry(f.coils[0]).points)))
  const reports: number[] = []
  const resumed = run((circle) => { reports.push(circle); return false })
  assert.deepEqual(reports, [0])
  assert.equal(resumed.refined.length, 0)
  assert.equal(resumed.failures[0].reason, 'measured-length')
})

test('absent feedback preserves physical refinement and a completed checkpoint still reports its lengths when requested', () => {
  const f = physicalPairs()
  const result = refineHeatingConnectionBundle(f.grid, f.flows, f.stubs, f.targets, f.coils, f.settings, 100, f.options)
  assert.equal(result.refined.length, 4, JSON.stringify(result.failures))
  assert.equal(f.state.priority!.rootDone, 2)
  assert.ok(f.state.priority!.solution)
  const reports: number[] = []
  const rejected = refineHeatingConnectionBundle(f.grid, f.flows, f.stubs, f.targets, f.coils, f.settings, 100,
    { ...f.options, onPreparedPair(circle) { reports.push(circle); return false } })
  assert.deepEqual(reports, [0])
  assert.equal(rejected.refined.length, 0)
  assert.equal(f.state.priority!.rootDone, 0)
  assert.equal(f.state.priority!.solution, undefined)
})

test('partial measured leads update only nearby inlets and keep other rooms and approaches bounded', () => {
  const previous = [
    { roomId: 1, point: { x: 0, y: 0 }, leadM: 14 },
    { roomId: 1, point: { x: 240, y: 0 }, leadM: 11 },
    { roomId: 2, point: { x: 0, y: 0 }, leadM: 7 }
  ]
  const updated = { roomId: 1, point: { x: 4, y: 0 }, leadM: 13.5 }
  const merged = mergeHeatingMeasuredLeads(previous, [updated], 100)
  assert.deepEqual(merged, [previous[1], previous[2], updated])
  assert.equal(previous.length, 3, 'earlier immutable measurements are preserved')
  const many = Array.from({ length: 130 }, (_, i) => ({ roomId: 1, point: { x: i * 16, y: 0 }, leadM: i }))
  const bounded = mergeHeatingMeasuredLeads([], many, 100)
  assert.equal(bounded.length, 128)
  assert.deepEqual(bounded[0], many[2])
})

test('one measured far approach leaves larger near-field body budgets while retaining the original distance floor', () => {
  const samples = [{ roomId: 1, point: { x: 0, y: 0 }, leadM: 14 }]
  const at = (point: Point, baseline = 2, room = 1) => heatingMeasuredLeadEstimate(point, room, baseline, samples, 100)
  const leads = [0, 240, 480].map((x) => at({ x, y: 0 }))
  assert.deepEqual(leads, [14, 11, 8])
  assert.deepEqual(leads.map((lead) => 120 - 2 * lead), [92, 98, 104],
    'a partial far-field measurement does not impose its whole detour on every body')
  assert.equal(at({ x: 480, y: 0 }, 10), 10, 'the native distance estimate is never reduced')
  assert.equal(at({ x: 0, y: 0 }, 2, 2), 2, 'a different room cannot inherit that detour')
  assert.equal(at({ x: 1600, y: 0 }), 2, 'extrapolation cannot create a negative lead')
})
