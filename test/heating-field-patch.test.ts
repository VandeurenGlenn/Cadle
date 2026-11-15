import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Point, RectShape, Shape } from '../src/editor/model/types.ts'
import type { HeatingSpiralField } from '../src/editor/heating-spiral.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import { buildHeatingGrid, heatingCurveWallConflict } from '../src/editor/heating-routing.ts'
import { routeHeatingBundle } from '../src/editor/heating-bundle.ts'
import { refineHeatingConnectionBundle } from '../src/editor/heating-connection-refinement.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { createHeatingPipe, heatingPipeData } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingFieldEntryGuards } from '../src/editor/heating-field-entry-guards.ts'
import { joinHeatingFieldPatch } from '../src/editor/heating-field-patch.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-shared-doorway.json', import.meta.url), 'utf8'))
const scene = sanitizeShapes(fixture.scene) as Shape[], scale = 100, source = fixture.source
const settings = fixture.settings
const native = buildHeatingGrid(scene, scale, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
const obstacles = heatingObstacleBounds(scene, shapeBounds)
const pipe = (id: string, points: Point[]) => createHeatingPipe(id, points,
  { ...heatingPipeData(scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: id })
const raster = (points: readonly Point[]) => {
  const cells: number[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (native.step / 2)))
    for (let n = i === 1 ? 0 : 1; n <= count; n++) {
      const cell = native.index({ x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count })
      if (cell >= 0 && cells.at(-1) !== cell) cells.push(cell)
    }
  }
  return cells
}

test('an actual small-room splice keeps both R80 feeds reachable through its doorway', { timeout: 120_000 }, () => {
  const deadline = Date.now() + 110_000
  const checkpoint = () => assert.ok(Date.now() < deadline, 'the fixture must complete within its bounded routing budget')
  const host: HeatingSpiralField = { ...structuredClone(fixture.host), cells: raster(fixture.host.points) }
  const patch: HeatingSpiralField = { ...structuredClone(fixture.patch), cells: raster(fixture.patch.points) }
  const original = JSON.stringify([host, patch]), hostPipe = pipe('host', host.points!)
  const guards = heatingFieldEntryGuards(native, scene, hostPipe, [hostPipe, pipe('patch', patch.points!)], new Set([6]),
    source, settings, scale, { obstacles, checkpoint })
  assert.ok(guards?.length === 2)
  assert.equal(checkHeatingPlan([hostPipe, ...guards], [], settings.design, obstacles).errors, 0)
  const trapped = pipe('host', fixture.trapped)
  assert.equal(checkHeatingPlan([trapped], [], settings.design, obstacles).errors, 0, 'body geometry alone misses the closed mouth')
  assert.ok(checkHeatingPlan([trapped, ...guards], [], settings.design, obstacles).errors > 0,
    'the old connector crosses the actual reserved return escape')
  const jobs = [structuredClone(host)]
  const joined = joinHeatingFieldPatch(jobs, patch, native, scene, settings, scale, { source, feedPipes: [], checkpoint,
    obstacles, raster, completeM: (job) => heatingPipeGeometry(pipe('length', job.points!)).length * scale / 8000 })
  assert.equal(joined, true)
  let hitChecks = 0
  const hitOptions = { source, feedPipes: [], checkpoint: () => { hitChecks++ }, obstacles, raster,
    completeM: (job: HeatingSpiralField) => heatingPipeGeometry(pipe('length', job.points!)).length * scale / 8000 }
  const replay = [structuredClone(host)]
  assert.equal(joinHeatingFieldPatch(replay, patch, native, scene, settings, scale, hitOptions), true)
  assert.equal(hitChecks, 1, 'a completed join prefix resumes without repeating its route search')
  assert.deepEqual(replay, jobs)
  replay[0].points![0].x += 1
  const another = [structuredClone(host)]
  assert.equal(joinHeatingFieldPatch(another, patch, native, scene, settings, scale, hitOptions), true)
  assert.deepEqual(another, jobs, 'callers never mutate a cached result through returned arrays')
  const paused = new Error('cooperative pause')
  assert.throws(() => joinHeatingFieldPatch([structuredClone(host)], patch, native, scene, settings, scale,
    { ...hitOptions, checkpoint: () => { throw paused } }), (error) => error === paused)
  assert.equal(JSON.stringify([host, patch]), original, 'source fields are immutable')
  assert.equal(jobs.length, 1)
  const coil = pipe('host', jobs[0].points!), geometry = heatingPipeGeometry(coil)
  assert.deepEqual([geometry.points[0], geometry.points.at(-1)], [host.points![0], host.points!.at(-1)])
  assert.equal(checkHeatingPlan([coil, ...guards], [], settings.design, obstacles).errors, 0)
  assert.equal(heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() }), undefined)
  assert.ok(geometry.bends.every((bend) => bend.radiusMm >= 79.9))
  const paired = [geometry.points[0], geometry.points.at(-1)!].map((head, i) => {
    const next = i ? geometry.points.at(-2)! : geometry.points[1], length = Math.hypot(head.x - next.x, head.y - next.y)
    return [native.index(head), native.index({ x: head.x + (head.x - next.x) / length * native.step,
      y: head.y + (head.y - next.y) / length * native.step })]
  })
  const roots = fixture.sourceStubs as number[][]
  const permittedWallCells = new Set<number>(fixture.permittedWallCells)
  const flows = routeHeatingBundle(native, roots.map((stub) => stub[0]), paired.map((stub) => stub.at(-1)!), native.obstacle, { checkpoint, allowWalls: true, permittedWallCells })
  assert.ok(flows)
  const physical = refineHeatingConnectionBundle(native, flows, roots, paired, [coil], settings, scale, {
    sourcePosition: source, sourceRadiusMm: 1500, permittedWallCells, preserved: fixture.others as RectShape[],
    obstacles, checkpoint })
  assert.deepEqual(physical.refined, [0, 1], 'both actual feeds remain possible with every neighbouring coil present')
  assert.deepEqual(physical.failures, [])
})
