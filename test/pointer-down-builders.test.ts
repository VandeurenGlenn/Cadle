import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSymbolShape,
  createDraftShape,
  resolveCatalogSymbolScale
} from '../src/editor/interaction/pointer-down-builders.js'
import { oneWireSymbolScaleFor } from '../src/editor/layout/onewire-symbol-nodes.js'
import { sanitizeShapes } from '../src/editor/model/model.js'

test('uses a two-pixel stroke for newly drawn lines and outline shapes', () => {
  const point = { x: 10, y: 20 }

  for (const tool of ['line', 'rect', 'circle', 'arc'] as const) {
    const draft = createDraftShape(tool, point, tool)
    assert.equal(draft.strokeWidth, 2, tool)
    if (tool === 'line') assert.equal(draft.stroke, '#000000')
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

  assert.equal(shape.scale, 1.3 * 1.5 * 1.15)
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
    assert.equal(shape.scale, 0.8 * 1.5 * 1.15, name)
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

  assert.equal(shape.scale, 1.25 * 1.5 * 1.15)
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
    assert.equal(shape.scale, 1.7 * 1.5 * 1.15, name)
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

  assert.equal(shape.scale, 1.15 * 1.5 * 1.15)
})

test('uses readable floor-plan sizes for wide switch controls', () => {
  for (const name of ['Timer', 'Thermostat', 'Impulse relay']) {
    const shape = createSymbolShape(
      name,
      { x: 10, y: 20 },
      {
        name,
        path: `symbols/Switches/${name}.svg`
      }
    )
    assert.equal(shape.scale, 1.5 * 1.15, name)
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

  assert.equal(shape.scale, 2.25 * 1.15)
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

  assert.equal(shape.scale, 3 * 1.15)
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

  assert.equal(shape.scale, 2 * 1.15)
  assert.equal(shape.strokeWidth, undefined)
})

test('uses a larger size and the shared paper pen for battery banks', () => {
  const shape = createSymbolShape(
    'battery-bank',
    { x: 10, y: 20 },
    {
      name: 'Battery bank',
      path: 'symbols/Photovoltaic devices (≠AREI)/Battery bank.svg'
    }
  )

  assert.equal(shape.scale, 2 * 1.15)
  assert.equal(shape.strokeWidth, undefined)
})

test('uses a larger size and the shared paper pen for inverters', () => {
  const shape = createSymbolShape(
    'inverter',
    { x: 10, y: 20 },
    {
      name: 'Inverter',
      path: 'symbols/Photovoltaic devices (≠AREI)/Inverter.svg'
    }
  )

  assert.equal(shape.scale, 1.4 * 1.15)
  assert.equal(shape.strokeWidth, undefined)
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

test('catalog placement on one-wire uses the same sizes as generated components', () => {
  for (const path of [
    'symbols/Switches/Switch general symbol.svg',
    'symbols/Switches/Push button.svg',
    'symbols/Switches/Double push button.svg',
    'symbols/Consumption appliances/Lighting.svg',
    'symbols/Socket outlets/Wall outlet with grounding.svg'
  ]) {
    const symbol = { name: 'Component', path }
    const shape = createSymbolShape('placed', { x: 0, y: 0 }, symbol, 'onewire')
    assert.equal(shape.scale, oneWireSymbolScaleFor(path))
    assert.equal(resolveCatalogSymbolScale(symbol, 'onewire'), shape.scale)
  }
})

test('enlarges newly placed lights and sockets while keeping custom catalog sizes', () => {
  for (const path of ['symbols/Consumption appliances/Lighting.svg', 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg']) {
    assert.equal(createSymbolShape('placed', { x: 0, y: 0 }, { name: 'Component', path }).scale, 1.5 * 1.15)
  }
  assert.equal(resolveCatalogSymbolScale({ name: 'Custom', path: 'symbols/Switches/Switch general symbol.svg',
    metadata: { symbolDefaults: { scale: 2.4 } } }, 'onewire'), 2.4)
})

test('gives refrigerators and meters readable paper sizes and upgrades only their old defaults', () => {
  for (const [name, scale] of [['Refrigerator', 3], ['kWh meter', 8 / 3]] as const) {
    const symbol = { name, path: `symbols/Consumption appliances/${name}.svg` }
    assert.equal(createSymbolShape('new', { x: 0, y: 0 }, symbol).scale, scale)
    const original = { id: 'old', kind: 'symbol', ...symbol, position: { x: 20, y: 30 }, scale: 1.15, strokeWidth: 0.5 }
    const upgraded = sanitizeShapes([original])[0]
    assert.equal(upgraded.kind === 'symbol' && upgraded.scale, scale)
    assert.equal(upgraded.strokeWidth! * scale, 0.5 * 1.15)
    assert.deepEqual(sanitizeShapes([upgraded]), [upgraded])
    const custom = sanitizeShapes([{ ...original, scale: 2.4 }])[0]
    assert.equal(custom.kind === 'symbol' && custom.scale, 2.4)
    const generated = sanitizeShapes([{ ...original, groupId: 'onewire-example' }])[0]
    assert.equal(generated.kind === 'symbol' && generated.scale, 1.15)
    assert.equal(createSymbolShape('custom', { x: 0, y: 0 }, { ...symbol, metadata: { symbolDefaults: { scale: 2.4 } } }).scale, 2.4)
  }
})
