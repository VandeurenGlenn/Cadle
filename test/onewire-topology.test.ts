import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneWireTopology } from '../src/editor/layout/onewire-topology.ts'

const ids = () => {
  let id = 0
  return () => `topology-${++id}`
}

test('draws the solar branch beside the residual-breaker path after the main differential', () => {
  const shapes = buildOneWireTopology({
    version: 1,
    incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' },
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
    residualBreaker: true,
    solar: true,
    consumers: true,
    solarPlacement: 'parallel-after-main-differential'
  }, {
    start: { x: 80, y: 700 },
    end: { x: 920, y: 700 }
  }, ids())

  const roles = new Set(shapes.map((shape) => shape.sourceLink?.role))
  assert.ok(roles.has('meter'))
  assert.ok(roles.has('main-differential'))
  assert.ok(roles.has('residual-breaker'))
  assert.ok(roles.has('solar-branch'))
  assert.ok(roles.has('solar-inverter'))
  assert.ok(roles.has('residual-to-rail'))
  assert.ok(shapes.every((shape) => shape.groupId?.startsWith('onewire-topology-')))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === '4x10 mm² EXVB'))
  assert.ok(shapes.some((shape) => shape.kind === 'text' && shape.text === '40 A / 300 mA'))
})
