import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSocketSymbol,
  socketCopyOffsets,
  socketCountFromKeyboardEvent,
  withSocketCount
} from '../src/editor/socket-multiplicity.js'
import type { SymbolShape } from '../src/editor/model/types.js'

const socket: SymbolShape = {
  id: 'socket',
  kind: 'symbol',
  position: { x: 0, y: 0 },
  name: 'Wall outlet',
  path: '/symbols/Socket outlets/wall outlet.svg',
  scale: 1,
  electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets' }
}

test('number keys choose socket multiplicity without hijacking modified shortcuts', () => {
  assert.equal(socketCountFromKeyboardEvent({ key: '3', ctrlKey: false, metaKey: false, altKey: false }), 3)
  assert.equal(socketCountFromKeyboardEvent({ key: '3', ctrlKey: true, metaKey: false, altKey: false }), null)
  assert.equal(socketCountFromKeyboardEvent({ key: '0', ctrlKey: false, metaKey: false, altKey: false }), null)
})

test('socket multiplicity stays one selectable object and is visually centered', () => {
  assert.equal(isSocketSymbol(socket), true)
  const updated = withSocketCount(socket, 3) as SymbolShape
  assert.equal(updated.electrical?.socketCount, 3)
  assert.deepEqual(socketCopyOffsets(3, 20).map(value => Math.round(value * 10) / 10), [-9.2, 0, 9.2])
})
