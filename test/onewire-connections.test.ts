import assert from 'node:assert/strict'
import test from 'node:test'
import type { LineShape, Shape, SymbolShape } from '../src/editor/model/types.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors, positionOneWireSymbolForConnection, repairGeneratedOneWireContacts } from '../src/editor/layout/onewire-connections.js'
import { findConnectionIssues } from '../src/editor/layout/connection-issues.js'
import { removeRedundantRailAttachments } from '../src/editor/interaction/connected-conductors.js'
import { oneWireSymbolBounds, oneWireSymbolNodeInfo, oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.js'
import { buildOneWireCircuit } from '../src/editor/layout/onewire-builder.js'
import { ONE_WIRE_PRESETS } from '../src/editor/constants.js'
import { insertOneWireInlinePlacement, planOneWireInlinePlacement, repairOneWireInlineConnections } from '../src/editor/interaction/onewire-inline-placement.js'
import { connectionPoints } from '../src/editor/model/electrical-connection.js'
import { translateShape } from '../src/editor/interaction/shape-transforms.js'

const symbol = (path: string, overrides: Partial<SymbolShape> = {}): SymbolShape => ({
  id: 'symbol',
  kind: 'symbol',
  name: 'Symbol',
  path,
  scale: 1,
  position: { x: 100, y: 200 },
  ...overrides
})

test('inserts a switch below existing lamp rows at its actual contacts without moving any other geometry', () => {
  const trunk: LineShape = { id: 'trunk', kind: 'line', start: { x: 100, y: 600 }, end: { x: 100, y: 0 },
    bindingId: 'A', oneWireRailId: 'rail', generationKey: 'board:A:trunk',
    sourceLink: { kind: 'board', id: 'A', role: 'trunk' },
    connection: { kind: 'cable', conductors: 3, sectionMm2: 2.5, cableType: 'VOB', labelOwner: 'circuit' } }
  const rows: LineShape[] = [120, 240].map((y) => ({ id: `row-${y}`, kind: 'line',
    start: { x: 100, y }, end: { x: 400, y }, connection: { kind: 'wire' } }))
  const shapes = [trunk, ...rows]
  const original = structuredClone(shapes)
  const plan = planOneWireInlinePlacement(shapes, symbol('symbols/Switches/Switch general symbol.svg'), { x: 103, y: 350 })
  assert.ok(plan && !('error' in plan) && plan.cut)
  let id = 0
  const inserted = insertOneWireInlinePlacement(shapes, plan, () => `inserted-${++id}`)
  const node = oneWireSymbolNodeInfo(inserted.symbol.path, inserted.symbol.scale, inserted.symbol.rotation)!
  assert.deepEqual({ x: inserted.symbol.position.x + node.offset.x, y: inserted.symbol.position.y + node.offset.y }, { x: 100, y: 350 })
  const ports = oneWireSymbolConnectionAnchors(inserted.symbol)
  const wires = inserted.shapes.filter((shape): shape is LineShape => shape.kind === 'line' && !rows.includes(shape))
  assert.deepEqual(wires[0].start, trunk.start)
  assert.deepEqual(wires[1].end, trunk.end)
  assert.ok(ports.some(({ point }) => Math.hypot(point.x - wires[0].end.x, point.y - wires[0].end.y) < 1e-8))
  assert.ok(ports.some(({ point }) => Math.hypot(point.x - wires[1].start.x, point.y - wires[1].start.y) < 1e-8))
  assert.equal(wires.filter((wire) => wire.connection?.labelOwner).length, 1)
  assert.equal(inserted.symbol.bindingId, 'A')
  assert.equal(inserted.symbol.oneWireRailId, 'rail')
  for (const row of rows) assert.equal(inserted.shapes.find((shape) => shape.id === row.id), row)
  assert.deepEqual(shapes, original)
})

test('inline insertion preserves bends and asymmetric contacts on a routed conductor', () => {
  const wire: LineShape = { id: 'bent', kind: 'line', start: { x: 0, y: 0 }, end: { x: 600, y: 400 },
    connection: { kind: 'wire', via: [{ x: 0, y: 200 }, { x: 600, y: 200 }] } }
  const plan = planOneWireInlinePlacement([wire], symbol('symbols/Switches/Double push button.svg'), { x: 300, y: 203 })
  assert.ok(plan && !('error' in plan) && plan.cut)
  let id = 0
  const inserted = insertOneWireInlinePlacement([wire], plan, () => `${++id}`)
  const lines = inserted.shapes.filter((shape): shape is LineShape => shape.kind === 'line')
  assert.deepEqual(connectionPoints(lines[0]).slice(0, 2), [{ x: 0, y: 0 }, { x: 0, y: 200 }])
  assert.deepEqual(connectionPoints(lines[1]).slice(-2), [{ x: 600, y: 200 }, { x: 600, y: 400 }])
  assert.ok(oneWireSymbolConnectionAnchors(inserted.symbol).some(({ point }) =>
    Math.hypot(point.x - lines[0].end.x, point.y - lines[0].end.y) < 1e-8))
})

test('vertical insertion makes only the required room above, keeping labels, routed rows and contacts together', () => {
  for (const reversed of [false, true]) {
    const trunk: LineShape = { id: 'trunk', kind: 'line', start: { x: 100, y: reversed ? 0 : 600 },
      end: { x: 100, y: reversed ? 600 : 0 }, bindingId: 'A', connection: { kind: 'wire' } }
    const lampNode = oneWireSymbolNodeInfo('symbols/Consumption appliances/Lighting.svg', 2)!
    const rows: Shape[] = [260, 120, 430].flatMap((y, index): Shape[] => [
      { id: `row-${index}`, kind: 'line', start: { x: 100, y }, end: { x: 400, y },
        bindingId: `A${index + 1}`, groupId: `row-${index}`, connection: { kind: 'wire', showLabel: false,
          via: [{ x: 200, y }, { x: 200, y: y - 10 }, { x: 300, y: y - 10 }, { x: 300, y }] } },
      symbol('symbols/Consumption appliances/Lighting.svg', { id: `lamp-${index}`, bindingId: `A${index + 1}`,
        groupId: `row-${index}`, scale: 2, position: { x: 400 - lampNode.offset.x, y: y - lampNode.offset.y } }),
      { id: `label-${index}`, kind: 'text', position: { x: 120, y: y + 5 }, text: `${index + 1}`,
        bindingId: `A${index + 1}`, groupId: `row-${index}`, sourceLink: { kind: 'circuit', id: `A${index + 1}`, role: 'number-label' } }
    ])
    const fixed: Shape[] = [
      symbol('symbols/Protection devices/Automaat.svg', { id: 'breaker', bindingId: 'A', position: { x: 100, y: 640 } }),
      { id: 'rail', kind: 'line', start: { x: 0, y: 700 }, end: { x: 900, y: 700 }, groupId: 'onewire-kamrail-main' },
      { id: 'other', kind: 'line', start: { x: 700, y: 600 }, end: { x: 700, y: 0 }, bindingId: 'B' }
    ]
    const shapes = [trunk, ...rows, ...fixed], original = structuredClone(shapes)
    const plan = planOneWireInlinePlacement(shapes, symbol('symbols/Switches/Double push button.svg', { scale: 2.5 }), { x: 100, y: 264 })
    assert.ok(plan && !('error' in plan) && plan.cut && plan.shiftedShapes)
    let id = 0
    const inserted = insertOneWireInlinePlacement(shapes, plan, () => `new-${++id}`)
    const first = inserted.shapes.find((shape): shape is LineShape => shape.id === 'row-0' && shape.kind === 'line')!
    const delta = first.start.y - 260
    assert.ok(delta < 0)
    for (const shape of [...rows, ...fixed]) {
      assert.deepEqual(inserted.shapes.find((candidate) => candidate.id === shape.id),
        rows.slice(0, 6).includes(shape) ? translateShape(shape, 0, delta) : shape)
    }
    const bottom = Math.max(...rows.slice(0, 6).map((shape) => {
      const bounds = oneWireLayoutBounds(inserted.shapes.find((candidate) => candidate.id === shape.id)!)
      return bounds.y + bounds.height
    }))
    assert.ok(Math.abs(oneWireLayoutBounds(inserted.symbol).y - bottom - 24) < 1e-8)
    const wires = inserted.shapes.filter((shape): shape is LineShape =>
      shape.kind === 'line' && (shape.id === trunk.id || shape.sourceLink?.role === `inline-wire:${inserted.symbol.id}`))
    for (const point of [wires[0].end, wires[1].start]) assert.ok(oneWireSymbolConnectionAnchors(inserted.symbol)
      .some((anchor) => Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y) < 1e-8))
    const regenerated = [...shapes, ...inserted.shapes.filter((shape) => !shapes.some((old) => old.id === shape.id))]
    const repaired = repairOneWireInlineConnections(regenerated, () => 'unexpected-new-id')
    const byId = (left: Shape, right: Shape) => left.id.localeCompare(right.id)
    const normalize = (items: Shape[]) => JSON.stringify([...items].sort(byId),
      (_key, value) => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value)
    assert.equal(normalize(repaired), normalize(inserted.shapes))
    assert.deepEqual(repairOneWireInlineConnections(repaired, () => 'unused'), repaired)
    assert.deepEqual(shapes, original)
  }
})

