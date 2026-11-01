import assert from 'node:assert/strict'
import test from 'node:test'
import { presentInheritedPhaseLabels } from '../src/editor/layout/inherited-phase-labels.ts'
import { oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import { createVisualTestProject, VISUAL_TEST_ONEWIRE_PAGE_KEY, VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY } from '../src/data/visual-test-project.ts'
import { nativeStateForProjectPage } from '../src/data/project-document.ts'
import type { LineShape, Shape, SymbolShape } from '../src/editor/model/types.ts'

const breaker = (id: string, x: number, bottomY: number, poles: number, phase: string): SymbolShape => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const bottom = oneWireSymbolTerminalInfo(path, 4)!.bottom!
  return { id, kind: 'symbol', name: id, path, scale: 4,
    position: { x: x - bottom.x, y: bottomY - bottom.y },
    electrical: { role: 'protection', oneWireEligible: true, poles },
    symbolTextOverrides: { poles: `${poles}P`, phase }
  }
}
const wire = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): LineShape => ({ id, kind: 'line', start, end })
const phase = (shapes: Shape[], id: string) => (shapes.find((shape) => shape.id === id) as SymbolShape).symbolTextOverrides?.phase

test('a bridge conducts through its raised route without connecting an endpoint on the bypassed straight line', () => {
  const upstream = breaker('upstream', 0, 300, 2, 'N-L1')
  const downstream = breaker('downstream', 200, 150, 2, 'N-L1')
  const start = oneWireSymbolConnectionAnchors(upstream)[0].point
  const midpoint = { x: 100, y: (start.y + 150) / 2 }
  const unrelated = breaker('unrelated', midpoint.x, midpoint.y, 2, 'N-L3')
  const source: Shape[] = [upstream, downstream, unrelated,
    { ...wire('bus', { x: -100, y: 400 }, { x: 300, y: 400 }), groupId: 'onewire-kamrail-bus' },
    wire('feed', { x: 0, y: 400 }, { x: 0, y: 300 }),
    { ...wire('bridge', start, { x: 200, y: 150 }), connection: { kind: 'bridge', offsetMm: 3 } }]
  const shown = presentInheritedPhaseLabels(source)
  assert.equal(phase(shown, 'downstream'), '')
  assert.equal(phase(shown, 'unrelated'), 'N-L3')
})

const branches = (): Shape[] => {
  const a = breaker('a', 0, 300, 2, 'N-L1')
  const b = breaker('b', 0, 150, 2, 'N-L1')
  const c = breaker('c', 200, 300, 3, 'N-L2')
  const d = breaker('d', 200, 150, 2, 'N-L2')
  const top = (shape: SymbolShape) => oneWireSymbolConnectionAnchors(shape)[0].point
  return [
    { ...wire('bus', { x: -100, y: 400 }, { x: 300, y: 400 }), groupId: 'onewire-kamrail-bus' },
    a, b, c, d,
    wire('a-feed', { x: 0, y: 400 }, { x: 0, y: 300 }),
    wire('a-b', top(a), { x: 0, y: 150 }),
    wire('c-feed', { x: 200, y: 400 }, { x: 200, y: 300 }),
    wire('c-d', top(c), { x: 200, y: 150 })
  ]
}

test('hides phases only after a connected 2P, without affecting a parallel branch', () => {
  const source = branches()
  const before = structuredClone(source)
  const result = presentInheritedPhaseLabels(source)
  assert.equal(phase(result, 'a'), 'N-L1')
  assert.equal(phase(result, 'b'), '')
  assert.equal(phase(result, 'c'), 'N-L2')
  assert.equal(phase(result, 'd'), 'N-L2')
  assert.deepEqual(source, before)
  const changed = source.map((shape) => shape.id === 'a' && shape.kind === 'symbol'
    ? { ...shape, electrical: { ...shape.electrical!, poles: 4 } } : shape)
  assert.equal(phase(presentInheritedPhaseLabels(changed), 'b'), 'N-L1')
})

test('follows rotated conductors and terminal positions', () => {
  const rotated = branches().map((shape): Shape => {
    const turn = ({ x, y }: { x: number; y: number }) => ({ x: -y, y: x })
    return shape.kind === 'line' ? { ...shape, start: turn(shape.start), end: turn(shape.end) }
      : shape.kind === 'symbol' ? { ...shape, position: turn(shape.position), rotation: 90 } : shape
  })
  assert.equal(phase(presentInheritedPhaseLabels(rotated), 'b'), '')
  assert.equal(phase(presentInheritedPhaseLabels(rotated), 'd'), 'N-L2')
})

test('recognizes protection devices placed inline over a continuous conductor', () => {
  const source = branches().filter((shape) => !['a-feed', 'a-b'].includes(shape.id))
  const b = source.find((shape) => shape.id === 'b') as SymbolShape
  source.push(wire('continuous-feed', { x: 0, y: 400 }, oneWireSymbolConnectionAnchors(b)[0].point))
  const result = presentInheritedPhaseLabels(source)
  assert.equal(phase(result, 'a'), 'N-L1')
  assert.equal(phase(result, 'b'), '')
})

test('suppresses the redundant incoming main 2P phase as well as downstream differentials', () => {
  const project = createVisualTestProject()
  const source = nativeStateForProjectPage(project, VISUAL_TEST_ONEWIRE_PAGE_KEY)!.shapes
  const result = presentInheritedPhaseLabels(source, project)
  for (const shape of result.filter((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.electrical?.role === 'protection')) {
    assert.equal(shape.symbolTextOverrides?.phase, '')
  }
  const main = source.find((shape) => shape.sourceLink?.role === 'main-switch') as SymbolShape
  assert.equal(main.symbolTextOverrides?.phase, 'N-L1')
  const changed = source.map((shape) => shape.id === main.id
    ? { ...main, electrical: { ...main.electrical!, poles: 3 } } : shape)
  assert.equal(phase(presentInheritedPhaseLabels(changed, project), main.id), 'N-L1')
})

test('inherits the supply of a circuit sheet without erasing its stored phase label', () => {
  const project = createVisualTestProject()
  const source = nativeStateForProjectPage(project, VISUAL_TEST_ONEWIRE_CIRCUITS_PAGE_KEY)!.shapes
  const phases = source.filter((shape) => shape.kind === 'text' && shape.sourceLink?.role === 'breaker-phase')
  assert.ok(phases.length > 0 && phases.every((shape) => shape.kind === 'text' && shape.text))
  const presented = presentInheritedPhaseLabels(source, project)
  assert.ok(presented.filter((shape) => phases.some((phase) => phase.id === shape.id)).every((shape) => shape.hidden))
  const threePhase = structuredClone(project)
  threePhase.electricalProfile!.defaultPoles = 4
  for (const board of threePhase.electricalProfile!.boards!) {
    if (board.mainDifferential) board.mainDifferential.poles = 4
    for (const differential of board.additionalDifferentials ?? []) differential.poles = 4
  }
  const restored = presentInheritedPhaseLabels(source, threePhase)
  assert.ok(restored.filter((shape) => phases.some((phase) => phase.id === shape.id)).every((shape) => !shape.hidden))
})
