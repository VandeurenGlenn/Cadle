import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Point, RectShape, Shape } from '../src/editor/model/types.ts'
import type { HeatingSpiralField } from '../src/editor/heating-spiral.ts'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import { buildHeatingGrid, heatingCurveWallConflict, heatingSourceRoom } from '../src/editor/heating-routing.ts'
import { heatingRoomKey, measureHeatingCoverage } from '../src/editor/heating-coverage.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { createHeatingPipe } from '../src/editor/heating-pipe.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { generateHeatingAreaLoop } from '../src/editor/heating-area-kernel.ts'
import { retractHeatingFeedEntries } from '../src/editor/heating-clearance.ts'
import { heatingFieldEntryGuards } from '../src/editor/heating-field-entry-guards.ts'
import { selectHeatingDoorEntries, type HeatingDoorEntrySelectionCache } from '../src/editor/heating-door-entry-selection.ts'
import { routeDoorAdaptedHeatingFeeds } from '../src/editor/heating-door-adapter.ts'

const readFixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const shared = readFixture('heating-shared-doorway'), adapter = readFixture('heating-door-adapter')
const original = readFixture('heating-door-entry-selection') as HeatingSpiralField
const scene = sanitizeShapes(shared.scene) as Shape[], scale = 100, source = adapter.source
const native = buildHeatingGrid(scene, scale, 100, source, { pipeDiameterMm: 16, minBendRadiusMm: 80 })
const settings = adapter.settings, obstacles = heatingObstacleBounds(scene, shapeBounds)
const neighbours = adapter.neighbors as RectShape[], originals = [adapter.coil as RectShape, ...neighbours]
const jobs: HeatingSpiralField[] = [original, ...neighbours.map((pipe) => ({
  cells: [], points: heatingPipeGeometry(pipe).points, pattern: pipe.heating!.pattern,
  roomName: pipe.heating!.roomName!, roomKey: pipe.heating!.roomKey, roomMembers: pipe.heating!.roomMembers,
  areaM2: pipe.heating!.servedAreaM2!, spacingMinMm: 100, spacingMaxMm: 100,
}))]
const pipesFor = (fields: readonly HeatingSpiralField[]) => fields.map((field, index) =>
  createHeatingPipe(`door-selection-${index}`, field.points!, { ...originals[index].heating!,
    circuitId: `door-selection-${index}`, pipeRole: 'loop', pattern: field.pattern,
    roomName: field.roomName, roomKey: field.roomKey, roomMembers: field.roomMembers, servedAreaM2: field.areaM2 }))
const roomIds = new Set(native.rooms.filter((room) => original.roomMembers!.some((member) =>
  member.key === heatingRoomKey(room))).map((room) => room.id))
const members = (fields: readonly HeatingSpiralField[]) => fields.map((field) =>
  field.roomMembers?.map((room) => room.key) ?? [field.roomKey])
const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6

