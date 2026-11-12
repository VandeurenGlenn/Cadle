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

  assert.equal(shape.scale, 1.3 * 1.05)
  const saved = { ...shape, scale: 1.3 * 1.15 }
  assert.deepEqual(sanitizeShapes([saved], 'groundplan'), [saved])
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
    assert.equal(shape.scale, 0.8 * 1.05, name)
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

  assert.equal(shape.scale, 1.25 * 1.05)
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
    assert.equal(shape.scale, 1.7 * 1.05, name)
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

  assert.equal(shape.scale, 1.15 * 1.05)
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
    assert.equal(shape.scale, 1.05, name)
  }
})

test('uses a compact floor-plan scale for wall lights while preserving custom and saved sizes', () => {
  const shape = createSymbolShape(
    'wall-light',
    { x: 10, y: 20 },
    {
      name: 'Wall light',
      path: 'symbols/Consumption appliances/Wall light.svg'
    }
  )

  assert.equal(shape.scale, 1.5 * 1.15)
  assert.equal(createSymbolShape('custom', { x: 10, y: 20 }, {
    name: shape.name, path: shape.path, metadata: { symbolDefaults: { scale: 2.4 } }
  }).scale, 2.4)
  const saved = { ...shape, scale: 2.25 * 1.15 }
  assert.deepEqual(sanitizeShapes([saved], 'groundplan'), [saved])
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
    'symbols/Consumption appliances/Wall light.svg',
    'symbols/Socket outlets/Wall outlet with grounding.svg'
  ]) {
    const symbol = { name: 'Component', path }
    const shape = createSymbolShape('placed', { x: 0, y: 0 }, symbol, 'onewire')
    assert.equal(shape.scale, oneWireSymbolScaleFor(path))
    assert.equal(resolveCatalogSymbolScale(symbol, 'onewire'), shape.scale)
  }
})

test('enlarges newly placed lights while keeping custom catalog sizes', () => {
  assert.equal(createSymbolShape('placed', { x: 0, y: 0 }, {
    name: 'Component', path: 'symbols/Consumption appliances/Lighting.svg'
  }).scale, 1.5 * 1.15)
  assert.equal(resolveCatalogSymbolScale({ name: 'Custom', path: 'symbols/Switches/Switch general symbol.svg',
    metadata: { symbolDefaults: { scale: 2.4 } } }, 'onewire'), 2.4)
})

