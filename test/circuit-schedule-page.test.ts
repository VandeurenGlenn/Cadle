import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuitSchedule, buildCircuitScheduleSvgs, cabinetModulesPerRow, circuitScheduleEditorItems, circuitScheduleRows, packCircuitCabinetRows, refreshCircuitScheduleItems } from '../src/editor/circuit-schedule-page.ts'
import { addScheduleDifferential, assignScheduleDifferential } from '../src/editor/circuit-schedule-editing.ts'
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

test('includes the configured residual breaker with its actual cabinet, rating and module width in the schedule and export', () => {
  const project = projectFixture()
  project.electricalProfile!.boards![0].id = 'actual-cabinet'
  project.oneWireTopology = { version: 1, consumers: true, solar: true, residualBreaker: true,
    residualBreakerRatedCurrentA: 63, residualBreakerPoles: 4 }
  const circuit = group('A1', 'A', 'actual-cabinet')
  const items = circuitScheduleEditorItems(project, analysis([circuit]))
  const residual = items.find((item) => item.kind === 'residual-breaker')!
  assert.equal(residual.title, 'Remautomaat')
  assert.equal(residual.boardId, 'actual-cabinet')
  assert.equal(residual.subtitle, '4P · C63A')
  assert.equal(residual.modules, 4)
  assert.deepEqual(items.find((item) => item.id === 'A')!.differentialIds, [])
  assert.equal(packCircuitCabinetRows(items.map((item) => ({ ...item, gapBefore: 0 })), 18)[0].used, 6)
  const exported = buildCircuitScheduleSvgs(project, analysis([circuit])).join('')
  assert.match(exported, />REM<\/text>/)
  assert.match(exported, />Remautomaat<\/text>/)
  assert.match(exported, /4P · C63A/)
  assert.match(exported, /Voedingsbeveiliging/)
  assert.equal(refreshCircuitScheduleItems(project, items).filter((item) => item.kind === 'residual-breaker').length, 1)
})

test('includes unlabelled one-wire breakers in the schedule and reserves their module width', () => {
  const project = projectFixture()
  const breaker: Shape = {
    id: 'unlabelled-breaker',
    kind: 'symbol',
    name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg',
    position: { x: 800, y: 1200 },
    scale: 3,
    electrical: {
      role: 'protection',
      breakerCurrentA: 16,
      breakerCurve: 'B',
      poles: 2,
      cableConductors: 3,
      cableSectionMm2: 2.5,
      cableType: 'VOB',
      hasProtectiveConductor: true
    }
  }
  project.pages.schematic = {
    name: 'Eendraads',
    creationTime: 1,
    pageType: 'onewire',
    schema: schematicSchema([breaker])
  }

  const items = circuitScheduleEditorItems(project, analysis([]))
  const unlabelled = items.find((item) => item.kind === 'breaker')!
  assert.equal(unlabelled.title, 'Automaat zonder kring')
  assert.equal(unlabelled.subtitle, 'Geen kring · 2P · B16A')
  assert.equal(unlabelled.modules, 2)
  assert.equal(unlabelled.cable, '3G2.5 mm² VOB')
  assert.deepEqual(unlabelled.sourceShapes, [{ pageKey: 'schematic', shapeId: breaker.id }])
  assert.equal(packCircuitCabinetRows(items.map((item) => ({ ...item, gapBefore: 0 })), 18)[0].used, 2)
  assert.match(buildCircuitScheduleSvgs(project, analysis([])).join(''), />AUT<\/text>/)
})