test('source regeneration reconnects an inline device without duplicating its upper wire or moving the device', () => {
  const trunk: LineShape = { id: 'trunk', kind: 'line', start: { x: 100, y: 600 }, end: { x: 100, y: 0 },
    bindingId: 'A', sourceLink: { kind: 'board', id: 'A', role: 'trunk' }, connection: { kind: 'cable', labelOwner: 'circuit' } }
  const plan = planOneWireInlinePlacement([trunk], symbol('symbols/Switches/Double push button.svg'), { x: 100, y: 350 })
  assert.ok(plan && !('error' in plan))
  let id = 0
  const inserted = insertOneWireInlinePlacement([trunk], plan, () => `inline-${++id}`)
  assert.deepEqual(repairOneWireInlineConnections(inserted.shapes, () => 'unused'), inserted.shapes)
  const regenerated = inserted.shapes.map((shape) => shape.id === trunk.id ? { ...trunk, end: { x: 100, y: -100 } } : shape)
  const restored = repairOneWireInlineConnections(regenerated, () => 'unused')
  assert.equal(restored.length, inserted.shapes.length)
  assert.equal(restored.find((shape) => shape.id === inserted.symbol.id), inserted.symbol)
  const upper = restored.find((shape): shape is LineShape => shape.kind === 'line' && shape.id !== trunk.id)!
  assert.deepEqual(upper.end, { x: 100, y: -100 })
  const lower = restored.find((shape): shape is LineShape => shape.kind === 'line' && shape.id === trunk.id)!
  for (const point of [lower.end, upper.start]) assert.ok(oneWireSymbolConnectionAnchors(inserted.symbol)
    .some((anchor) => Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y) < 1e-8))
  assert.deepEqual(repairOneWireInlineConnections(restored, () => 'unused'), restored)
})

