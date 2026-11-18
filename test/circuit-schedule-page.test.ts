import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuitSchedule, buildCircuitScheduleSvgs, circuitScheduleEditorItems, circuitScheduleRows, packCircuitCabinetRows } from '../src/editor/circuit-schedule-page.ts'
import type { CircuitAnalysis, CircuitGroup } from '../src/editor/circuit-analysis.ts'
import { analyzeCircuits } from '../src/editor/circuit-analysis.ts'
import { buildKamrailCircuitBundle } from '../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import { normalizeElectricalProfile } from '../src/editor/electrical-profile.ts'
import { buildOneWireTopology } from '../src/editor/layout/onewire-topology.ts'
import { oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import type { Project } from '../src/types.ts'

const group = (bindingId: string, name: string, boardId = 'main'): CircuitGroup => ({
  bindingId,
  family: bindingId.replace(/\d+$/, ''),
  number: Number(bindingId.match(/\d+$/)?.[0] ?? 0) || null,
  components: [{ shapeId: bindingId, bindingId, family: bindingId.replace(/\d+$/, ''), number: 1, role: 'load', name }],
  switches: 0,
  loads: 1,
  protection: 0,
  junctions: 0,
  neutral: 0,
  ready: true,
  specification: {
    circuitType: 'sockets',
    breakerCurrentA: 20,
    cableSectionMm2: 2.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit',
    showCableInstallation: true,
    poles: 2,
    phaseConfiguration: 'L1+N',
    showPhaseLabel: true,
    breakerCurve: 'C',
    source: 'suggested',
    boardId,
    sources: {
      breakerCurrentA: 'suggested',
      cableSectionMm2: 'suggested',
      poles: 'suggested',
      phaseConfiguration: 'suggested'
    }
  }
})

const analysis = (groups: CircuitGroup[]): CircuitAnalysis => ({
  groups,
  issues: [],
  families: [...new Set(groups.map((entry) => entry.family))],
  totalGroups: groups.length,
  readyGroups: groups.length,
  errorCount: 0,
  warningCount: 0,
  valid: true
})

const projectFixture = (): Project => ({
  uuid: '00000000-0000-4000-8000-000000000001', name: 'Kasten', creationTime: 1,
  customer: { name: '', lastname: '' }, installer: { name: '', lastname: '' }, company: '',
  address: { street: '', number: '', postalCode: '', city: '' }, pages: {},
  electricalProfile: normalizeElectricalProfile(undefined)
})
const schematicSchema = (shapes: Shape[]) => ({ version: 'native-svg-1', objects: [{
  kind: 'cadle-native-svg-document', payload: { version: 2, shapes, paperPreset: 'a4-landscape', printMargin: 10,
    worldWidth: 2376, worldHeight: 1680 }
}] })

test('links each circuit to the main and matching row differential and includes topology-only diffs without duplicates', () => {
  const project = projectFixture()
  project.electricalProfile!.boards![0] = {
    id: 'main', name: 'Hoofdkast', rails: [{ id: 'rail-1', name: 'Rij 1' }, { id: 'rail-2', name: 'Rij 2' }],
    mainDifferential: { id: 'main', ratedCurrentA: 40, sensitivityMa: 300, poles: 2, type: 'A' },
    additionalDifferentials: [{ id: 'wet', railId: 'rail-2', ratedCurrentA: 40, sensitivityMa: 30, poles: 2, type: 'A' }]
  }
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: false,
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    additionalDifferentials: [
      { count: 1, purpose: 'consumers', boardId: 'main', railId: 'rail-2', ratedCurrentA: 40, sensitivityMa: 30 },
      { count: 1, purpose: 'ev', boardId: 'garage', railId: 'rail-1', ratedCurrentA: 63, sensitivityMa: 30, rcdType: 'B' }
    ] }
  const a = group('A1', 'Licht'), b = group('B1', 'Stopcontact'), c = group('C1', 'EV', 'garage')
  b.specification.railId = 'rail-2'
  let sequence = 0
  const topology = buildOneWireTopology(project.oneWireTopology, { start: { x: 200, y: 1200 }, end: { x: 1800, y: 1200 } }, () => `topology-${++sequence}`)
  project.pages['00000000-0000-4000-8000-000000000002'] = { name: 'Eendraads', creationTime: 1, pageType: 'onewire',
    schema: schematicSchema(topology) }
  const items = circuitScheduleEditorItems(project, analysis([a, b, c]))
  const differentials = items.filter((item) => item.kind === 'differential')
  assert.equal(differentials.length, 3)
  assert.deepEqual(items.find((item) => item.id === 'A')!.differentialIds, ['DIFF:main:MAIN'])
  assert.deepEqual(items.find((item) => item.id === 'B')!.differentialIds, ['DIFF:main:MAIN', 'DIFF:main:wet'])
  assert.deepEqual(items.find((item) => item.id === 'DIFF:main:wet')!.circuits, ['B'])
  assert.deepEqual(items.find((item) => item.id === 'DIFF:main:MAIN')!.circuits, ['A', 'B'])
  const ev = differentials.find((item) => item.boardId === 'garage')!
  assert.deepEqual(ev.circuits, ['C'])
  assert.match(ev.subtitle, /63A \/ 30mA/)
  const exported = buildCircuitScheduleSvgs(project, analysis([a, b, c])).join('')
  assert.match(exported, /Voedt: B/)
  assert.doesNotMatch(exported, />DIFF:main:/)
})

