import assert from 'node:assert/strict'
import test from 'node:test'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import type { Shape } from '../src/editor/model/types.ts'

const symbol = (id: string): Shape => ({
  id,
  kind: 'symbol',
  position: { x: 10, y: 20 },
  name: 'Socket',
  path: 'socket.svg',
  scale: 1
})

test('normalizes binding ids without mutating input shapes', () => {
  const source = [symbol('one')]
  const updated = updateSelectionProperties(source, { bindingId: ' a1 ' }, {
    selectedIds: new Set(['one']),
    selectedId: 'one',
    groupedSelection: false
  })

  assert.equal(updated?.[0].bindingId, 'A1')
  assert.equal(source[0].bindingId, undefined)
})

test('keeps a grouped binding id only on the primary shape', () => {
  const updated = updateSelectionProperties([symbol('one'), symbol('two')], { bindingId: 'B2' }, {
    selectedIds: new Set(['one', 'two']),
    selectedId: 'one',
    groupedSelection: true
  })

  assert.equal(updated?.[0].bindingId, 'B2')
  assert.equal(updated?.[1].bindingId, undefined)
})

test('moves a selected shape by its visual center', () => {
  const updated = updateSelectionProperties([symbol('one')], { x: 50, y: 60 }, {
    selectedIds: new Set(['one']),
    selectedId: 'one',
    groupedSelection: false
  })

  assert.deepEqual(updated?.[0].kind === 'symbol' ? updated[0].position : null, { x: 50, y: 60 })
})

test('resizes a busbar symmetrically on the drawing grid', () => {
  const busbar: Shape = {
    id: 'busbar',
    kind: 'line',
    start: { x: 100, y: 200 },
    end: { x: 300, y: 200 },
    groupId: 'onewire-kamrail-main'
  }
  const updated = updateSelectionProperties([busbar], { busbarLength: 320 }, {
    selectedIds: new Set(['busbar']),
    selectedId: 'busbar',
    groupedSelection: false
  })

  assert.deepEqual(updated?.[0].kind === 'line' ? updated[0].start : null, { x: 40, y: 200 })
  assert.deepEqual(updated?.[0].kind === 'line' ? updated[0].end : null, { x: 360, y: 200 })
})

test('updates and clears selected symbol electrical properties', () => {
  const configured = { ...symbol('one'), electrical: { role: 'load' as const, oneWireEligible: true, breakerCurrentA: 16 } }
  const context = { selectedIds: new Set(['one']), selectedId: 'one', groupedSelection: false }
  const updated = updateSelectionProperties(
    [configured],
    { electrical: { breakerCurrentA: 20, cableSectionMm2: 2.5, breakerCurve: 'C', rcdSensitivityMa: 30, boardId: 'main', railId: 'rail-1' } },
    context
  )
  assert.equal(updated?.[0].kind === 'symbol' && updated[0].electrical?.breakerCurrentA, 20)
  assert.equal(updated?.[0].kind === 'symbol' && updated[0].electrical?.cableSectionMm2, 2.5)
  assert.equal(updated?.[0].kind === 'symbol' && updated[0].electrical?.rcdSensitivityMa, 30)
  const cleared = updateSelectionProperties(updated ?? [], { electrical: { breakerCurrentA: null } }, context)
  assert.equal(cleared?.[0].kind === 'symbol' && cleared[0].electrical?.breakerCurrentA, undefined)
})

test('updates visible protection labels together with standalone electrical properties', () => {
  const breaker: Shape = {
    id: 'breaker',
    kind: 'symbol',
    position: { x: 10, y: 20 },
    name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg',
    scale: 3,
    bindingId: 'C'
  }
  const updated = updateSelectionProperties(
    [breaker],
    {
      electrical: {
        breakerCurrentA: 25,
        hasProtectiveConductor: false,
        poles: 2,
        phaseConfiguration: 'L2+N'
      }
    },
    {
      selectedIds: new Set(['breaker']),
      selectedId: 'breaker',
      groupedSelection: false
    }
  )

  assert.deepEqual(updated?.[0].kind === 'symbol' ? updated[0].symbolTextOverrides : null, {
    poles: '2P',
    phase: 'L2N',
    'rated-current': '25A'
  })
  assert.equal(updated?.[0].kind === 'symbol' && updated[0].electrical?.hasProtectiveConductor, false)

  const hidden = updateSelectionProperties(
    updated ?? [],
    { electrical: { showPhaseLabel: false } },
    {
      selectedIds: new Set(['breaker']),
      selectedId: 'breaker',
      groupedSelection: false
    }
  )
  assert.equal(hidden?.[0].kind === 'symbol' ? hidden[0].symbolTextOverrides?.phase : null, '')
  assert.equal(hidden?.[0].kind === 'symbol' && hidden[0].electrical?.phaseConfiguration, 'L2+N')

  const fourPole = updateSelectionProperties(
    updated ?? [],
    { electrical: { poles: 4, phaseConfiguration: 'L1+L2+L3+N', showPhaseLabel: true } },
    {
      selectedIds: new Set(['breaker']),
      selectedId: 'breaker',
      groupedSelection: false
    }
  )
  assert.equal(fourPole?.[0].kind === 'symbol' ? fourPole[0].symbolTextOverrides?.phase : null, 'L1L2L3N')
})

test('renders RCD sensitivity and classification without replacing the serif I marker', () => {
  const residualBreaker: Shape = {
    id: 'rcd',
    kind: 'symbol',
    position: { x: 10, y: 20 },
    name: 'Residual-current circuit breaker',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    scale: 4,
    bindingId: 'RCD1'
  }
  const updated = updateSelectionProperties(
    [residualBreaker],
    { electrical: { rcdSensitivityMa: 30, rcdType: 'A' } },
    {
      selectedIds: new Set(['rcd']),
      selectedId: 'rcd',
      groupedSelection: false
    }
  )

  assert.equal(updated?.[0].kind === 'symbol' ? updated[0].symbolTextOverrides?.['residual-current'] : null, '30mA')
  assert.equal(updated?.[0].kind === 'symbol' ? updated[0].symbolTextOverrides?.['rcd-type'] : null, 'Type A')
  assert.equal(updated?.[0].kind === 'symbol' ? updated[0].symbolTextOverrides?.['device-type'] : undefined, undefined)
})