test('repairs an unrotated legacy impulse relay inserted into a vertical conductor', () => {
  const trunk: LineShape = {
    id: 'trunk',
    kind: 'line',
    start: { x: 100, y: 600 },
    end: { x: 100, y: 0 },
    bindingId: 'A1',
    connection: { kind: 'wire' }
  }
  const relay = symbol('symbols/Switches/Impulse relay.svg', {
    position: { x: 100, y: 300 },
    sourceLink: { kind: 'circuit', id: 'A1', role: 'inline' }
  })

  const repaired = repairOneWireInlineConnections([trunk, relay], () => 'inline-wire-lower')
  const repairedRelay = repaired.find((shape): shape is SymbolShape => shape.kind === 'symbol')
  assert.ok(repairedRelay)
  assert.equal(repairedRelay.rotation, -90)

  const ports = oneWireSymbolConnectionAnchors(repairedRelay)
  const wires = repaired.filter((shape): shape is LineShape =>
    shape.kind === 'line' && (shape.id === 'trunk' || shape.sourceLink?.role === `inline-wire:${relay.id}`)
  )
  for (const side of ['top', 'bottom'] as const) {
    const port = ports.find((anchor) => anchor.side === side)?.point
    assert.ok(port)
    assert.ok(wires.some((wire) =>
      [wire.start, wire.end].some((point) => Math.hypot(point.x - port.x, point.y - port.y) < 1e-8)
    ), `${side} impulse relay contact must meet its wire`)
  }
})

