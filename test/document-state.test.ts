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

test('migrates the previous compact switch default without changing custom scales', () => {
  const state = asNativeState({
    version: 1,
    shapes: [
      {
        id: 'default-switch',
        kind: 'symbol',
        position: { x: 10, y: 20 },
        name: 'Switch general symbol',
        path: 'symbols/Switches/Switch general symbol.svg',
        scale: 1.7
      },
      {
        id: 'custom-switch',
        kind: 'symbol',
        position: { x: 30, y: 20 },
        name: 'Switch general symbol',
        path: 'symbols/Switches/Switch general symbol.svg',
        scale: 1.6
      },
      {
        id: 'change-over-switch',
        kind: 'symbol',
        position: { x: 50, y: 20 },
        name: 'Single pole change over switch',
        path: 'symbols/Switches/Single pole change over switch.svg',
        scale: 1.3
      },
      {
        id: 'dual-switch',
        kind: 'symbol',
        position: { x: 70, y: 20 },
        name: 'Dual switch, single casing',
        path: 'symbols/Switches/Dual switch, single casing.svg',
        scale: 1.3
      }
    ],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.equal(state?.shapes[0].kind === 'symbol' ? state.shapes[0].scale : null, 1.3)
  assert.equal(state?.shapes[1].kind === 'symbol' ? state.shapes[1].scale : null, 1.6)
  assert.equal(state?.shapes[2].kind === 'symbol' ? state.shapes[2].scale : null, 1.7)
  assert.equal(state?.shapes[3].kind === 'symbol' ? state.shapes[3].scale : null, 1.15)
})

test('restores stable generated source links used by incremental regeneration', () => {
  const state = asNativeState({
    version: 1,
    shapes: [
      {
        id: 'generated-load',
        kind: 'symbol',
        position: { x: 10, y: 20 },
        name: 'Load',
        path: 'load.svg',
        scale: 1,
        generationKey: 'device:floor-load-1',
        sourceLink: { kind: 'device', id: 'floor-load-1', role: 'load' }
      }
    ],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })
  assert.equal(state?.shapes[0].generationKey, 'device:floor-load-1')
  assert.deepEqual(state?.shapes[0].sourceLink, { kind: 'device', id: 'floor-load-1', role: 'load' })
})

test('preserves a locked imported-plan background', () => {
  const state = asNativeState({
    version: 2,
    shapes: [
      {
        id: 'old-plan',
        kind: 'image',
        position: { x: 500, y: 400 },
        name: 'Old plan',
        path: 'data:image/png;base64,AA==',
        width: 900,
        height: 650,
        locked: true
      }
    ],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 10,
    worldWidth: 2376,
    worldHeight: 1680
  })

  assert.equal(state?.shapes[0].locked, true)
})

test('restores bidirectional one-wire energy flow metadata', () => {
  const state = asNativeState({
    version: 1,
    shapes: [
      {
        id: 'main-meter-line',
        kind: 'line',
        start: { x: 100, y: 200 },
        end: { x: 100, y: 100 },
        energyFlow: 'bidirectional',
        energySource: 'mixed'
      }
    ],
    selectedId: null,
    paperPreset: 'a4-landscape',
    printMargin: 0,
    worldWidth: 1000,
    worldHeight: 1000
  })

  assert.equal(state?.shapes[0].kind === 'line' ? state.shapes[0].energyFlow : null, 'bidirectional')
  assert.equal(state?.shapes[0].kind === 'line' ? state.shapes[0].energySource : null, 'mixed')
})

test('restores generated text alignment anchors', () => {
  const state = asNativeState({
    version: 1,
    shapes: [
      {
        id: 'phase-label',
        kind: 'text',
        position: { x: 100, y: 100 },
        text: 'L1N',
        textAnchor: 'end'
      }
    ],
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
    shapes: [
      {
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
      }
    ],
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
    shapes: [
      {
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
      }
    ],
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
    shapes: [
      {
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
      }
    ],
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
    shapes: [
      {
        id: 'custom-spot',
        kind: 'symbol',
        position: { x: 100, y: 100 },
        name: 'Custom spot',
        path: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
        scale: 1.4,
        fill: '#ffcc33',
        stroke: '#2455cc',
        strokeWidth: 2.5
      }
    ],
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
    shapes: [
      {
        id: 'custom-spot',
        kind: 'symbol',
        position: { x: 100, y: 100 },
        name: 'Spot',
        path: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E',
        scale: 1
      }
    ],
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
    state?.shapes.map((shape) => (shape.kind === 'symbol' ? shape.path : '')),
    ['symbols/Protection devices/Automaat.svg', 'symbols/Protection devices/Residual-current circuit breaker.svg']
  )
  assert.deepEqual(state?.shapes[0]?.kind === 'symbol' ? state.shapes[0].symbolTextOverrides : null, {
    poles: '',
    phase: '',
    'rated-current': ''
  })
})
