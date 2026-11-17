import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuitSchedule, buildCircuitScheduleSvgs, circuitScheduleRows } from '../src/editor/circuit-schedule-page.ts'
import type { CircuitAnalysis, CircuitGroup } from '../src/editor/circuit-analysis.ts'
import { analyzeCircuits } from '../src/editor/circuit-analysis.ts'
import { buildKamrailCircuitBundle } from '../src/editor/layout/onewire-helpers.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../src/editor/layout/onewire-symbol-nodes.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'

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

test('groups point bindings into one breaker schedule cell', () => {
  const rows = circuitScheduleRows(analysis([group('A1', 'Socket'), group('A2', 'Socket'), group('B1', 'Lamp')]))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    id: 'A',
    boardId: 'main',
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
