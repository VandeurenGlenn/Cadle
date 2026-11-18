import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateCircuitCables, floorPlanBoardLocations } from '../src/editor/cable-estimate.ts'
import { normalizeElectricalProfile } from '../src/editor/electrical-profile.ts'
import type { CircuitScheduleEditorItem } from '../src/editor/circuit-schedule-page.ts'
import type { Shape } from '../src/editor/model/types.ts'
import type { Project } from '../src/types.ts'

const board: Shape = {
  id: 'cabinet', kind: 'symbol', name: 'Distribution board', path: 'symbols/Electrical devices/Distribution board.svg',
  position: { x: 0, y: 0 }, scale: 1
}
const device = (id: string, x: number, y: number, bindingId = 'A1'): Shape => ({
  id, kind: 'symbol', name: 'Wall outlet with grounding', path: 'symbols/Socket outlets/Wall outlet with grounding.svg',
  bindingId, position: { x, y }, scale: 1
})
const plan = (shapes: Shape[], drawingScale?: 50 | 100): Project['pages'][string] => ({
  name: 'Gelijkvloers', pageType: 'groundplan', creationTime: 1,
  schema: { version: 'native-svg-1', objects: [{ kind: 'cadle-native-svg-document', payload: {
    version: 2, shapes, drawingScale, selectedId: null, paperPreset: 'a3-landscape',
    worldWidth: 3360, worldHeight: 2376, printMargin: 8
  } }] }
})
const project = (scale: 50 | 100 = 100): Project => ({
  uuid: '00000000-0000-4000-8000-000000000001', creationTime: 1, name: 'Cable estimate',
  customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' },
  company: '', address: { street: '', number: '', postalCode: '', city: '' },
  pages: { ground: plan([board, device('a', 80, 0), device('b', 80, 80), device('c', 160, 80, 'A2')], scale) }
})
const items: CircuitScheduleEditorItem[] = [
  { id: 'DIFF:main', kind: 'differential', boardId: 'main', title: '', subtitle: '', modules: 2 },
  { id: 'A', kind: 'circuit', boardId: 'main', title: '', subtitle: '', modules: 2, cable: '3G2.5 mm² VOB' }
]

test('estimates a shared orthogonal network at the physical page scale, including repeated point IDs', () => {
  const drawing = project()
  assert.equal(estimateCircuitCables(drawing, items)[0].metres, 3)
  assert.equal(estimateCircuitCables(project(50), items)[0].metres, 1.5)
  drawing.pages.schematic = { ...plan([device('schematic-copy', 80000, 80000)]), pageType: 'onewire' }
  drawing.pages.heating = { ...drawing.pages.ground, heatingPlanOf: 'ground' }
  assert.deepEqual(estimateCircuitCables(drawing, items), [{
    id: 'A', boardId: 'main', cable: '3G2.5 mm² VOB', metres: 3, complete: true, notes: []
  }])
  drawing.pages.ground = plan([{ ...board, position: { x: 0, y: -80 } },
    device('a', 80, 0), device('b', 80, 80), device('c', 160, 80, 'A2')], 100)
  assert.equal(estimateCircuitCables(drawing, items)[0].metres, 4)
})

test('uses explicit board locations and recalculates on circuit reassignment without guessing between boards', () => {
  const drawing = project()
  drawing.pages.garage = plan([{ ...board, id: 'garage-cabinet', position: { x: 800, y: 0 } },
    device('garage-a', 880, 0)], 100)
  drawing.electricalProfile = normalizeElectricalProfile(undefined)
  drawing.electricalProfile.boards!.push({ id: 'garage', name: 'Garage', rails: [] })
  assert.equal(floorPlanBoardLocations(drawing).length, 2)
  assert.equal(estimateCircuitCables(drawing, items)[0].metres, null)
  drawing.electricalProfile.boards![0].floorPlanLocation = { pageKey: 'ground', shapeId: 'cabinet' }
  drawing.electricalProfile.boards![1].floorPlanLocation = { pageKey: 'garage', shapeId: 'garage-cabinet' }
  const main = estimateCircuitCables(drawing, items)[0]
  assert.equal(main.metres, 3)
  assert.equal(main.complete, false)
  assert.match(main.notes.join(), /1 punten op andere pagina's/)
  const garage = estimateCircuitCables(drawing, [{ ...items[1], boardId: 'garage' }])[0]
  assert.equal(garage.metres, 1)
  assert.match(garage.notes.join(), /3 punten op andere pagina's/)
  drawing.electricalProfile.boards![0].floorPlanLocation.shapeId = 'deleted'
  assert.equal(estimateCircuitCables(drawing, items)[0].metres, null)
})

test('reports absent devices, missing scale and missing cabinet positions rather than inventing zero-length totals', () => {
  const drawing = project()
  drawing.pages.ground = plan([board, device('a', 80, 0)])
  assert.match(estimateCircuitCables(drawing, items)[0].notes.join(), /Tekenschaal ontbreekt/)
  assert.equal(estimateCircuitCables(drawing, items)[0].metres, null)
  drawing.pages.ground = plan([device('a', 80, 0)], 100)
  assert.match(estimateCircuitCables(drawing, items)[0].notes.join(), /Koppel een unieke kastpositie/)
  drawing.pages.ground = plan([board], 100)
  const empty = estimateCircuitCables(drawing, items)[0]
  assert.equal(empty.metres, null)
  assert.match(empty.notes.join(), /Geen gelabelde/)
})
