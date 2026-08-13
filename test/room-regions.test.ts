import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuits } from '../src/editor/circuit-analysis.ts'
import { namedRoomRegions, roomNameAtPoint } from '../src/editor/room-regions.ts'
import type { LineShape, Shape } from '../src/editor/model/types.ts'

const room = (name: string): LineShape[] => {
  const points = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }]
  return points.map((start, index) => ({
    id: `wall-${index}`,
    kind: 'wall',
    start,
    end: points[(index + 1) % points.length],
    groupId: 'room-living',
    roomName: name
  }))
}

test('finds a named room at a drawing point', () => {
  const regions = namedRoomRegions(room('Living'))
  assert.equal(roomNameAtPoint(regions, { x: 100, y: 60 }), 'Living')
  assert.equal(roomNameAtPoint(regions, { x: 250, y: 60 }), undefined)
})

test('adds room names to bound circuit components', () => {
  const socket: Shape = {
    id: 'socket', kind: 'symbol', position: { x: 50, y: 50 }, name: 'Socket', path: 'Socket.svg', scale: 1,
    bindingId: 'A1', electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets' }
  }
  const analysis = analyzeCircuits([...room('Living'), socket])
  assert.equal(analysis.groups[0].components[0].roomName, 'Living')
})
