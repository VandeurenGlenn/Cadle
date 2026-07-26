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