test('accounts for the main switch, residual breaker and PV breaker in cabinet module layout', () => {
  const project = projectFixture()
  project.oneWireTopology = {
    version: 1,
    consumers: true,
    solar: true,
    solarBreakerRatedCurrentA: 32,
    solarBreakerPoles: 2,
    mainSwitch: { ratedCurrentA: 40 },
    mainSwitchPoles: 2,
    residualBreaker: true,
    residualBreakerRatedCurrentA: 40,
    residualBreakerPoles: 4
  }

  const items = circuitScheduleEditorItems(project, analysis([]))
  assert.equal(items.find((item) => item.kind === 'switch')?.modules, 2)
  assert.equal(items.find((item) => item.kind === 'residual-breaker')?.modules, 4)
  assert.equal(items.find((item) => item.id.startsWith('PV:'))?.modules, 2)
  const cabinet = packCircuitCabinetRows(items.map((item) => ({ ...item, gapBefore: 0 })), 18)
  assert.equal(cabinet[0].used, 8)
  const labels = cabinet[0].cells.map(({ item }) => item.id).map((id) =>
    id.startsWith('SW:') ? 'INT' : id.startsWith('REM:') ? 'REM' : id.startsWith('PV:') ? 'PV' : id)
  assert.deepEqual(labels, ['INT', 'REM', 'PV'])
})

test('recognizes schematic-only residual breakers and counts their versioned copies once without including ordinary breakers', () => {
  const project = projectFixture()
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: true,
    residualBreakerRatedCurrentA: 40, residualBreakerPoles: 4 }
  let sequence = 0
  const shapes = buildOneWireTopology(project.oneWireTopology, { start: { x: 200, y: 1200 }, end: { x: 1800, y: 1200 } },
    () => `rem-${++sequence}`)
  const residual = shapes.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'residual-breaker')!
  const copy = { ...residual, id: 'old-rem', sourceLink: undefined,
    generationKey: residual.generationKey!.replace(/:v\d+:/, ':v1:') }
  project.pages.schematic = { name: 'Eendraads', creationTime: 1, pageType: 'onewire',
    schema: schematicSchema([...shapes, ...schematicCircuit('A')]) }
  project.pages.old = { name: 'Vervolg', creationTime: 2, pageType: 'onewire', schema: schematicSchema([copy]) }
  const before = structuredClone(project)
  const items = refreshCircuitScheduleItems(project, [])
  assert.equal(items.filter((item) => item.kind === 'switch').length, 1)
  assert.equal(items.filter((item) => item.kind === 'breaker').length, 0)
  const remautomaat = items.filter((item) => item.kind === 'residual-breaker')
  assert.equal(remautomaat.length, 1)
  assert.equal(remautomaat[0].sourceShapes!.length, 2)
  assert.equal(remautomaat[0].subtitle, '4P · C40A')
  assert.deepEqual(project, before)
  project.oneWireTopology.residualBreaker = false
  const schematicOnly = refreshCircuitScheduleItems(project, []).filter((item) => item.kind === 'residual-breaker')
  assert.equal(schematicOnly.length, 1)
  assert.equal(schematicOnly[0].kind, 'residual-breaker')
  assert.equal(schematicOnly[0].sourceShapes!.length, 2)
  project.pages = {}
  assert.equal(refreshCircuitScheduleItems(project, []).length, 0)
})

