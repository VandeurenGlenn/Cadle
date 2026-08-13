import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCircuitScheduleSvgs, circuitScheduleRows } from '../src/editor/circuit-schedule-page.ts'
import type { CircuitAnalysis, CircuitGroup } from '../src/editor/circuit-analysis.ts'

const group = (bindingId: string, name: string): CircuitGroup => ({
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
    circuitType: 'sockets', breakerCurrentA: 20, cableSectionMm2: 2.5, cableConductors: 3,
    hasProtectiveConductor: true, cableType: 'VOB', cableInstallation: 'conduit', showCableInstallation: true,
    poles: 2, phaseConfiguration: 'L1+N', showPhaseLabel: true, breakerCurve: 'C', source: 'suggested',
    sources: { breakerCurrentA: 'suggested', cableSectionMm2: 'suggested', poles: 'suggested', phaseConfiguration: 'suggested' }
  }
})

const analysis = (groups: CircuitGroup[]): CircuitAnalysis => ({
  groups, issues: [], families: [...new Set(groups.map((entry) => entry.family))], totalGroups: groups.length,
  readyGroups: groups.length, errorCount: 0, warningCount: 0, valid: true
})

test('groups point bindings into one breaker schedule cell', () => {
  const rows = circuitScheduleRows(analysis([group('A1', 'Socket'), group('A2', 'Socket'), group('B1', 'Lamp')]))
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    id: 'A', protection: 'C20A', poles: '2P', cable: '3G2.5 mm² VOB', consumers: ['Socket ×2'], rooms: [],
    category: 'Stopcontacten', modules: 2
  })
})

test('paginates a 24-module portrait schedule using actual breaker widths', () => {
  const groups = Array.from({ length: 61 }, (_, index) => group(`C${index + 1}X1`, `Load ${index + 1}`))
  const pages = buildCircuitScheduleSvgs(null, analysis(groups))
  assert.equal(pages.length, 2)
  assert.match(pages[0], /VERDEELBORD · KRINGENOVERZICHT/)
  assert.match(pages[1], />2\/2<\/text>/)
})

test('supports an 18-module distribution board', () => {
  const groups = Array.from({ length: 46 }, (_, index) => group(`C${index + 1}X1`, `Load ${index + 1}`))
  const pages = buildCircuitScheduleSvgs(
    { name: 'Test', circuitScheduleLayout: { modulesPerRow: 18 } } as never,
    analysis(groups)
  )
  assert.equal(pages.length, 2)
})