test('passthrough lamps keep the conductor intact and fixed-terminal devices connect in either orientation', () => {
  const wire: LineShape = { id: 'wire', kind: 'line', start: { x: 100, y: 600 }, end: { x: 100, y: 0 } }
  const lamp = planOneWireInlinePlacement([wire], symbol('symbols/Consumption appliances/Lighting.svg'), { x: 100, y: 300 })
  assert.ok(lamp && !('error' in lamp))
  assert.equal(lamp.cut, null)
  assert.equal(insertOneWireInlinePlacement([wire], lamp, () => 'lamp').shapes[0], wire)
  for (const conductor of [wire, { ...wire, start: { x: 0, y: 300 }, end: { x: 600, y: 300 } }]) {
    const plan = planOneWireInlinePlacement([conductor], symbol('symbols/Protection devices/Automaat.svg'),
      conductor === wire ? { x: 100, y: 300 } : { x: 300, y: 300 })
    assert.ok(plan && !('error' in plan) && plan.cut)
    assert.ok(plan.cut.before.at(-1) && plan.cut.after[0])
  }
})

test('inline insertion rejects locked wires, insufficient space and junctions rather than disconnecting them', () => {
  const wire: LineShape = { id: 'wire', kind: 'line', start: { x: 100, y: 600 }, end: { x: 100, y: 0 } }
  const device = symbol('symbols/Switches/Switch general symbol.svg')
  const junction: LineShape = { ...wire, id: 'junction', start: { x: 100, y: 300 }, end: { x: 400, y: 300 } }
  for (const [shapes, point] of [
    [[{ ...wire, locked: true }], { x: 100, y: 300 }],
    [[wire, { ...junction, locked: true }], { x: 100, y: 301 }],
    [[wire], { x: 100, y: 1 }],
    [[wire, junction], { x: 100, y: 300 }]
  ] as const) {
    const plan = planOneWireInlinePlacement(shapes, device, point)
    assert.ok(plan && 'error' in plan)
  }
  assert.equal(planOneWireInlinePlacement([{ ...wire, hidden: true }], device, { x: 100, y: 300 }), null)
  assert.equal(planOneWireInlinePlacement([{ ...wire, groupId: 'onewire-kamrail-test' }], device, { x: 100, y: 300 }), null)
})

test('repairs legacy generated appliance contacts without moving symbols, rails, manual wires or intentional gaps', () => {
  const pump = symbol('symbols/Consumption appliances/Heat pump.svg', {
    bindingId: 'R1', generationKey: 'circuit:R1:device:0'
  })
  const node = oneWireSymbolNodeInfo(pump.path, pump.scale)!
  const end = { x: pump.position.x + node.offset.x, y: pump.position.y + node.offset.y }
  const wire: LineShape = { id: 'trunk', kind: 'line', start: { x: end.x, y: 400 }, end,
    bindingId: 'R', generationKey: 'board:R:trunk', sourceLink: { kind: 'board', id: 'R', role: 'trunk' } }
  const gap = { ...wire, id: 'gap', end: { ...end, y: end.y + 2 } }
  const manual = { ...wire, id: 'manual', generationKey: undefined }
  const locked = { ...wire, id: 'locked', locked: true }
  const before = [pump, wire, gap, manual, locked]
  const repaired = repairGeneratedOneWireContacts(before)
  const bottom = oneWireSymbolConnectionAnchors(pump).find((anchor) => anchor.side === 'bottom')!.point
  assert.deepEqual((repaired[1] as LineShape).end, bottom)
  assert.deepEqual(before[1].end, end)
  for (const index of [0, 2, 3, 4]) assert.equal(repaired[index], before[index])
  assert.deepEqual(repairGeneratedOneWireContacts(repaired), repaired)
})

test('recognizes generated fallback appliance contacts and removes only stale automatic rail feeders', () => {
  const appliance = symbol('symbols/custom-appliance.svg')
  const left = oneWireSymbolConnectionAnchors(appliance).find((anchor) => anchor.side === 'left')!.point
  const line: LineShape = { id: 'feed', kind: 'line', start: { x: 20, y: left.y }, end: left, connection: { kind: 'wire' } }
  assert.ok(!findConnectionIssues([appliance, line]).some((issue) => issue.endpoint === 'end'))
  const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 0, y: 400 }, end: { x: 200, y: 400 },
    strokeWidth: 4, groupId: 'onewire-kamrail-test' }
  const tail: LineShape = { id: 'rail-attachment-tail', kind: 'line', start: { x: 210, y: 400 },
    end: { x: 240, y: 400 }, oneWireRailId: rail.id, connection: { kind: 'wire' } }
  const linked: LineShape = { ...tail, id: 'rail-attachment-linked', start: { x: left.x, y: 400 }, end: left }
  const manual = { ...tail, id: 'manual-tail', oneWireRailId: undefined,
    start: { x: 300, y: 400 }, end: { x: 340, y: 400 } }
  const shapes: Shape[] = [rail, appliance, tail, linked, manual]
  assert.deepEqual(removeRedundantRailAttachments(shapes).map((shape) => shape.id),
    ['rail', appliance.id, linked.id, manual.id])
})