test('includes manually wired differentials via real rail contacts and reports unconnected devices honestly', () => {
  const project = projectFixture()
  const diff: Shape = { id: 'manual-diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    symbolTextOverrides: { description: 'Badkamer' }, electrical: { role: 'protection', poles: 4, breakerCurrentA: 40, rcdSensitivityMa: 30 } }
  const top = oneWireSymbolConnectionAnchors(diff).find((anchor) => anchor.side === 'top')!.point
  const shapes: Shape[] = [
    { id: 'rail', kind: 'line', groupId: 'onewire-kamrail-main', start: { x: top.x - 200, y: top.y - 80 }, end: { x: top.x + 200, y: top.y - 80 } },
    { id: 'feed', kind: 'line', start: top, end: { x: top.x, y: top.y - 80 } },
    ...schematicCircuit('A').map((shape) => ({ ...shape, oneWireRailId: 'rail' })), diff,
    { ...diff, id: 'loose-diff', position: { x: 1800, y: 1200 } }
  ]
  const secondDiff = { ...diff, id: 'second-diff', position: { x: 1600, y: 1200 } }
  const secondTop = oneWireSymbolConnectionAnchors(secondDiff).find((anchor) => anchor.side === 'top')!.point
  shapes.push(secondDiff,
    { id: 'second-rail', kind: 'line', groupId: 'onewire-kamrail-second',
      start: { x: secondTop.x - 100, y: secondTop.y - 80 }, end: { x: secondTop.x + 100, y: secondTop.y - 80 } },
    { id: 'second-feed', kind: 'line', start: secondTop, end: { x: secondTop.x, y: secondTop.y - 80 } },
    ...schematicCircuit('B').map((shape) => ({ ...shape, oneWireRailId: 'second-rail' })))
  project.pages['00000000-0000-4000-8000-000000000002'] = { name: 'Eendraads', creationTime: 1, pageType: 'onewire',
    schema: schematicSchema(shapes) }
  const items = circuitScheduleEditorItems(project, analysis([group('A1', 'Licht'), group('B1', 'Stopcontact')]))
  const connected = items.find((item) => item.kind === 'differential' && item.boardId === 'main')!
  assert.equal(connected.title, 'Badkamer')
  assert.deepEqual(connected.circuits, ['A'])
  assert.equal(connected.railId, 'rail-1')
  assert.deepEqual(items.find((item) => item.id.endsWith(':second-diff'))!.circuits, ['B'])
  const disconnected = items.find((item) => item.boardId === 'unassigned')!
  assert.deepEqual(disconnected.circuits, [])
  assert.ok(disconnected.assignmentWarning)
  shapes[0].sourceLink = { kind: 'board', id: 'main', role: 'rail:main:rail-1' }
  const explicit = circuitScheduleEditorItems(project, analysis([group('A1', 'Licht')]))
  assert.deepEqual(explicit.find((item) => item.kind === 'differential' && item.boardId === 'main')!.circuits, ['A'])
})

test('does not claim a unique circuit assignment when multiple differentials share a configured row', () => {
  const project = projectFixture()
  project.electricalProfile!.boards![0].additionalDifferentials = ['first', 'second'].map((id) =>
    ({ id, railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, poles: 2 }))
  const items = circuitScheduleEditorItems(project, analysis([group('A1', 'Licht')]))
  assert.deepEqual(items.find((item) => item.id === 'A')!.differentialIds, [])
  assert.match(items.find((item) => item.id === 'A')!.assignmentWarning!, /Meerdere/)
})

test('packs cabinet modules per board, wraps rows and retains explicitly reserved space', () => {
  const items = circuitScheduleEditorItems(null, analysis([group('A1', 'A'), group('B1', 'B'), group('C1', 'C', 'garage')]))
    .map((item) => ({ ...item, modules: 10, gapBefore: item.id === 'A' ? 2 : 0 }))
  const rows = packCircuitCabinetRows(items, 18)
  assert.deepEqual(rows.map((row) => [row.boardId, row.used]), [['main', 12], ['main', 10], ['garage', 10]])
  assert.equal(rows[0].cells[0].start, 3)
  assert.equal(rows[0].cells[0].span, 10)
  assert.deepEqual(packCircuitCabinetRows([{ ...items[0], gapBefore: 18 }], 18).map((row) => row.used), [18, 10])
})

test('groups point bindings into one breaker schedule cell', () => {
  const rows = circuitScheduleRows(analysis([group('A1', 'Socket'), group('A2', 'Socket'), group('B1', 'Lamp')]))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    id: 'A',
    boardId: 'main',
    railId: 'rail-1',
    protection: 'C20A',
    poles: '2P',
    cable: '3G2.5 mm² VOB',
    consumers: ['Socket ×2'],
    rooms: [],
    category: 'Stopcontacten',
    modules: 2
  })
})