test('counts versioned schematic copies once and prefers their known cabinet without merging distinct devices', () => {
  const project = projectFixture()
  project.electricalProfile!.boards!.push({ id: 'garage', name: 'Garage', rails: [{ id: 'rail-3', name: 'Rij 3' }] })
  const old: Shape = { id: 'old-diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    generationKey: 'board:main:topology:v31:additional-differential-consumers-1',
    electrical: { role: 'protection', oneWireEligible: true, railId: 'rail-3', poles: 4, breakerCurrentA: 40, rcdSensitivityMa: 30 } }
  const current = { ...old, id: 'current-diff', generationKey: 'board:main:topology:v33:additional-differential-consumers-1',
    sourceLink: { kind: 'board' as const, id: 'main', role: 'additional-differential-consumers-1' },
    electrical: { ...old.electrical, boardId: 'garage' } }
  const other = { ...current, id: 'other-diff', generationKey: 'board:main:topology:v33:additional-differential-consumers-2',
    sourceLink: { ...current.sourceLink, role: 'additional-differential-consumers-2' } }
  const sourceOnly = { ...current, id: 'source-only', generationKey: undefined }
  const manual = { ...old, id: 'manual-diff', generationKey: undefined }
  project.pages.old = { name: 'Oud eendraads', creationTime: 1, pageType: 'onewire', schema: schematicSchema([manual, old]) }
  project.pages.current = { name: 'Eendraads', creationTime: 2, pageType: 'onewire', schema: schematicSchema([current, sourceOnly, other]) }
  const before = structuredClone(project)
  const items = refreshCircuitScheduleItems(project, [])
  assert.equal(items.length, 3)
  assert.equal(items[0].sourceShapes![0].shapeId, manual.id)
  assert.ok(items.slice(1).every((item) => item.boardId === 'garage'))
  const merged = items.find((item) => item.sourceShapes?.some((source) => source.shapeId === old.id))!
  assert.equal(merged.sourceShapes!.length, 3)
  assert.match(merged.id, /v33:additional-differential-consumers-1$/)
  assert.deepEqual(project, before)
  const assigned = assignScheduleDifferential(project, items, merged.id, 'main', 'rail-1')
  const reassigned = refreshCircuitScheduleItems(assigned, []).find((item) => item.boardId === 'main')!
  assert.equal(reassigned.sourceShapes!.length, 3)
  assert.equal(refreshCircuitScheduleItems(assigned, []).length, 3)
})

test('combines circuit coverage from continuation copies and preserves conflicting cabinet assignments', () => {
  const project = projectFixture()
  const diff: Shape = { id: 'diff-a', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    generationKey: 'board:main:topology:v33:additional-differential-consumers-1',
    sourceLink: { kind: 'board', id: 'main', role: 'additional-differential-consumers-1' },
    electrical: { role: 'protection', oneWireEligible: true, poles: 4, breakerCurrentA: 40, rcdSensitivityMa: 30 } }
  for (const [index, family] of ['A', 'B'].entries()) {
    const copy = { ...diff, id: `diff-${family}` }
    const top = oneWireSymbolConnectionAnchors(copy).find((anchor) => anchor.side === 'top')!.point
    const railId = `rail-${family}`
    project.pages[family] = { name: family, creationTime: index, pageType: 'onewire', schema: schematicSchema([
      copy, { id: railId, kind: 'line', groupId: `onewire-kamrail-${family}`,
        start: { x: top.x - 200, y: top.y - 80 }, end: { x: top.x + 200, y: top.y - 80 } },
      { id: `feed-${family}`, kind: 'line', start: top, end: { x: top.x, y: top.y - 80 } },
      ...schematicCircuit(family).map((shape) => ({ ...shape, oneWireRailId: railId }))
    ]) }
  }
  const items = circuitScheduleEditorItems(project, analysis([group('A1', 'A'), group('B1', 'B')]))
  const differentials = items.filter((item) => item.kind === 'differential')
  assert.equal(differentials.length, 1)
  assert.deepEqual(differentials[0].circuits, ['A', 'B'])
  const garageCopy = { ...diff, id: 'garage-diff', electrical: { ...diff.electrical, boardId: 'garage' } }
  project.pages.garage = { name: 'Garage', creationTime: 3, pageType: 'onewire', schema: schematicSchema([garageCopy]) }
  const conflicting = circuitScheduleEditorItems(project, analysis([group('A1', 'A'), group('B1', 'B')]))
    .filter((item) => item.kind === 'differential')
  assert.equal(conflicting.length, 2)
  assert.deepEqual(conflicting.map((item) => item.boardId).sort(), ['garage', 'main'])
  const railCopy = { ...diff, id: 'other-rail-diff', electrical: { ...diff.electrical, boardId: 'main', railId: 'rail-2' } }
  project.pages.otherRail = { name: 'Andere rij', creationTime: 4, pageType: 'onewire', schema: schematicSchema([railCopy]) }
  const differentRails = circuitScheduleEditorItems(project, analysis([group('A1', 'A'), group('B1', 'B')]))
    .filter((item) => item.kind === 'differential')
  assert.equal(differentRails.length, 3)
  assert.equal(new Set(differentRails.map((item) => item.id)).size, 3)
})