test('uses only the real conductor terminals as anchors', () => {
  const shape = symbol('symbols/Photovoltaic devices (≠AREI)/Solar panel.svg')
  const terminal = oneWireSymbolTerminalInfo(shape.path, shape.scale)?.bottom
  assert.ok(terminal)

  assert.deepEqual(oneWireSymbolConnectionAnchors(shape), [
    {
      side: 'bottom',
      point: { x: shape.position.x + terminal.x, y: shape.position.y + terminal.y }
    }
  ])
})

test('rotates and flips conductor terminal anchors with the symbol', () => {
  const shape = symbol('symbols/Protection devices/Automaat.svg', {
    rotation: 90,
    flipX: true
  })
  const terminals = oneWireSymbolTerminalInfo(shape.path, shape.scale)
  assert.ok(terminals?.top && terminals.bottom)

  const anchors = oneWireSymbolConnectionAnchors(shape)
  assert.deepEqual(anchors.map(({ side }) => side), ['right', 'left'])
  assert.notDeepEqual(anchors[0].point, anchors[1].point)
})

test('anchors appliance feeds to their actual filled SVG connection dots', () => {
  for (const [name, cx, cy] of [
    ['Washing machine', 8.62894, 8.62898],
    ['Dryer', 8.62894, 10.8967],
    ['Electric oven', 8.62894, 10.8967]
  ] as const) {
    for (const scale of [1, 2, 2.5]) {
      const shape = symbol(`symbols/Consumption appliances/${name}.svg`, { scale })
      const sourceScale = 24 * scale / 17.2579
      const expected = {
        x: shape.position.x + (cx - 17.2579 / 2) * sourceScale,
        y: shape.position.y + (cy - 17.2579 / 2) * sourceScale
      }
      const node = oneWireSymbolNodeInfo(shape.path, scale)
      const radius = node?.cutHalfWidth
      assert.ok(typeof radius === 'number' && radius > 0, name)
      for (const { point } of oneWireSymbolConnectionAnchors(shape)) {
        assert.ok(Math.abs(Math.hypot(point.x - expected.x, point.y - expected.y) - radius) < 1e-8, name)
      }
    }
  }
})

test('anchors UTP connections at the actual RJ45 faceplate outline', () => {
  for (const scale of [1.15, 2.5, 3]) {
    const shape = symbol('symbols/Data and communication/UTP RJ45.svg', { scale })
    const contacts = [{ x: 50, y: 14 }, { x: 50, y: 86 }, { x: 14, y: 50 }, { x: 86, y: 50 }]
    const anchors = oneWireSymbolConnectionAnchors(shape)
    for (const [index, contact] of contacts.entries()) {
      const factor = 24 * scale / 100
      assert.ok(Math.abs(anchors[index].point.x - (shape.position.x + (contact.x - 50) * factor)) < 1e-8)
      assert.ok(Math.abs(anchors[index].point.y - (shape.position.y + (contact.y - 50) * factor)) < 1e-8)
    }
  }
})

test('placed devices connect exactly in every direction and at different scales', () => {
  for (const path of [
    'symbols/Data and communication/UTP RJ45.svg',
    'symbols/Protection devices/Automaat.svg',
    'symbols/Photovoltaic devices (≠AREI)/Solar panel.svg',
    'symbols/Switches/Switch general symbol.svg',
    'symbols/Socket outlets/Wall outlet with grounding.svg',
    'symbols/Consumption appliances/Washing machine.svg',
    'symbols/Consumption appliances/Dishwasher.svg',
    'symbols/Consumption appliances/Refrigerator.svg',
    'symbols/Consumption appliances/Videofoon touchscreen.svg',
    'symbols/Consumption appliances/Alarm klavier.svg',
    'symbols/Consumption appliances/Dryer.svg',
    'symbols/Consumption appliances/Electric oven.svg'
  ]) {
    for (const scale of [0.5, 1, 2.5]) {
      for (const side of ['top', 'bottom', 'left', 'right'] as const) {
        const from = { x: 101.25, y: 203.75 }
        const placed = positionOneWireSymbolForConnection(symbol(path, { scale, rotation: 90, flipX: true }), from, side)
        const contacts = oneWireSymbolConnectionAnchors(placed.symbol)
        assert.ok(contacts.some(({ point }) => Math.hypot(point.x - placed.connection.x, point.y - placed.connection.y) < 1e-8), `${path}: ${side}`)
        assert.ok(Math.abs(from.x - placed.connection.x) < 1e-8 || Math.abs(from.y - placed.connection.y) < 1e-8)
        assert.ok(Math.abs(Math.hypot(from.x - placed.connection.x, from.y - placed.connection.y) - 24) < 1e-8)
      }
    }
  }
})

