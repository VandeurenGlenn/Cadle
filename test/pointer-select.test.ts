import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allowsExistingShapeSelection,
  dragIdsForSelectedShape,
  shouldSelectExistingOneWireShape
} from '../src/editor/interaction/pointer-select.ts'
import type { Shape } from '../src/editor/model/types.ts'

test('drags one-wire breaker labels together with their breaker', () => {
  const shapes: Shape[] = [
    {
      id: 'breaker',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Automaat',
      path: 'symbols/Protection devices/Automaat.svg',
      scale: 3,
      groupId: 'onewire-breaker-a',
      sourceLink: { kind: 'board', id: 'A', role: 'breaker' }
    },
    {
      id: 'current-label',
      kind: 'text',
      position: { x: 110, y: 100 },
      text: 'C20A',
      groupId: 'onewire-breaker-a',
      sourceLink: { kind: 'board', id: 'A', role: 'breaker-current' }
    },
    {
      id: 'phase-label',
      kind: 'text',
      position: { x: 90, y: 120 },
      text: 'L1N',
      groupId: 'onewire-breaker-a',
      sourceLink: { kind: 'board', id: 'A', role: 'breaker-phase' }
    },
    {
      id: 'other-row',
      kind: 'line',
      start: { x: 100, y: 50 },
      end: { x: 180, y: 50 },
      groupId: 'onewire-row-a1'
    }
  ]

  assert.deepEqual(
    new Set(dragIdsForSelectedShape(shapes, 'breaker', new Set(['breaker']))),
    new Set(['breaker', 'current-label', 'phase-label'])
  )
})

test('keeps ordinary one-wire symbols individually draggable', () => {
  const shapes: Shape[] = [
    {
      id: 'socket',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Socket',
      path: 'symbols/Socket outlets/Socket.svg',
      scale: 1,
      groupId: 'onewire-row-a1'
    },
    {
      id: 'row-wire',
      kind: 'line',
      start: { x: 80, y: 100 },
      end: { x: 120, y: 100 },
      groupId: 'onewire-row-a1'
    }
  ]

  assert.deepEqual(dragIdsForSelectedShape(shapes, 'socket', new Set(['socket'])), ['socket'])
})

test('selects an existing group instead of running one-wire preset placement', () => {
  const groupShape: Shape = {
    id: 'group-symbol',
    kind: 'symbol',
    position: { x: 100, y: 100 },
    name: 'Socket',
    path: 'symbols/Socket outlets/Socket.svg',
    scale: 1,
    groupId: 'onewire-row-a1'
  }

  assert.equal(shouldSelectExistingOneWireShape(groupShape, false), true)
  assert.equal(shouldSelectExistingOneWireShape(groupShape, true), false)
  assert.equal(shouldSelectExistingOneWireShape(null, false), false)
})

test('does not select existing objects while using an architectural drawing tool', () => {
  for (const tool of ['wall', 'room', 'door', 'window', 'gate', 'line', 'rect', 'circle', 'arc', 'text'] as const) {
    assert.equal(allowsExistingShapeSelection(tool, false), false, tool)
  }
  assert.equal(allowsExistingShapeSelection('select', false), true)
  assert.equal(allowsExistingShapeSelection('symbol', true), false)
})
