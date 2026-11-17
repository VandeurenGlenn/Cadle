import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCircuits } from '../src/editor/circuit-analysis.ts'
import { namedRoomRegions, roomNameAtPoint } from '../src/editor/room-regions.ts'
import type { LineShape, Shape } from '../src/editor/model/types.ts'
import { cloneShapes, sanitizeShapes, scaleShape } from '../src/editor/model/model.ts'
import { circuitScheduleRows } from '../src/editor/circuit-schedule-page.ts'

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

test('uses explicit open-plan zones and preserves them through save, clone and scale', () => {
  const devices: Shape[] = ['Woonkamer', 'Keuken'].map((roomName, index) => ({
    id: `open-${index}`, kind: 'symbol', position: { x: 50 + index * 100, y: 50 },
    name: 'Socket', path: 'Socket.svg', scale: 1, bindingId: `A${index + 1}`,
    roomName, electrical: { role: 'load', oneWireEligible: true, circuitType: 'sockets' }
  }))
  const restored = sanitizeShapes(JSON.parse(JSON.stringify(cloneShapes(devices))), 'groundplan')
    .map((shape) => scaleShape(shape, 2, 2))
  const rows = circuitScheduleRows(analyzeCircuits(restored))
  assert.deepEqual(rows[0].rooms, ['Woonkamer', 'Keuken'])
  assert.equal(devices[0].roomName, 'Woonkamer')
})

test('explicit zones take priority over enclosing rooms and clearing restores automatic detection', () => {
  const socket: Shape = {
    id: 'socket', kind: 'image', position: { x: 50, y: 50 }, name: 'Socket', path: 'Socket.svg',
    width: 24, height: 24, bindingId: 'A1', roomName: 'Keuken'
  }
  assert.equal(analyzeCircuits([...room('Open leefruimte'), socket]).groups[0].components[0].roomName, 'Keuken')
  assert.equal(analyzeCircuits([...room('Open leefruimte'), { ...socket, roomName: '' }])
    .groups[0].components[0].roomName, 'Open leefruimte')
})