test('manual presets form continuous columns from the bus through every component', () => {
  for (const preset of Object.values(ONE_WIRE_PRESETS)) {
    let id = 0
    const start = { x: 403.25, y: 706.75 }
    const result = buildOneWireCircuit(start, 'A1', preset, () => `shape-${++id}`, 80, 24)
    const wires = result.shapes.filter((shape) => shape.kind === 'line')
    const symbols = result.shapes.filter((shape) => shape.kind === 'symbol')
    assert.equal(wires.length, 3)
    assert.equal(symbols.length, 3)
    assert.deepEqual(wires[0].start, start)
    for (const [index, wire] of wires.entries()) {
      assert.ok(Math.abs(wire.start.x - start.x) < 1e-8)
      assert.ok(Math.abs(wire.end.x - start.x) < 1e-8)
      const target = oneWireSymbolConnectionAnchors(symbols[index])
      assert.ok(target.some(({ point }) => Math.hypot(wire.end.x - point.x, wire.end.y - point.y) < 1e-8))
      if (index === 0) continue
      const source = oneWireSymbolConnectionAnchors(symbols[index - 1])
      assert.ok(source.some(({ point }) => Math.hypot(wire.start.x - point.x, wire.start.y - point.y) < 1e-8))
      const previousBounds = oneWireSymbolBounds(symbols[index - 1])!
      const targetBounds = oneWireSymbolBounds(symbols[index])!
      assert.ok(targetBounds.y + targetBounds.height <= previousBounds.y - 8 + 1e-8)
    }
    const cable = result.shapes.find((shape) => shape.kind === 'text' && shape.text.includes('mm²'))!
    assert.ok(cable.kind === 'text')
    assert.equal(cable.rotation, -90)
    const cableBounds = oneWireLayoutBounds(cable)
    assert.ok(cableBounds.x >= start.x + 12)
    assert.ok(cableBounds.y >= wires[1].end.y + 24 - 1e-8)
    assert.ok(cableBounds.y + cableBounds.height <= wires[1].start.y - 24 + 1e-8)
  }
})

test('floor-plan outlet leads use the actual SVG origin and viewBox', () => {
  const path = 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg'
  for (const scale of [0.5, 1, 3]) {
    const node = oneWireSymbolNodeInfo(path, scale)!
    const factor = 24 * scale / 11.5786
    assert.ok(Math.abs(node.offset.x - (0.12 - 8.50772 / 2) * factor) < 1e-8)
    assert.ok(Math.abs(node.offset.y - (5.78 - 11.5786 / 2) * factor) < 1e-8)
  }
})

test('double pushbutton ports touch the actual circle edges in its source SVG', () => {
  const path = 'symbols/Switches/Double push button.svg'
  // Source SVG: two circles, radius 3.2, translated by (0.12, -0.12).
  const contacts = [
    { x: 3.32, y: 0.93197 }, { x: 3.32, y: 7.33197 },
    { x: 0.12, y: 4.13197 }, { x: 13.68, y: 4.13197 }
  ]
  for (const scale of [0.2, 0.5, 1.425, 3]) {
    const shape = symbol(path, { scale })
    const anchors = oneWireSymbolConnectionAnchors(shape)
    for (const [index, contact] of contacts.entries()) {
      const factor = 24 * scale / 13.68
      assert.ok(Math.abs(anchors[index].point.x - (100 + (contact.x - 13.68 / 2) * factor)) < 1e-8)
      assert.ok(Math.abs(anchors[index].point.y - (200 + (contact.y - 8.74394 / 2) * factor)) < 1e-8)
    }
  }
})
