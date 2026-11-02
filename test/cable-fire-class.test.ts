import assert from 'node:assert/strict'
import test from 'node:test'
import { cableLabelText, connectionLabel, sanitizeConnection } from '../src/editor/model/electrical-connection.ts'
import { sanitizeElectricalMetadata } from '../src/editor/model/electrical.ts'
import { applyOneWireCircuitPresentation } from '../src/editor/layout/onewire-circuit-presentation.ts'
import { presentConnectionLabels } from '../src/editor/layout/connection-label-presentation.ts'
import type { Shape } from '../src/editor/model/types.ts'
import { validateOneWireTopology } from '../src/editor/onewire-topology-schema.ts'

const fireClass = 'Cca-s1,d2,a1'
test('formats optional fire classes without repeating the legacy class', () => {
  const cable = { conductors: 3, sectionMm2: 2.5, cableType: 'XVB-Cca' }
  assert.equal(cableLabelText(cable), '3G2.5 mm² XVB Cca')
  assert.equal(cableLabelText({ ...cable, fireClass }), `3G2.5 mm² XVB ${fireClass}`)
  assert.equal(cableLabelText({ ...cable, fireClass: '' }), cableLabelText(cable))
  assert.equal(connectionLabel({ kind: 'wire', sectionMm2: 1.5, cableType: 'VOB', fireClass }), `1.5 mm² VOB ${fireClass}`)
  assert.equal(connectionLabel({ kind: 'cable', name: 'Voeding keuken', fireClass }), `Voeding keuken ${fireClass}`)
  assert.equal(connectionLabel({ kind: 'cable', fireClass, showLabel: false }), '')
  assert.equal(sanitizeConnection(JSON.parse(JSON.stringify({ kind: 'cable', fireClass: ` ${fireClass} ` })))?.fireClass, fireClass)
  assert.equal(sanitizeElectricalMetadata({ role: 'load', oneWireEligible: true, cableFireClass: ` ${fireClass} ` })?.cableFireClass, fireClass)
})

test('keeps generated captions and conductor properties in sync and supports clearing', () => {
  const shapes: Shape[] = [
    { id: 'caption', kind: 'text', position: { x: 0, y: 0 }, text: 'old', sourceLink: { kind: 'board', id: 'A', role: 'cable-section' } },
    { id: 'cable', kind: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 100 },
      connection: { kind: 'cable', labelOwner: 'circuit', cableType: 'XVB-Cca' }, sourceLink: { kind: 'board', id: 'A', role: 'trunk' } }
  ]
  const result = applyOneWireCircuitPresentation({ shapes, circuitKey: 'A', stored: { cableType: 'XVB-Cca', cableSectionMm2: 2.5, cableFireClass: fireClass } })
  assert.equal(result.shapes[0].kind === 'text' && result.shapes[0].text, `3G2.5 mm² XVB ${fireClass}`)
  assert.equal(result.shapes[1].kind === 'line' && result.shapes[1].connection?.fireClass, fireClass)
  const cleared = applyOneWireCircuitPresentation({ shapes: result.shapes, circuitKey: 'A', stored: { cableType: 'XVB-Cca', cableSectionMm2: 2.5 } })
  assert.equal(cleared.shapes[0].kind === 'text' && cleared.shapes[0].text, '3G2.5 mm² XVB Cca')
  const topology = shapes.map((shape) => shape.kind === 'line'
    ? { ...shape, connection: { ...shape.connection!, conductors: 4, sectionMm2: 10, fireClass, labelOwner: 'topology' as const } }
    : { ...shape, sourceLink: { kind: 'board' as const, id: 'A', role: 'incoming-cable-label' } })
  const caption = presentConnectionLabels(topology)[0]
  assert.equal(caption.kind === 'text' && caption.text, `4x10 mm² XVB ${fireClass}`)
})

test('allows the optional fire class in the topology JSON', () => {
  const value = { version: 1, incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB', fireClass },
    residualBreaker: false, solar: false, consumers: true }
  assert.equal(validateOneWireTopology(value).valid, true)
  assert.equal(validateOneWireTopology({ ...value, incomingCable: { ...value.incomingCable, fireClass: 42 } }).valid, false)
})
