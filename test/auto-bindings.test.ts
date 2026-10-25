import assert from 'node:assert/strict'
import test from 'node:test'
import { planAutomaticBindings } from '../src/editor/auto-bindings.ts'
import type { ElectricalCircuitType, ElectricalRole } from '../src/editor/model/electrical.ts'
import type { Shape } from '../src/editor/model/types.ts'

const symbol = (
  id: string,
  x: number,
  y: number,
  role: ElectricalRole,
  circuitType: ElectricalCircuitType,
  bindingId?: string
): Shape => ({
  id,
  kind: 'symbol',
  position: { x, y },
  name: circuitType === 'sockets' ? 'Socket outlet' : role === 'switch' ? 'Switch' : 'Light',
  path: `${circuitType}-${role}.svg`,
  scale: 1,
  bindingId,
  electrical: { role, circuitType, oneWireEligible: true }
})

test('spatially distributes lights and binds switches to the nearest light point', () => {
  const shapes = [
    symbol('light-1', 0, 0, 'load', 'lighting'),
    symbol('switch-1', 10, 0, 'switch', 'lighting'),
    symbol('light-2', 40, 0, 'load', 'lighting'),
    symbol('light-3', 500, 0, 'load', 'lighting'),
    symbol('switch-3', 490, 0, 'switch', 'lighting'),
    symbol('light-4', 540, 0, 'load', 'lighting')
  ]

  const plan = planAutomaticBindings(shapes, 2)
  const firstLight = plan.assignments.get('light-1')
  const distantLight = plan.assignments.get('light-3')

  assert.equal(plan.lightingCircuitCount, 2)
  assert.equal(plan.assignments.get('switch-1'), firstLight)
  assert.equal(plan.assignments.get('switch-3'), distantLight)
  assert.notEqual(firstLight?.replace(/\d+$/, ''), distantLight?.replace(/\d+$/, ''))
})

test('fills a socket circuit up to eight points regardless of distance', () => {
  const shapes = [
    symbol('socket-1', 0, 0, 'load', 'sockets'),
    symbol('socket-2', 80, 0, 'load', 'sockets'),
    symbol('socket-3', 500, 0, 'load', 'sockets')
  ]

  const plan = planAutomaticBindings(shapes, 1)
  const family = (id: string) => plan.assignments.get(id)?.replace(/\d+$/, '')

  assert.equal(plan.socketCircuitCount, 1)
  assert.equal(family('socket-1'), family('socket-2'))
  assert.equal(family('socket-1'), family('socket-3'))
})

test('starts a second socket circuit only after eight points', () => {
  const shapes = Array.from({ length: 9 }, (_, index) =>
    symbol(`socket-${index + 1}`, index * 40, 0, 'load', 'sockets')
  )

  const plan = planAutomaticBindings(shapes, 1)
  const families = new Set(shapes.map((shape) => plan.assignments.get(shape.id)?.replace(/\d+$/, '')))

  assert.equal(plan.socketCircuitCount, 2)
  assert.equal(families.size, 2)
})

test('counts a grouped symbol assembly as one point and assigns one binding ID', () => {
  const groupedLeft = symbol('grouped-left', 0, 0, 'load', 'sockets')
  const groupedRight = symbol('grouped-right', 20, 0, 'load', 'sockets')
  groupedLeft.groupId = 'group-double-socket'
  groupedRight.groupId = 'group-double-socket'
  const standalone = Array.from({ length: 7 }, (_, index) =>
    symbol(`socket-${index + 1}`, 80 + index * 40, 0, 'load', 'sockets')
  )

  const plan = planAutomaticBindings([groupedLeft, groupedRight, ...standalone], 1)

  assert.equal(plan.socketCircuitCount, 1)
  assert.equal(plan.assignments.get('grouped-left'), 'A1')
  assert.equal(plan.assignments.has('grouped-right'), false)
  assert.equal(plan.assignments.size, 8)
})

test('preserves existing labels and does not reuse their circuit family', () => {
  const shapes = [symbol('existing', 0, 0, 'load', 'lighting', 'A1'), symbol('new', 300, 0, 'load', 'lighting')]

  const plan = planAutomaticBindings(shapes, 1)

  assert.equal(plan.assignments.has('existing'), false)
  assert.equal(plan.assignments.get('new'), 'B1')
})

test('recognizes legacy sockets whose stored role is neutral', () => {
  const legacySocket = symbol('legacy-socket', 0, 0, 'neutral', 'sockets')
  legacySocket.name = 'Socket outlet'
  legacySocket.path = 'symbols/Socket outlets/socket.svg'
  legacySocket.electrical = { role: 'neutral', oneWireEligible: true }

  const plan = planAutomaticBindings([legacySocket], 1)

  assert.equal(plan.assignments.get('legacy-socket'), 'A1')
  assert.equal(plan.socketCircuitCount, 1)
})
