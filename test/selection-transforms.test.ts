import assert from 'node:assert/strict'
import test from 'node:test'
import { transformShapeForSelection } from '../src/editor/interaction/selection-transforms.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'

test('mirrors a door geometry and opening side through selection actions', () => {
  const door: Shape = {
    id: 'door',
    kind: 'door',
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  }
  const mirrored = transformShapeForSelection(door, { x: 50, y: 0 }, 'flip-horizontal')

  assert.equal(mirrored.kind, 'door')
  if (mirrored.kind !== 'door') return
  assert.deepEqual(mirrored.start, { x: 100, y: 0 })
  assert.deepEqual(mirrored.end, { x: 0, y: 0 })
  assert.equal(mirrored.flipSide, true)
  assert.equal(mirrored.rotation, 180)
})

test('mirrored selections keep rotated device terminals attached to their wires', () => {
  for (const rotation of [33, 90, 180, 270]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        for (const action of ['flip-horizontal', 'flip-vertical'] as const) {
          const device: Extract<Shape, { kind: 'symbol' }> = {
            id: 'device', kind: 'symbol', name: 'RCD',
            path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
            position: { x: 103, y: 207 }, scale: 2, rotation, flipX, flipY
          }
          const contact = oneWireSymbolConnectionAnchors(device)[0].point
          const wire: Shape = { id: 'wire', kind: 'line', start: contact, end: { x: contact.x + 50, y: contact.y + 70 } }
          const center = { x: 80, y: 150 }
          const actions = [device, wire].map((shape) => transformShapeForSelection(shape, center, action))
          const inspector = updateSelectionProperties([device, wire], action === 'flip-horizontal' ? { flipX: !flipX } : { flipY: !flipY }, {
            selectedIds: new Set(['device', 'wire']), selectedId: 'device', groupedSelection: true
          })!
          for (const [mirroredDevice, mirroredWire] of [actions, inspector]) {
            assert.ok(mirroredDevice.kind === 'symbol' && mirroredWire.kind === 'line')
            assert.ok(oneWireSymbolConnectionAnchors(mirroredDevice).some(({ point }) =>
              Math.hypot(point.x - mirroredWire.start.x, point.y - mirroredWire.start.y) < 1e-8
            ), `${action}: rotation ${rotation}, flips ${flipX}/${flipY}`)
          }
        }
      }
    }
  }
})
