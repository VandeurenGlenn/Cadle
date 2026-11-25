import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOneWireCircuitPresentation,
  circuitKeyForShape,
  effectiveStandaloneCircuitElectrical,
  updateCircuitSpecifications
} from '../src/editor/layout/onewire-circuit-presentation.ts'
import type { Shape, SymbolShape, TextShape } from '../src/editor/model/types.ts'
import { oneWireSymbolNodeInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import { symbolTextPresentation } from '../src/editor/symbol-metadata.ts'

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

test('keeps a manually placed differential independent from its connected circuit specifications', () => {
  const differential: SymbolShape = {
    id: 'diff', kind: 'symbol', name: 'Differentieel',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    position: { x: 300, y: 500 }, scale: 4, bindingId: 'A1',
    sourceLink: { kind: 'circuit', id: 'A1', role: 'inline' },
    electrical: { role: 'protection', oneWireEligible: true, breakerCurrentA: 40, rcdSensitivityMa: 30, rcdType: 'A' }
  }
  const circuits = { A1: { breakerCurrentA: 16, rcdSensitivityMa: 300 } }
  assert.equal(circuitKeyForShape(differential), null)
  const effective = effectiveStandaloneCircuitElectrical(differential, circuits)
  assert.equal(effective.breakerCurrentA, 40)
  assert.equal(effective.rcdSensitivityMa, 30)
  const result = applyOneWireCircuitPresentation({ shapes: [differential], circuitKey: 'A1', stored: circuits.A1 })
  assert.deepEqual(result.shapes, [differential])
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

test('manual and generated circuit protections keep the same breaker curve when values change', () => {
  const symbol: SymbolShape = { id: 'manual', kind: 'symbol', name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg', position: { x: 300, y: 500 }, scale: 4, bindingId: 'A1',
    electrical: { role: 'protection', oneWireEligible: true, breakerCurve: 'C', breakerCurrentA: 16 } }
  const result = applyOneWireCircuitPresentation({ shapes: [symbol, linkedText('current', 'breaker-current', 'C16A')],
    circuitKey: 'A', stored: { breakerCurrentA: 25, breakerCurve: 'D' } })
  assert.equal((result.shapes[0] as SymbolShape).symbolTextOverrides?.['rated-current'], 'D25A')
  assert.equal((result.shapes[1] as TextShape).text, 'D25A')
  assert.match(symbolTextPresentation(result.shapes[0] as SymbolShape).annotations, />D25A<\/text>/)
})

test('editing poles preserves unedited native ratings and updates generated breaker metadata without duplicating its labels', () => {
  const breaker: SymbolShape = {
    id: 'breaker', kind: 'symbol', name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg',
    position: { x: 300, y: 500 }, scale: 4, bindingId: 'A',
    sourceLink: { kind: 'board', id: 'A', role: 'breaker' },
    electrical: { role: 'protection', oneWireEligible: true, breakerCurrentA: 32, breakerCurve: 'D',
      cableSectionMm2: 6, cableConductors: 5, hasProtectiveConductor: true, poles: 2 },
    symbolTextOverrides: { poles: '', 'rated-current': '', phase: '' }
  }
  const result = applyOneWireCircuitPresentation({
    shapes: [breaker, linkedText('current', 'breaker-current', 'D32A')],
    circuitKey: 'A', stored: { poles: 4 }
  })
  const updated = result.shapes.find((shape) => shape.id === breaker.id) as SymbolShape
  assert.equal(updated.electrical?.poles, 4)
  assert.equal(updated.electrical?.breakerCurrentA, 32)
  assert.equal(updated.electrical?.cableSectionMm2, 6)
  assert.equal(updated.electrical?.cableConductors, 5)
  assert.deepEqual(updated.symbolTextOverrides, breaker.symbolTextOverrides)
  assert.equal((result.shapes.find((shape) => shape.id === 'current') as TextShape).text, 'D32A')
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
  assert.equal(result.shapes[5].scale, 4.5)
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
  const anchor = (shape: SymbolShape) => {
    const node = oneWireSymbolNodeInfo(shape.path, shape.scale)!.offset
    return { x: shape.position.x + node.x, y: shape.position.y + node.y }
  }
  assert.deepEqual(anchor(updated), anchor(installation))
  const restored = applyOneWireCircuitPresentation({
    shapes: underground.shapes,
    circuitKey: 'A',
    stored: { cableInstallation: 'conduit' }
  })
  assert.ok(restored.shapes[0].kind === 'symbol')
  assert.deepEqual(anchor(restored.shapes[0]), anchor(installation))
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
  assert.equal(effectiveStandaloneCircuitElectrical(breaker, {}, {
    standard: 'AREI', edition: '2025', distributor: 'Fluvius', supplyConfiguration: '3x400V+N',
    supplyVoltageV: 400, phaseConfiguration: 'L1+L2+L3+N', earthingSystem: 'TT', defaultPoles: 4
  }).poles, 2)
  assert.equal(effectiveStandaloneCircuitElectrical({
    ...breaker, electrical: { role: 'protection', oneWireEligible: true, poles: 4 }
  }).poles, 4)
})

test('does not label a 2P breaker with the three-phase supply', () => {
  const result = applyOneWireCircuitPresentation({
    shapes: [linkedText('phase', 'breaker-phase', 'L1-L2-L3-N')],
    circuitKey: 'A',
    stored: { poles: 2, phaseConfiguration: 'L1+L2+L3+N' }
  })
  assert.equal((result.shapes[0] as TextShape).text, '')
})