test('keeps floor-plan sockets compact and upgrades only their old default size', () => {
  const symbol = { name: 'Socket', path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg' }
  assert.equal(createSymbolShape('new', { x: 0, y: 0 }, symbol).scale, 1.05)

  const old = { id: 'old', kind: 'symbol', ...symbol, position: { x: 20, y: 30 }, scale: 1.5 * 1.15, strokeWidth: .5 }
  const upgraded = sanitizeShapes([old], 'groundplan')[0]
  assert.equal(upgraded.kind === 'symbol' && upgraded.scale, 1.05)
  assert.ok(upgraded.kind === 'symbol' && Math.abs(upgraded.strokeWidth! * upgraded.scale - .5 * old.scale) < 1e-9)

  const custom = { ...old, scale: 2.4 }
  assert.deepEqual(sanitizeShapes([custom], 'groundplan'), [custom])
  assert.deepEqual(sanitizeShapes([{ ...old, scale: 1.15 }], 'groundplan'), [{ ...old, scale: 1.15 }],
    'existing objects at the previous default size remain unchanged')
  assert.equal(createSymbolShape('custom', { x: 0, y: 0 },
    { ...symbol, metadata: { symbolDefaults: { scale: 2.4 } } }).scale, 2.4)
  assert.deepEqual(sanitizeShapes([old], 'onewire'), [old])
})

test('keeps floor-plan spots compact and upgrades only their old default size', () => {
  const symbol = { name: 'Spot', path: 'symbols/Consumption appliances/Spot.svg' }
  assert.equal(createSymbolShape('new', { x: 0, y: 0 }, symbol).scale, 1.15)

  const old = { id: 'old', kind: 'symbol', ...symbol, position: { x: 20, y: 30 }, scale: 1.5 * 1.15, strokeWidth: .5 }
  const upgraded = sanitizeShapes([old], 'groundplan')[0]
  assert.equal(upgraded.kind === 'symbol' && upgraded.scale, 1.15)
  assert.ok(upgraded.kind === 'symbol' && Math.abs(upgraded.strokeWidth! * upgraded.scale - .5 * old.scale) < 1e-9)

  const custom = { ...old, scale: 2.4 }
  assert.deepEqual(sanitizeShapes([custom], 'groundplan'), [custom])
  assert.deepEqual(sanitizeShapes([old], 'onewire'), [old])
})

test('matches refrigerators and meters to comparable appliance sizes and upgrades only their old defaults', () => {
  for (const [name, scale] of [['Refrigerator', 1.15], ['kWh meter', 1.15]] as const) {
    const symbol = { name, path: `symbols/Consumption appliances/${name}.svg` }
    assert.equal(createSymbolShape('new', { x: 0, y: 0 }, symbol).scale, scale)
    const original = { id: 'old', kind: 'symbol', ...symbol, position: { x: 20, y: 30 }, scale: 2, strokeWidth: 0.5 }
    const upgraded = sanitizeShapes([original], 'groundplan')[0]
    assert.equal(upgraded.kind === 'symbol' && upgraded.scale, scale)
    assert.equal(upgraded.strokeWidth! * scale, 0.5 * 2)
    assert.deepEqual(sanitizeShapes([upgraded], 'groundplan'), [upgraded])
    const custom = sanitizeShapes([{ ...original, scale: 2.4 }], 'groundplan')[0]
    assert.equal(custom.kind === 'symbol' && custom.scale, 2.4)
    const generated = sanitizeShapes([{ ...original, groupId: 'onewire-example' }])[0]
    assert.equal(generated.kind === 'symbol' && generated.scale, 2)
    assert.equal(createSymbolShape('custom', { x: 0, y: 0 }, { ...symbol, metadata: { symbolDefaults: { scale: 2.4 } } }).scale, 2.4)
  }
})


test('reduces saved floor-plan defaults once and retains one-wire sizes and visible pen width', () => {
  for (const [name, oldScale] of [['Refrigerator', 3], ['kWh meter', 8 / 3], ['Switch general symbol', 1.3 * 1.5 * 1.15], ['Push button', .8 * 1.5 * 1.15], ['Double push button', 1.25 * 1.5 * 1.15], ['Single pole change over switch', 1.7 * 1.5 * 1.15], ['Dual switch, single casing', 1.15 * 1.5 * 1.15], ['Impulse relay', 1.5 * 1.15]] as const) {
    const path = `symbols/${name === 'Refrigerator' || name === 'kWh meter' ? 'Consumption appliances' : 'Switches'}/${name}.svg`
    const original = { id: name, kind: 'symbol', name, path, scale: oldScale, position: { x: 50, y: 50 }, strokeWidth: .5 }
    const resized = sanitizeShapes([original], 'groundplan')[0]
    assert.equal(resized.kind, 'symbol')
    if (resized.kind !== 'symbol') continue
    assert.equal(resized.scale, resolveCatalogSymbolScale({ name, path }, 'groundplan'))
    assert.ok(resized.scale < oldScale)
    assert.ok(Math.abs(resized.strokeWidth! * resized.scale - .5 * oldScale) < 1e-9)
    assert.deepEqual(sanitizeShapes([resized], 'groundplan'), [resized])
    assert.deepEqual(sanitizeShapes([original], 'onewire'), [original])
    const custom = { ...original, scale: 2.4 }
    assert.deepEqual(sanitizeShapes([custom], 'groundplan'), [custom])
  }
  const meter = { name: 'kWh meter', path: 'symbols/Consumption appliances/kWh meter.svg' }
  assert.equal(resolveCatalogSymbolScale(meter, 'onewire'), 8 / 3)
})