test('resolves old main differential copies to the actual main cabinet rather than the topology root name', () => {
  const project = projectFixture()
  project.electricalProfile!.boards![0].id = 'actual-cabinet'
  project.electricalProfile!.boards![0].mainDifferential = { id: 'main', poles: 4, ratedCurrentA: 63, sensitivityMa: 300 }
  const old: Shape = { id: 'old-main', kind: 'symbol', name: 'Hoofddifferentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    generationKey: 'board:main:topology:v31:main-differential',
    electrical: { role: 'protection', oneWireEligible: true, poles: 4, breakerCurrentA: 63, rcdSensitivityMa: 300 } }
  const current = { ...old, id: 'current-main', generationKey: 'board:main:topology:v33:main-differential',
    electrical: { ...old.electrical, boardId: 'actual-cabinet' } }
  project.pages.schematic = { name: 'Eendraads', creationTime: 1, pageType: 'onewire', schema: schematicSchema([old, current]) }
  const items = refreshCircuitScheduleItems(project, [])
  assert.equal(items.length, 1)
  assert.equal(items[0].boardId, 'actual-cabinet')
  assert.equal(items[0].mainDifferential, true)
  assert.equal(items[0].sourceShapes!.length, 2)
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

test('packs 18- and 24-module cabinets independently while retaining the legacy default', () => {
  const items = circuitScheduleEditorItems(null, analysis([group('A1', 'A'), group('B1', 'B'), group('C1', 'C', 'garage'), group('D1', 'D', 'garage')]))
    .map((item) => ({ ...item, modules: 10, gapBefore: 0 }))
  const layout = { modulesPerRow: 18 as const, boardModulesPerRow: { garage: 24 as const } }
  assert.equal(packCircuitCabinetRows(items.filter((item) => item.boardId === 'main'), cabinetModulesPerRow(layout, 'main')).length, 2)
  assert.equal(packCircuitCabinetRows(items.filter((item) => item.boardId === 'garage'), cabinetModulesPerRow(layout, 'garage')).length, 1)
  assert.equal(packCircuitCabinetRows(items, cabinetModulesPerRow({ modulesPerRow: 24 }, 'main')).length, 2)
})

test('adds configured differentials to a cabinet and rejects a duplicate main protection', () => {
  const project = projectFixture()
  const protection = { id: 'new-diff', poles: 4, ratedCurrentA: 63, sensitivityMa: 30, railId: 'rail-1', type: 'A' as const }
  const next = addScheduleDifferential(project, 'main', protection)
  const items = refreshCircuitScheduleItems(next, circuitScheduleEditorItems(project, analysis([group('A1', 'A')])))
  assert.equal(items.filter((item) => item.kind === 'differential').length, 1)
  assert.deepEqual(items.find((item) => item.id === 'A')!.differentialIds, ['DIFF:main:new-diff'])
  assert.equal(project.electricalProfile!.boards![0].additionalDifferentials, undefined)
  assert.equal(next.pages, project.pages)
  const main = addScheduleDifferential(next, 'main', { ...protection, id: 'main' }, true)
  assert.throws(() => addScheduleDifferential(main, 'main', { ...protection, id: 'another' }, true), /al een hoofddifferentieel/)
})

test('adding a differential never absorbs existing topology or schematic devices with the same ratings', () => {
  const project = projectFixture()
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: false,
    additionalDifferentials: [{ count: 1, purpose: 'consumers', boardId: 'main', railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, poles: 2 }] }
  const diff: Shape = { id: 'existing-diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    electrical: { role: 'protection', oneWireEligible: true, boardId: 'main', railId: 'rail-1',
      poles: 2, breakerCurrentA: 40, rcdSensitivityMa: 30 } }
  project.pages.schematic = { name: 'Eendraads', creationTime: 1, pageType: 'onewire', schema: schematicSchema([diff]) }
  const initial = refreshCircuitScheduleItems(project, [])
  assert.equal(initial.length, 1)
  const next = addScheduleDifferential(project, 'main', { id: 'new', poles: 2, railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30 })
  const items = refreshCircuitScheduleItems(next, initial)
  assert.equal(items.length, 2)
  assert.equal(items.find((item) => item.protectionId === 'new')!.sourceShapes, undefined)
  assert.deepEqual(items.find((item) => item.topologyIndex === 0)!.sourceShapes, [{ pageKey: 'schematic', shapeId: diff.id }])
})