test('a stranded real R6 entry chooses a witnessed inlet without changing the twelve partitions or native coverage', () => {
  const before = JSON.stringify(jobs), nativeWalls = native.wall.slice(), nativeObstacles = native.obstacle.slice()
  const initial = pipesFor(jobs), deadline = Date.now() + 15000
  const checkpoint = () => assert.ok(Date.now() < deadline, 'a local doorway witness avoids the exhausted global seam search')
  assert.equal(heatingFieldEntryGuards(native, scene, initial[0], initial, roomIds,
    source, settings, scale, { obstacles, checkpoint }), null, 'the original top-facing inlet has no witnessed doorway pair')

  const variants = new Map<string, number>(), cache: HeatingDoorEntrySelectionCache = {}
  const selected = selectHeatingDoorEntries(jobs, native, scene, source, settings, scale, { variants, checkpoint, cache })
  assert.equal(selected.length, 12)
  assert.equal(selected[0].entryVariant, 3)
  assert.deepEqual([...variants], [[original.entryKey, 3]], 'the retry budget retains the chosen positive variant')
  assert.notDeepEqual(selected[0].points, original.points)
  assert.deepEqual(selected.slice(1), jobs.slice(1), 'all eleven neighbouring fields keep their complete geometry')
  assert.deepEqual(members(selected), members(jobs), 'selecting an inlet cannot discard a shared room')
  assert.equal(selected[0].areaM2, original.areaM2)
  assert.deepEqual(selected[0].entryArea, original.entryArea)
  const validated = generateHeatingAreaLoop(original.entryArea!, { ...original.entrySettings!, entryVariant: 3 }, scale, checkpoint)
  assert.ok(validated && validated.gapRatio <= original.entryMaxGapRatio! + 1e-7,
    'the chosen inlet still meets the original partition coverage bound')

  const coils = pipesFor(selected), permitted = new Set<number>(shared.permittedWallCells)
  const pair = routeDoorAdaptedHeatingFeeds(native, scene, coils[0], coils, [], settings, scale, {
    source, sourceRadiusMm: 1500, nativeFloor: native, nativeWallCells: permitted, permittedWallCells: permitted,
    obstacles, work: {}, searchKey: 'selected-real-r6-entry', checkpoint,
  })
  assert.ok(pair, 'the positive local entry also admits a full connection to the real source')
  const ports = heatingPipeGeometry(coils[0]).points
  assert.ok(close(pair[0].at(-1)!, ports[0]) && close(pair[1].at(-1)!, ports.at(-1)!))
  const sourceRoom = heatingSourceRoom(native, source)!
  assert.ok(pair.every((vertices) => native.room[native.index(vertices[0])] === sourceRoom.id &&
    Math.hypot(vertices[0].x - source.x, vertices[0].y - source.y) <= 120 + 1e-6))
  const feeds = pair.map((vertices, index) => createHeatingPipe(`selected-r6-feed-${index}`,
    index ? [...vertices].reverse() : vertices, { ...coils[0].heating!, pipeRole: index ? 'return' : 'supply', bendRadiusMm: 80 }))
  assert.equal(checkHeatingPlan([...coils, ...feeds], [], settings.design, obstacles).errors, 0)
  assert.ok(coils.every((coil) => !heatingCurveWallConflict(native, heatingPipeGeometry(coil).pieces,
    { permittedWallCells: new Set() })))
  assert.ok(feeds.every((feed) => !heatingCurveWallConflict(native, heatingPipeGeometry(feed).pieces,
    { allowWalls: true, permittedWallCells: permitted }) && heatingPipeGeometry(feed).bends.every((bend) => bend.radiusMm >= 79.9)))
  const totalM = [coils[0], ...feeds].reduce((sum, pipe) => sum + heatingPipeGeometry(pipe).length * scale / 8000, 0)
  assert.ok(totalM + 2 <= 120.05, `the complete ${totalM.toFixed(3)}m route retains its installation reserve`)

  const coverageBefore = measureHeatingCoverage(native, initial, scale, 100, 100, checkpoint, false).coverage
  const coverageAfter = measureHeatingCoverage(native, coils, scale, 100, 100, checkpoint, false).coverage
  assert.deepEqual(coverageAfter.rooms.map((room) => [room.key, room.eligibleM2]),
    coverageBefore.rooms.map((room) => [room.key, room.eligibleM2]), 'entry selection cannot shrink native eligible floor')
  for (const room of coverageAfter.rooms) {
    const previous = coverageBefore.rooms.find((before) => before.key === room.key)!
    assert.ok(room.gapM2 <= previous.gapM2 + .02, `${room.name} retains native floor coverage`)
  }
  assert.deepEqual(native.wall, nativeWalls)
  assert.deepEqual(native.obstacle, nativeObstacles)
  assert.equal(JSON.stringify(jobs), before, 'source jobs and their nested partition metadata remain immutable')

  const expected = JSON.stringify(selected), finalVariants = [...variants]
  const cached = (fields: readonly HeatingSpiralField[], requested: [string, number][]) => {
    let checkpoints = 0
    const replayVariants = new Map(requested)
    const result = selectHeatingDoorEntries(fields, native, scene, source, settings, scale,
      { variants: replayVariants, cache, checkpoint: () => { checkpoints++ } })
    assert.equal(checkpoints, 1, 'a completed exact selection checkpoint replaces all geometric searches')
    assert.equal(JSON.stringify(result), expected)
    assert.deepEqual([...replayVariants], finalVariants)
    return result
  }
  cached(jobs, [])
  cached(jobs, finalVariants)
  cached(selected, finalVariants)
  const detached = cached(jobs, [])
  detached[0].points![0].x += 1
  detached[0].cells.push(-1)
  detached[0].roomMembers![0].name = 'changed cached room'
  detached[0].entryArea!.boundaries[0][0].x += 1
  detached[0].entryArea!.clearance!.boundaries[0][0].x += 1
  detached[0].entrySettings!.design!.maxCircuitLengthM = 1
  detached[1].points![0].y += 1
  cached(jobs, [])
  assert.equal(JSON.stringify(selected), expected, 'nested hit results cannot mutate the original selected result')
  assert.equal(JSON.stringify(jobs), before, 'nested hit results cannot mutate the input partitions')

  const miss = (change: {
    source?: Point; scene?: Shape[]; settings?: typeof settings; native?: typeof native; requested?: [string, number][];
  }) => {
    const pause = new Error('stop invalidated cache before searching'), replayVariants = new Map(change.requested ?? [])
    let checkpoints = 0
    assert.throws(() => selectHeatingDoorEntries(jobs, change.native ?? native, change.scene ?? scene,
      change.source ?? source, change.settings ?? settings, scale,
      { variants: replayVariants, cache, checkpoint: () => { if (++checkpoints === 2) throw pause } }),
    (error) => error === pause)
    assert.equal(checkpoints, 2, 'a changed geometric input or retry request must enter the uncached path')
  }
  miss({ source: { ...source, x: source.x + 1 } })
  miss({ requested: [[original.entryKey!, 4]] })
  miss({ settings: { ...settings, design: { ...settings.design, maxCircuitLengthM: 119 } } })
  const changedScene = structuredClone(scene)
  changedScene[0].strokeWidth = (changedScene[0].strokeWidth ?? 2) + 1
  miss({ scene: changedScene })
  const changedObstacle = native.obstacle.slice()
  changedObstacle[0] = changedObstacle[0] ? 0 : 1
  miss({ native: { ...native, obstacle: changedObstacle } })
  cached(jobs, [])
})

