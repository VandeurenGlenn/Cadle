import test from 'node:test'
import assert from 'node:assert/strict'
import { createHeatingPipe, heatingDefaults, heatingRoomScope, heatingSchedule, sanitizeHeating, heatingMarkup } from '../src/editor/heating-plan.ts'
import { heatingMaterials, heatingMaterialsCSV } from '../src/editor/heating-materials.ts'
import { applyHeatingPipeProfile, heatingPipeProfile, readHeatingPipeProfiles, saveHeatingPipeProfile } from '../src/editor/heating-products.ts'
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { shapeBounds } from '../src/editor/model/model.ts'
import type { Shape, RectShape } from '../src/editor/model/types.ts'

test('shared rooms, source heating and manifold exit survive sanitization', () => {
  const raw = { ...heatingDefaults('manifold'), shareSmallRooms: true, heatSourceRoom: false, manifoldSide: 'top', sourceRoomKey: 'storage', wallPassages: 3,
    roomMembers: [{ key: 'bath', name: 'Bathroom', areaM2: 4 }, { key: 'hall', name: 'Hall', areaM2: 1 }] }
  const data = sanitizeHeating(raw)!
  assert.equal(data.heatSourceRoom, false); assert.equal(data.shareSmallRooms, true); assert.equal(data.manifoldSide, 'top'); assert.equal(data.wallPassages, 3)
  assert.deepEqual(data.roomMembers, raw.roomMembers)
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 100, y: 40 }, heating: { ...data, points: [{ x: .2, y: 0 }, { x: .3, y: 0 }] } }
  assert.match(heatingMarkup(manifold), /M 20 14 V 0/)
})

test('a shared room recalculation expands only through shared circuits', () => {
  const items = [{ roomKey: 'a', roomMembers: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }] },
    { roomKey: 'b', roomMembers: [{ key: 'b', name: 'B' }, { key: 'c', name: 'C' }] }, { roomKey: 'other' }]
  assert.deepEqual([...heatingRoomScope(items, 'a')], ['a', 'b', 'c'])
})

test('shared circuit heat loads are apportioned by each actual served room area', () => {
  const members = [{ key: 'a', name: 'A', areaM2: 2 }, { key: 'b', name: 'B', areaM2: 1 }]
  const pipes = [createHeatingPipe('p1', [{ x: 0, y: 0 }, { x: 80, y: 0 }], { ...heatingDefaults('pipe'), circuitId: 'VV01', pipeRole: 'loop', servedAreaM2: 3, roomMembers: members }),
    createHeatingPipe('p2', [{ x: 0, y: 10 }, { x: 80, y: 10 }], { ...heatingDefaults('pipe'), circuitId: 'VV02', pipeRole: 'loop', servedAreaM2: 2, roomMembers: [{ key: 'a', name: 'A', areaM2: 2 }] })]
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 100, y: 40 }, heating: { ...heatingDefaults('manifold'), design: { deltaTK: 5, roomHeatLoadsW: { A: 400, B: 200 } } } }
  const rows = heatingSchedule([manifold, ...pipes])
  assert.ok(Math.abs(rows[0].flowLmin / rows[1].flowLmin - 2) < 1e-9)
  assert.ok(rows.every((r) => !r.flowEstimated))
})

test('pipe profiles retain product limits without copying project loads', () => {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
  const profile = heatingPipeProfile('Example 16', 16, { pipeWallMm: 2, minBendRadiusMm: 80, maxCircuitLengthM: 100, roomHeatLoadsW: { Room: 800 }, supplyTemperatureC: 40 })
  saveHeatingPipeProfile(profile, storage); saveHeatingPipeProfile(profile, storage)
  assert.equal(readHeatingPipeProfiles(storage).length, 1)
  assert.equal(readHeatingPipeProfiles(storage)[0].design.roomHeatLoadsW, undefined)
  const applied = applyHeatingPipeProfile(profile, { roomHeatLoadsW: { Room: 500 }, supplyTemperatureC: 35, systemOutputBasis: 'old' })
  assert.equal(applied.supplyTemperatureC, 35); assert.equal(applied.roomHeatLoadsW!.Room, 500); assert.equal(applied.pipeWallMm, 2); assert.equal(applied.systemOutputBasis, undefined)
})

test('material quantities include both leads and exactly one reserve per circuit', () => {
  const row = { id: 'VV01', room: 'Room', diameterMm: 16, spacingMm: 100, areaM2: 5, loopM: 50, supplyM: 4, returnM: 5, totalM: 59, allowanceM: 2, cutM: 61, flowLmin: 1 }
  const result = heatingMaterials([row, { ...row, id: 'VV02', diameterMm: 20 }], 3)
  assert.equal(result.connections, 4); assert.equal(result.wallPassages, 3); assert.equal(result.pipes[0].orderM, 61)
  assert.match(heatingMaterialsCSV([row], 3), /61,00/)
})

test('fixed grouped stair rectangles reserve their complete footprint; explicit overrides win', () => {
  const shapes: Shape[] = [{ id: 'a', kind: 'rect', locked: true, groupId: 'stairs', start: { x: 0, y: 0 }, end: { x: 20, y: 50 } },
    { id: 'b', kind: 'rect', locked: true, groupId: 'stairs', start: { x: 25, y: 0 }, end: { x: 45, y: 50 } }]
  assert.deepEqual(heatingObstacleBounds(shapes, shapeBounds), [{ x: 0, y: 0, width: 45, height: 50 }])
  assert.equal(heatingObstacleBounds(shapes.map((s) => ({ ...s, heatingObstacle: false })), shapeBounds).length, 0)
})