test('moving protections handles local ID collisions and prevents a second main differential from any source', () => {
  const project = projectFixture()
  const protection = { id: 'same', poles: 2, ratedCurrentA: 40, sensitivityMa: 30 }
  project.electricalProfile!.boards![0].additionalDifferentials = [protection]
  project.electricalProfile!.boards!.push({ id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }],
    additionalDifferentials: [{ ...protection }] })
  const items = refreshCircuitScheduleItems(project, [])
  const next = assignScheduleDifferential(project, items, 'DIFF:main:same', 'garage', 'rail-1')
  assert.deepEqual(next.electricalProfile!.boards![1].additionalDifferentials!.map((item) => item.id), ['same', 'same-2'])
  assert.equal(refreshCircuitScheduleItems(next, items).length, 2)
  project.electricalProfile!.boards![1].mainDifferential = { ...protection, id: 'garage-main' }
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: false,
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 } }
  assert.throws(() => assignScheduleDifferential(project, refreshCircuitScheduleItems(project, []),
    'DIFF:garage:MAIN', 'main'), /al een hoofddifferentieel/)
  const loose: Shape = { id: 'loose-main', kind: 'symbol', name: 'Hoofddifferentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    sourceLink: { kind: 'board', id: 'legacy', role: 'main-differential' },
    electrical: { role: 'protection', oneWireEligible: true, poles: 2, breakerCurrentA: 40, rcdSensitivityMa: 300 } }
  project.pages.loose = { name: 'Eendraads', creationTime: 1, pageType: 'onewire', schema: schematicSchema([loose]) }
  const withLoose = refreshCircuitScheduleItems(project, [])
  const schematicMain = withLoose.find((item) => item.sourceShapes?.some((source) => source.shapeId === loose.id))!
  assert.throws(() => assignScheduleDifferential(project, withLoose, schematicMain.id, 'garage'), /al een hoofddifferentieel/)
})

test('assigns every schematic copy of an unassigned differential without touching geometry or losing its saved slot', () => {
  const project = projectFixture()
  project.electricalProfile!.boards!.push({ id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }] })
  const diff: Shape = { id: 'loose-diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg', position: { x: 800, y: 1200 }, scale: 3,
    generationKey: 'board:legacy:loose-diff', strokeWidth: 0.75,
    electrical: { role: 'protection', oneWireEligible: true, poles: 4, breakerCurrentA: 40, rcdSensitivityMa: 30 } }
  const copy = { ...diff, id: 'copy-diff', position: { x: 900, y: 1100 } }
  project.pages.first = { name: 'Eendraads', creationTime: 1, pageType: 'onewire', schema: schematicSchema([diff]) }
  project.pages.second = { name: 'Vervolg', creationTime: 2, pageType: 'onewire', schema: schematicSchema([copy]) }
  const items = circuitScheduleEditorItems(project, analysis([]))
  const item = items[0]
  assert.equal(item.boardId, 'unassigned')
  assert.equal(item.sourceShapes!.length, 2)
  project.circuitScheduleLayout = { modulesPerRow: 18, boardModulesPerRow: { garage: 24 }, items: [{ id: item.id, gapBefore: 3 }] }
  const before = structuredClone(project)
  const next = assignScheduleDifferential(project, items, item.id, 'garage', 'rail-1')
  const moved = refreshCircuitScheduleItems(next, items)[0]
  assert.equal(moved.boardId, 'garage')
  assert.deepEqual(next.circuitScheduleLayout?.items, [{ id: moved.id, gapBefore: 3 }])
  assert.deepEqual(next.circuitScheduleLayout?.boardModulesPerRow, { garage: 24 })
  for (const [pageKey, original] of [['first', diff], ['second', copy]] as const) {
    const raw = next.pages[pageKey].schema.objects[0] as { payload: { shapes: Shape[] } }
    assert.deepEqual(raw.payload.shapes[0], { ...original, electrical: { ...original.electrical,
      boardId: 'garage', railId: 'rail-1', role: 'protection', oneWireEligible: true } })
  }
  assert.deepEqual(project, before)
  const locked = structuredClone(project)
  const raw = locked.pages.first.schema.objects[0] as { payload: { shapes: Shape[] } }
  raw.payload.shapes[0].locked = true
  assert.throws(() => assignScheduleDifferential(locked, items, item.id, 'garage'), /Ontgrendel/)
})

