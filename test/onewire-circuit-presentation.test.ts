import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOneWireCircuitPresentation,
  circuitKeyForShape,
  effectiveStandaloneCircuitElectrical,
  updateCircuitSpecifications
} from '../src/editor/layout/onewire-circuit-presentation.ts'
import type { Shape, SymbolShape, TextShape } from '../src/editor/model/types.ts'

const linkedText = (id: string, role: string, text: string): TextShape => ({
  id,
  kind: 'text',
  position: { x: 0, y: 0 },
  text,
  sourceLink: { kind: 'board', id: 'A', role }
})

test('derives a stable circuit key from generated and bound shapes', () => {
  const generated: Shape = linkedText('current', 'breaker-current', 'C20A')
  const bound: Shape = {
    id: 'load',
    kind: 'symbol',
    position: { x: 0, y: 0 },
    name: 'Socket',
    path: 'symbols/Socket outlets/Electrical wall outlet.svg',
    scale: 1,
    bindingId: 'a12'
  }

  assert.equal(circuitKeyForShape(generated), 'A')
  assert.equal(circuitKeyForShape(bound), 'A')
})

test('updates circuit specifications immutably and excludes runtime metadata', () => {
  const current = { A: { breakerCurrentA: 20, breakerCurve: 'C' as const } }
  const result = updateCircuitSpecifications(current, ' a ', {
    breakerCurrentA: 25,
    breakerCurve: 'D',
    role: 'protection',
    oneWireEligible: true
  })

  assert.deepEqual(current.A, { breakerCurrentA: 20, breakerCurve: 'C' })
  assert.deepEqual(result, {
    circuitKey: 'A',
    circuitSpecifications: { A: { breakerCurrentA: 25, breakerCurve: 'D' } }
  })
  assert.deepEqual(updateCircuitSpecifications({ A: { breakerCurrentA: 20 } }, 'A', { breakerCurrentA: null }), {
    circuitKey: 'A',
    circuitSpecifications: {}
  })
})

test('applies stored circuit values to generated labels and cable symbols', () => {
  const shapes: Shape[] = [
    linkedText('poles', 'breaker-poles', '4P'),
    linkedText('current', 'breaker-current', 'C20A'),
    linkedText('phase', 'breaker-phase', ''),
    linkedText('cable', 'cable-section', '3G2.5 mm² VOB'),
    linkedText('installation-label', 'cable-installation-label', 'In conduit, recessed in wall'),
    {
      id: 'installation',
      kind: 'symbol',
      position: { x: 0, y: 0 },
      name: 'Cable conduit recessed',
      path: 'symbols/Installation methods/Cable in conduit recessed in wall.svg',
      scale: 2,
      sourceLink: { kind: 'board', id: 'A', role: 'cable-installation' }
    },
    linkedText('other', 'breaker-current', 'C16A')
  ]
  shapes[6].sourceLink = { kind: 'board', id: 'B', role: 'breaker-current' }

  const result = applyOneWireCircuitPresentation({
    shapes,
    circuitKey: 'A',
    stored: {
      breakerCurrentA: 25,
      breakerCurve: 'D',
      cableSectionMm2: 4,
      cableConductors: 4,
      hasProtectiveConductor: true,
      cableType: 'XVB-Cca',
      cableInstallation: 'underground',
      poles: 2,
      phaseConfiguration: 'L2+N',
      neutralPosition: 'right',
      showPhaseLabel: true
    }
  })

  assert.equal(result.changed, true)
  assert.equal((result.shapes[0] as TextShape).text, '2P')
  assert.equal((result.shapes[1] as TextShape).text, 'D25A')
  assert.equal((result.shapes[2] as TextShape).text, 'L2-N')
  assert.equal((result.shapes[3] as TextShape).text, '4G4 mm² XVB Cca')
  assert.equal((result.shapes[4] as TextShape).text, 'Underground')
  assert.equal(result.shapes[4].hidden, true)
  assert.equal(result.shapes[5].hidden, false)
  assert.match((result.shapes[5] as SymbolShape).path, /underground/i)
  assert.equal(result.shapes[5].scale, 2.25)
  assert.strictEqual(result.shapes[6], shapes[6])
  const hidden = applyOneWireCircuitPresentation({
    shapes: result.shapes,
    circuitKey: 'A',
    stored: { showCableInstallation: false }
  })
  assert.equal(hidden.shapes[4].hidden, true)
  assert.equal(hidden.shapes[5].hidden, true)
  assert.doesNotMatch((hidden.shapes[3] as TextShape).text, /conduit|Underground/)
})

test('keeps the conductor mark anchored when switching installation methods', () => {
  const installation: SymbolShape = {
    id: 'installation',
    kind: 'symbol',
    name: 'Cable conduit',
    path: 'symbols/Wires/Cable in conduit.svg',
    scale: 2.25,
    position: { x: 395, y: 500 },
    sourceLink: { kind: 'board', id: 'A', role: 'cable-installation' }
  }
  const underground = applyOneWireCircuitPresentation({
    shapes: [installation],
    circuitKey: 'A',
    stored: { cableInstallation: 'underground' }
  })
  const updated = underground.shapes[0]
  assert.ok(updated.kind === 'symbol')
  assert.deepEqual(updated.position, { x: 393, y: 500 })
  const restored = applyOneWireCircuitPresentation({
    shapes: underground.shapes,
    circuitKey: 'A',
    stored: { cableInstallation: 'conduit' }
  })
  assert.ok(restored.shapes[0].kind === 'symbol')
  assert.deepEqual(restored.shapes[0].position, installation.position)
})

test('resolves standalone inspector values from project metadata', () => {
  const breaker: SymbolShape = {
    id: 'breaker',
    kind: 'symbol',
    position: { x: 0, y: 0 },
    name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg',
    scale: 2.8,
    bindingId: 'A1'
  }

  const electrical = effectiveStandaloneCircuitElectrical(
    breaker,
    {
      A: {
        breakerCurrentA: 25,
        cableConductors: 4,
        phaseConfiguration: 'L2+N',
        poles: 2
      }
    },
    {
      standard: 'AREI',
      edition: '2025',
      distributor: 'Fluvius',
      supplyConfiguration: '3x400V+N',
      supplyVoltageV: 400,
      phaseConfiguration: 'L1+L2+L3+N',
      earthingSystem: 'TT',
      defaultPoles: 4
    }
  )

  assert.equal(electrical.breakerCurrentA, 25)
  assert.equal(electrical.cableConductors, 4)
  assert.equal(electrical.phaseConfiguration, 'L2+N')
  assert.equal(electrical.poles, 2)
})
