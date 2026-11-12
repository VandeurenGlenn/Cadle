import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSocketSymbol,
  socketCopyOffsets,
  socketCountFromKeyboardEvent,
  withSocketCount
} from '../src/editor/socket-multiplicity.js'
import type { SymbolShape } from '../src/editor/model/types.js'
import { oneWireSocketConnector, oneWireSymbolBounds, oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.js'
import { symbolContentBounds } from '../src/editor/layout/symbol-layout.js'
import { shapeMarkup } from '../src/editor/export/svg-export.js'

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
  assert.deepEqual(socketCopyOffsets(3, 20), [-15, 0, 15])
  for (const count of [1, 2, 9]) {
    const offsets = socketCopyOffsets(count, 20)
    assert.equal(offsets.length, count)
    assert.ok(Math.abs(offsets[0] + offsets[offsets.length - 1]) < 1e-8)
  }
})

test('multiple socket copies have visible clearance and rotated layout bounds include every copy', () => {
  for (const variant of ['with grounding', 'with integrated safety shutter', 'with grounding and integrated safety shutter']) {
    for (const suffix of ['', ' for floorplan']) {
      const shape: SymbolShape = { ...socket, path: `symbols/Socket outlets/Wall outlet ${variant}${suffix}.svg`,
        scale: 1.05, electrical: { ...socket.electrical!, socketCount: 3 } }
      const single = oneWireSymbolBounds({ ...shape, electrical: { ...shape.electrical!, socketCount: 1 } })!
      const size = 24 * shape.scale, offsets = socketCopyOffsets(3, size, shape.path)
      const clearance = offsets[1] - offsets[0] - single.width
      assert.ok(clearance > 0, `${shape.path} copies should not overlap`)
      assert.ok(clearance < size * .08, `${shape.path} copies should remain close`)
      const bounds = oneWireSymbolBounds(shape)!
      assert.ok(Math.abs(bounds.width - single.width - (offsets[2] - offsets[0])) < 1e-8)
      const rotated = oneWireSymbolBounds({ ...shape, rotation: -90 })!
      assert.ok(Math.abs(rotated.height - bounds.width) < 1e-8)
      const content = symbolContentBounds({ ...shape, rotation: -90 })
      assert.ok(content.height + 1e-8 >= size + offsets[2] - offsets[0])
    }
  }
})

test('one-wire socket copies remain connected, including uncached SVG exports', () => {
  const shape: SymbolShape = { ...socket, path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg',
    groupId: 'onewire-test', rotation: -90, electrical: { ...socket.electrical!, socketCount: 3 } }
  const connector = oneWireSocketConnector(shape)!
  const node = oneWireSymbolNodeInfo(shape.path, shape.scale)!
  const offsets = socketCopyOffsets(3, 24 * shape.scale, shape.path)
  assert.equal(connector.start.x, shape.position.x + node.offset.x + offsets[0])
  assert.equal(connector.end.x, shape.position.x + node.offset.x + offsets[2])
  assert.equal(connector.start.y, shape.position.y + node.offset.y)
  assert.equal(oneWireSocketConnector({ ...shape, groupId: undefined }), null)
  const markup = shapeMarkup(shape, false)
  assert.equal((markup.match(/<image /g) ?? []).length, 3)
  assert.match(markup, /<line /)
})