test('moves a single topology differential out of a counted group without duplicating protections', () => {
  const project = projectFixture()
  project.electricalProfile!.boards!.push({ id: 'garage', name: 'Garage', rails: [{ id: 'rail-1', name: 'Rail 1' }] })
  project.oneWireTopology = { version: 1, consumers: true, solar: false, residualBreaker: false,
    additionalDifferentials: [{ count: 2, purpose: 'consumers', boardId: 'main', railId: 'rail-1', ratedCurrentA: 40, sensitivityMa: 30, poles: 2 }] }
  const items = circuitScheduleEditorItems(project, analysis([]))
  const next = assignScheduleDifferential(project, items, items[0].id, 'garage', 'rail-1')
  const moved = refreshCircuitScheduleItems(next, items)
  assert.equal(moved.length, 2)
  assert.deepEqual(moved.map((item) => item.boardId), ['garage', 'main'])
  assert.equal(project.oneWireTopology.additionalDifferentials![0].count, 2)
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
  assert.equal(rows[4].protection, 'C32A')
  assert.equal(rows[4].poles, '4P')
  assert.equal(rows[4].cable, '5G6 mm² XGB LSOH')
  assert.deepEqual(analyzeCircuits(floorPlan).families, ['E'])
  const svg = buildCircuitScheduleSvgs(null, result).join('')
  for (const family of ['A', 'B', 'C', 'D', 'E']) assert.match(svg, new RegExp(`>${family}</text>`))
})

test('preserves explicit circuit settings over schematic values for floor-plan families', () => {
  const floorPlan: Shape[] = [{
    id: 'socket', kind: 'symbol', position: { x: 100, y: 100 }, name: 'Socket',
    path: 'symbols/Socket outlets/Wall outlet with grounding.svg', scale: 1, bindingId: 'A1'
  }]
  const result = analyzeCircuitSchedule(floorPlan, schematicCircuit('A'), undefined, {
    A: { breakerCurrentA: 20, poles: 2, cableSectionMm2: 2.5 }
  })
  const [row] = circuitScheduleRows(result)
  assert.equal(row.protection, 'C20A')
  assert.equal(row.poles, '2P')
  assert.equal(row.cable, '5G2.5 mm² XGB LSOH')
  assert.deepEqual(row.consumers, ['Socket'])
})

test('does not use a differential on the same circuit as its breaker settings', () => {
  const floorPlan: Shape[] = [{
    id: 'socket', kind: 'symbol', position: { x: 100, y: 100 }, name: 'Socket',
    path: 'symbols/Socket outlets/Wall outlet with grounding.svg', scale: 1, bindingId: 'A1'
  }]
  const differential: Shape = {
    id: 'diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    position: { x: 300, y: 300 }, scale: 1, bindingId: 'A1',
    electrical: { role: 'protection', oneWireEligible: true, breakerCurrentA: 40, poles: 2, rcdSensitivityMa: 30 }
  }
  const [row] = circuitScheduleRows(analyzeCircuitSchedule(floorPlan, [...schematicCircuit('A'), differential]))
  assert.equal(row.protection, 'C32A')
  assert.equal(row.poles, '4P')
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
