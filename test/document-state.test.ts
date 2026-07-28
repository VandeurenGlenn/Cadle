import assert from 'node:assert/strict'
import test from 'node:test'
import { asNativeState } from '../src/editor/model/document-state.ts'

test('ignores persisted selection ids so restored documents start unselected', () => {
  const state = asNativeState({
    version: 1,
    shapes: [],
    selectedId: 'shape-1',
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.equal(state?.selectedId, null)
})

test('rejects malformed document dimensions and paper presets', () => {
  const base = {
    version: 1,
    shapes: [],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  }

  assert.equal(asNativeState({ ...base, worldWidth: 0 }), null)
  assert.equal(asNativeState({ ...base, printMargin: -1 }), null)
  assert.equal(asNativeState({ ...base, paperPreset: 'letter' }), null)
})

test('restores stable generated source links used by incremental regeneration', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'generated-load', kind: 'symbol', position: { x: 10, y: 20 }, name: 'Load', path: 'load.svg', scale: 1,
      generationKey: 'device:floor-load-1', sourceLink: { kind: 'device', id: 'floor-load-1', role: 'load' }
    }],
    selectedId: null, paperPreset: 'a4-landscape', printMargin: 0, worldWidth: 1000, worldHeight: 1000
  })
  assert.equal(state?.shapes[0].generationKey, 'device:floor-load-1')
  assert.deepEqual(state?.shapes[0].sourceLink, { kind: 'device', id: 'floor-load-1', role: 'load' })
})

test('restores generated text alignment anchors', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'phase-label',
      kind: 'text',
      position: { x: 100, y: 100 },
      text: 'L1N',
      textAnchor: 'end'
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.equal(state?.shapes[0].kind === 'text' ? state.shapes[0].textAnchor : null, 'end')
})

test('preserves a hidden phase label without discarding its electrical phase', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'breaker-1',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Automaat',
      path: 'symbols/Protection devices/Automaat.svg',
      scale: 1,
      electrical: {
        role: 'protection',
        oneWireEligible: true,
        phaseConfiguration: 'L2+N',
        showPhaseLabel: false
      }
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  const electrical = state?.shapes[0].kind === 'symbol' ? state.shapes[0].electrical : null
  assert.equal(electrical?.phaseConfiguration, 'L2+N')
  assert.equal(electrical?.showPhaseLabel, false)
})

test('preserves a hidden cable-installation symbol and its installation method', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'cable-installation',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Cable conduit',
      path: 'symbols/Wires/Cable in conduit.svg',
      scale: 3,
      hidden: true,
      electrical: {
        role: 'protection',
        oneWireEligible: true,
        cableInstallation: 'conduit',
        showCableInstallation: false
      }
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  const symbol = state?.shapes[0]
  assert.equal(symbol?.hidden, true)
  assert.equal(symbol?.kind === 'symbol' ? symbol.electrical?.cableInstallation : null, 'conduit')
  assert.equal(symbol?.kind === 'symbol' ? symbol.electrical?.showCableInstallation : null, false)
})

test('preserves empty symbol text overrides for backwards-compatible symbol rendering', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'breaker-1',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Automaat',
      path: 'symbols/Protection devices/Automaat.svg',
      scale: 1,
      symbolTextOverrides: {
        'desc:nP': '',
        'desc:n': '',
        'desc:20A': ''
      }
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.deepEqual(state?.shapes[0].kind === 'symbol' ? state.shapes[0].symbolTextOverrides : null, {
    'desc:nP': '',
    'desc:n': '',
    'desc:20A': ''
  })
})

test('restores custom symbol appearance from persisted catalog geometry', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'custom-spot',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Custom spot',
      path: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
      scale: 1.4,
      fill: '#ffcc33',
      stroke: '#2455cc',
      strokeWidth: 2.5
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  const symbol = state?.shapes[0]
  assert.equal(symbol?.kind === 'symbol' ? symbol.fill : null, '#ffcc33')
  assert.equal(symbol?.kind === 'symbol' ? symbol.stroke : null, '#2455cc')
  assert.equal(symbol?.kind === 'symbol' ? symbol.strokeWidth : null, 2.5)
})

test('migrates a placed custom Spot to the built-in Spot.svg', () => {
  const state = asNativeState({
    version: 1,
    shapes: [{
      id: 'custom-spot',
      kind: 'symbol',
      position: { x: 100, y: 100 },
      name: 'Spot',
      path: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
      scale: 1
    }],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  const spot = state?.shapes[0]
  assert.equal(spot?.kind === 'symbol' ? spot.name : null, 'Spot')
  assert.equal(spot?.kind === 'symbol' ? spot.path : null, 'symbols/Consumption appliances/Spot.svg')
})

test('migrates legacy duplicate one-wire protection assets to the catalog symbols', () => {
  const state = asNativeState({
    version: 1,
    shapes: [
      {
        id: 'legacy-breaker',
        kind: 'symbol',
        position: { x: 100, y: 100 },
        name: 'Automaat',
        path: 'symbols/One-wire/Custom breaker.svg',
        scale: 3,
        sourceLink: { kind: 'board', id: 'A', role: 'breaker' }
      },
      {
        id: 'legacy-rcd',
        kind: 'symbol',
        position: { x: 200, y: 100 },
        name: 'Residual-current circuit breaker',
        path: 'symbols/One-wire/Custom residual-current circuit breaker.svg',
        scale: 4
      }
    ],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.deepEqual(
    state?.shapes.map((shape) => shape.kind === 'symbol' ? shape.path : ''),
    [
      'symbols/Protection devices/Automaat.svg',
      'symbols/Protection devices/Residual-current circuit breaker.svg'
    ]
  )
  assert.deepEqual(state?.shapes[0]?.kind === 'symbol' ? state.shapes[0].symbolTextOverrides : null, {
    poles: '',
    phase: '',
    'rated-current': ''
  })
})