const schematicCircuit = (family: string, empty = false): Shape[] => {
  let id = 0
  return sanitizeShapes(buildKamrailCircuitBundle({
    rail: { id: 'rail', kind: 'line', start: { x: 100, y: 1200 }, end: { x: 2000, y: 1200 } },
    anchorX: 400,
    options: { family, amps: 32, poles: 4, cableConductors: 5, cableSectionMm2: 6, cableType: 'XGB',
      cableFireClass: 'LSOH', autoIncludeFamily: true },
    familyComponents: [{ bindingId: `${family}1`, kind: empty ? 'empty' : 'load',
      sourceShapeId: `${family}-device`, sourceName: 'Lighting',
      sourcePath: 'symbols/Consumption appliances/Lighting.svg' }],
    nextShapeId: () => `${family}-${++id}`,
    oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
    oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
    symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!,
    branchStroke: '#000000'
  })!.shapes, 'onewire')
}

test('includes schematic-only A through D without doubling floor-plan families or continuation copies', () => {
  const floorPlan: Shape[] = [{
    id: 'physical-E', kind: 'symbol', position: { x: 100, y: 100 }, name: 'Floor-plan socket',
    path: 'symbols/Socket outlets/Wall outlet with grounding.svg', scale: 1, bindingId: 'E1',
    roomName: 'Keuken', electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets' }
  }]
  const schematic = ['A', 'B', 'C', 'D', 'E'].flatMap((family) => schematicCircuit(family, family === 'A'))
  const continuation = schematic.map((shape) => ({ ...shape, id: `${shape.id}-continuation` }))
  const result = analyzeCircuitSchedule(floorPlan, [...schematic, ...continuation])
  const rows = circuitScheduleRows(result)
  assert.deepEqual(rows.map((row) => row.id), ['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(rows[0].consumers, [])
  assert.equal(rows[0].protection, 'C32A')
  assert.equal(rows[0].poles, '4P')
  assert.equal(rows[0].cable, '5G6 mm² XGB LSOH')
  assert.deepEqual(rows[1].consumers, ['Lighting'])
  assert.deepEqual(rows[4].consumers, ['Floor plan socket'])
  assert.deepEqual(rows[4].rooms, ['Keuken'])
  assert.deepEqual(analyzeCircuits(floorPlan).families, ['E'])
  const svg = buildCircuitScheduleSvgs(null, result).join('')
  for (const family of ['A', 'B', 'C', 'D', 'E']) assert.match(svg, new RegExp(`>${family}</text>`))
})

test('stored circuit specifications override schematic metadata without inventing unused circuits', () => {
  const result = analyzeCircuitSchedule([], schematicCircuit('A'), undefined, {
    A: { breakerCurrentA: 40, poles: 2, cableSectionMm2: 10, boardId: 'garage', notes: 'Bestaande kring' },
    Z: { breakerCurrentA: 16 }
  })
  const rows = circuitScheduleRows(result)
  assert.deepEqual(rows.map((row) => row.id), ['A'])
  assert.equal(rows[0].protection, 'C40A')
  assert.equal(rows[0].poles, '2P')
  assert.equal(rows[0].cable, '5G10 mm² XGB LSOH')
  assert.equal(rows[0].boardId, 'garage')
  assert.equal(rows[0].note, 'Bestaande kring')
})

test('paginates a readable portrait schedule at 30 rows per page', () => {
  const groups = Array.from({ length: 61 }, (_, index) => group(`C${index + 1}X1`, `Load ${index + 1}`))
  const pages = buildCircuitScheduleSvgs(null, analysis(groups))
  assert.equal(pages.length, 3)
  assert.match(pages[0], /HOOFDVERDEELBORD/)
  assert.match(pages[2], />3\/3 · 3\/3<\/text>/)
})

test('keeps the configured module width while using table pagination', () => {
  const groups = Array.from({ length: 31 }, (_, index) => group(`C${index + 1}X1`, `Load ${index + 1}`))
  const pages = buildCircuitScheduleSvgs(
    { name: 'Test', circuitScheduleLayout: { modulesPerRow: 18 } } as never,
    analysis(groups)
  )
  assert.equal(pages.length, 2)
})

test('creates separate schedule pages for multiple distribution boards', () => {
  const pages = buildCircuitScheduleSvgs(
    {
      name: 'Test',
      electricalProfile: {
        boards: [
          { id: 'main', name: 'Hoofdkast', rails: [{ id: 'rail-1', name: 'Rail 1' }] },
          { id: 'garage', name: 'Garagekast', rails: [{ id: 'rail-1', name: 'Rail 1' }] }
        ]
      }
    } as never,
    analysis([group('A1', 'Socket', 'main'), group('B1', 'Lamp', 'garage')])
  )

  assert.equal(pages.length, 2)
  assert.match(pages[0], /HOOFDKAST/)
  assert.match(pages[0], />A<\/text>/)
  assert.doesNotMatch(pages[0], />B<\/text>/)
  assert.match(pages[1], /GARAGEKAST/)
  assert.match(pages[1], />B<\/text>/)
  assert.doesNotMatch(pages[1], />A<\/text>/)
})