test('a bounded negative doorway witness keeps the original field when its inlet variants are exhausted', () => {
  const before = JSON.stringify(jobs), variants = new Map([[original.entryKey!, 8]])
  const result = selectHeatingDoorEntries(jobs, native, scene, source, settings, scale,
    { variants, checkpoint: () => {} })
  assert.deepEqual(result, jobs, 'a failed bounded preflight does not remove a field or imply the room is impossible')
  assert.deepEqual([...variants], [[original.entryKey, 8]])
  assert.equal(JSON.stringify(jobs), before)
})

test('resuming a selected entry reuses its recorded positive variant rather than skipping it', () => {
  const variants = new Map([[original.entryKey!, 3]])
  const selected = selectHeatingDoorEntries(jobs, native, scene, source, settings, scale,
    { variants, checkpoint: () => {} })
  assert.equal(selected[0].entryVariant, 3)
  assert.deepEqual([...variants], [[original.entryKey, 3]])
  const expected = generateHeatingAreaLoop(original.entryArea!, { ...original.entrySettings!, entryVariant: 3 }, scale, () => {})!
  assert.deepEqual(selected[0].points, retractHeatingFeedEntries(expected.points, 16, 100, scale, 80))
})

test('door-entry selection propagates a pause without changing source jobs or consuming an inlet variant', () => {
  const before = JSON.stringify(jobs), pause = new Error('pause doorway selection'), variants = new Map<string, number>()
  const cache: HeatingDoorEntrySelectionCache = {}
  for (let attempt = 0; attempt < 2; attempt++) {
    let checkpoints = 0
    assert.throws(() => selectHeatingDoorEntries(jobs, native, scene, source, settings, scale,
      { variants, cache, checkpoint: () => { if (++checkpoints === 2) throw pause } }), (error) => error === pause)
    assert.equal(checkpoints, 2, 'a paused attempt must not become a completed cache hit on resume')
    assert.deepEqual(cache, {}, 'an interrupted doorway search cannot publish an unproved result')
  }
  assert.equal(JSON.stringify(jobs), before)
  assert.equal(variants.size, 0)
})


test('a pause between fields resumes at the pending field', () => {
  const fields = jobs.slice(1, 4)
  const cache: HeatingDoorEntrySelectionCache = {}, variants = new Map<string, number>()
  const pause = new Error('pause before the third field')
  let checkpoints = 0
  assert.throws(() => selectHeatingDoorEntries(fields, native, scene, source, settings, scale,
    { cache, variants, checkpoint: () => { if (++checkpoints === 4) throw pause } }), (error) => error === pause)
  assert.deepEqual(cache, {})
  checkpoints = 0
  const result = selectHeatingDoorEntries(fields, native, scene, source, settings, scale,
    { cache, variants, checkpoint: () => { checkpoints++ } })
  assert.deepEqual(result, fields)
  assert.equal(checkpoints, 2, 'the entry checkpoint and only the pending field run on resume')
})
