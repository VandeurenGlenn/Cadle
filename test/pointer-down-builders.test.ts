import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSymbolShape,
  createDraftShape,
  DEFAULT_DRAW_STROKE_WIDTH
} from '../src/editor/interaction/pointer-down-builders.js'

test('uses a one-pixel stroke for newly drawn lines and outline shapes', () => {
  const point = { x: 10, y: 20 }

  for (const tool of ['line', 'rect', 'circle', 'arc'] as const) {
    const draft = createDraftShape(tool, point, tool)
    assert.equal(draft.strokeWidth, DEFAULT_DRAW_STROKE_WIDTH, tool)
  }
})

test('keeps architectural tools on their specialized stroke defaults', () => {
  const point = { x: 10, y: 20 }

  for (const tool of ['wall', 'room', 'door', 'window', 'gate'] as const) {
    const draft = createDraftShape(tool, point, tool)
    assert.equal(draft.strokeWidth, undefined, tool)
  }
})

test('places floor-plan switches at a readable default scale', () => {
  const shape = createSymbolShape(
    'switch',
    { x: 10, y: 20 },
    {
      name: 'Switch general symbol',
      path: 'symbols/Switches/Switch general symbol.svg'
    }
  )

  assert.equal(shape.scale, 1.3)
})

test('uses a compact scale for push buttons', () => {
  for (const name of ['Push button', 'Illuminated push button']) {
    const shape = createSymbolShape(
      name,
      { x: 10, y: 20 },
      {
        name,
        path: `symbols/Switches/${name}.svg`
      }
    )
    assert.equal(shape.scale, 0.8, name)
  }
})

test('compensates the wide view box of a double push button', () => {
  const shape = createSymbolShape(
    'double-push-button',
    { x: 10, y: 20 },
    {
      name: 'Double push button',
      path: 'symbols/Switches/Double push button.svg'
    }
  )

  assert.equal(shape.scale, 1.25)
})

test('compensates tall change-over switches for their larger view box', () => {
  for (const name of [
    'Single pole change over switch',
    'Double change over switch (wissel-wissel)',
    'Intermediate switch'
  ]) {
    const shape = createSymbolShape(
      name,
      { x: 10, y: 20 },
      {
        name,
        path: `symbols/Switches/${name}.svg`
      }
    )
    assert.equal(shape.scale, 1.7, name)
  }
})

test('uses a smaller scale for a dual switch in one casing', () => {
  const shape = createSymbolShape(
    'dual-switch',
    { x: 10, y: 20 },
    {
      name: 'Dual switch, single casing',
      path: 'symbols/Switches/Dual switch, single casing.svg'
    }
  )

  assert.equal(shape.scale, 1.15)
})

test('keeps wide switch control symbols at normal scale', () => {
  for (const name of ['Timer', 'Thermostat', 'Impulse relay']) {
    const shape = createSymbolShape(
      name,
      { x: 10, y: 20 },
      {
        name,
        path: `symbols/Switches/${name}.svg`
      }
    )
    assert.equal(shape.scale, 1, name)
  }
})

test('uses a larger scale for wall lights', () => {
  const shape = createSymbolShape(
    'wall-light',
    { x: 10, y: 20 },
    {
      name: 'Wall light',
      path: 'symbols/Consumption appliances/Wall light.svg'
    }
  )

  assert.equal(shape.scale, 1.5)
})

test('compensates the wide view box of fluorescent lamps', () => {
  const shape = createSymbolShape(
    'fluorescent-lamp',
    { x: 10, y: 20 },
    {
      name: 'Fluorescent lamp',
      path: 'symbols/Consumption appliances/Fluorescent lamp.svg'
    }
  )

  assert.equal(shape.scale, 2)
})

test('compensates the wide view box of distribution boards', () => {
  const shape = createSymbolShape(
    'distribution-board',
    { x: 10, y: 20 },
    {
      name: 'Distribution board',
      path: 'symbols/Electrical devices/Distribution board.svg'
    }
  )

  assert.equal(shape.scale, 2)
  assert.equal(shape.strokeWidth, 1.35)
})

test('uses a larger size and stronger stroke for battery banks', () => {
  const shape = createSymbolShape(
    'battery-bank',
    { x: 10, y: 20 },
    {
      name: 'Battery bank',
      path: 'symbols/Photovoltaic devices (≠AREI)/Battery bank.svg'
    }
  )

  assert.equal(shape.scale, 2)
  assert.equal(shape.strokeWidth, 5)
})

test('uses a larger size and stronger stroke for inverters', () => {
  const shape = createSymbolShape(
    'inverter',
    { x: 10, y: 20 },
    {
      name: 'Inverter',
      path: 'symbols/Photovoltaic devices (≠AREI)/Inverter.svg'
    }
  )

  assert.equal(shape.scale, 1.4)
  assert.equal(shape.strokeWidth, 1.15)
})

test('keeps an explicit catalog scale for switches', () => {
  const shape = createSymbolShape(
    'switch',
    { x: 10, y: 20 },
    {
      name: 'Switch general symbol',
      path: 'symbols/Switches/Switch general symbol.svg',
      metadata: { symbolDefaults: { scale: 2.4 } }
    }
  )

  assert.equal(shape.scale, 2.4)
})
