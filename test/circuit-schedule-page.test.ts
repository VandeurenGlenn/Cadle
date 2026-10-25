import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCircuitScheduleSvgs, circuitScheduleRows } from '../src/editor/circuit-schedule-page.ts'
import type { CircuitAnalysis, CircuitGroup } from '../src/editor/circuit-analysis.ts'

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
