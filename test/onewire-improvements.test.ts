import assert from 'node:assert/strict'
import test from 'node:test'
import type { DragState, LineShape, Shape, SymbolShape, TextShape } from '../src/editor/model/types.ts'
import { applyDragMove } from '../src/editor/interaction/pointer-move.ts'
import { connectedOneWireBranchOwners, followConnectedConductors } from '../src/editor/interaction/connected-conductors.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolScaleFor, oneWireSymbolTerminalInfo } from '../src/editor/layout/onewire-symbol-nodes.ts'
import { buildOneWireTopology } from '../src/editor/layout/onewire-topology.ts'
import { placeOneWireIncomingCable, spaceOneWireTopologyAnnotations } from '../src/editor/layout/onewire-topology-annotations.ts'
import { alignOneWireContent } from '../src/editor/layout/page-scaling.ts'
import { pageLayout } from '../src/editor/layout/page-layout.ts'
import { presentConnectionLabels } from '../src/editor/layout/connection-label-presentation.ts'
import { paperTextContentMarkup, paperTextLinesForShape } from '../src/editor/layout/paper-text-layout.ts'
import { protectionAnnotationBounds, protectionDescriptionLayout, protectionPhaseLabelLayout } from '../src/editor/layout/protection-label-layout.ts'
import { symbolTextPresentation } from '../src/editor/symbol-metadata.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import { placeOneWireFamilyLabels } from '../src/editor/layout/onewire-annotation-layout.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { reconcileGeneratedOneWire } from '../src/editor/layout/onewire-regeneration.ts'
import { bindingLabelsMarkup } from '../src/editor/svg-templates.ts'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const wire = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): LineShape =>
  ({ id, kind: 'line', start, end, connection: { kind: 'wire', showLabel: false }, strokeWidth: 2 })

const familyLabelFixture = () => {
  const breaker: SymbolShape = { id: 'breaker', kind: 'symbol', name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg', scale: 3, position: { x: 400, y: 600 },
    bindingId: 'BP', groupId: 'onewire-BP', sourceLink: { kind: 'board', id: 'BP', role: 'breaker' } }
  const bottom = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')!.point
  const label: TextShape = { id: 'label', kind: 'text', text: 'BP', textAnchor: 'middle', scale: 22 / 18,
    position: { x: bottom.x, y: bottom.y + 64 }, groupId: breaker.groupId, bindingId: 'BP',
    generationKey: 'board:BP:label', sourceLink: { kind: 'board', id: 'BP', role: 'label' } }
  const feed = { ...wire('supply', bottom, { x: bottom.x, y: bottom.y + 240 }), bindingId: 'BP' }
  return { breaker, label, feed, shapes: [breaker, label, feed] }
}

test('places circuit headings beside continuous feeds without moving devices or already clear labels', () => {
  const { breaker, label, feed, shapes } = familyLabelFixture()
  const original = structuredClone(shapes)
  const placed = placeOneWireFamilyLabels(shapes)
  const heading = placed.find((shape) => shape.id === label.id)!
  const bounds = oneWireLayoutBounds(heading)
  assert.ok(bounds.x + bounds.width <= feed.start.x - 9)
  assert.equal(heading.kind === 'text' && heading.position.y, label.position.y)
  assert.equal(placed.find((shape) => shape.id === breaker.id), breaker)
  assert.equal(placed.find((shape) => shape.id === feed.id), feed)
  assert.deepEqual(shapes, original)
  assert.deepEqual(placeOneWireFamilyLabels(placed), placed)
  assert.deepEqual(placeOneWireFamilyLabels([breaker, label]), [breaker, label])
  assert.deepEqual(placeOneWireFamilyLabels([{ ...label, locked: true }, feed]), [{ ...label, locked: true }, feed])
  const neighbour = wire('neighbour', { x: feed.start.x - 28, y: feed.start.y }, { x: feed.end.x - 28, y: feed.end.y })
  const alternative = placeOneWireFamilyLabels([...shapes, neighbour]).find((shape) => shape.id === label.id)!
  assert.ok(oneWireLayoutBounds(alternative).x >= feed.start.x + 9)
})

test('circuit label position choices are stable, reset to automatic and survive regeneration', () => {
  const { breaker, label, feed, shapes } = familyLabelFixture()
  const context = { selectedIds: new Set([breaker.id]), selectedId: breaker.id, groupedSelection: false }
  const groupedNeighbour: SymbolShape = { ...breaker, id: 'neighbour', position: { x: 900, y: 600 },
    bindingId: 'BQ', sourceLink: { kind: 'board', id: 'BQ', role: 'breaker' } }
  const automatic = placeOneWireFamilyLabels([groupedNeighbour, ...shapes])
  const right = updateSelectionProperties(automatic, { bindingLabelSide: 'right' }, context)!
  const heading = right.find((shape): shape is TextShape => shape.id === label.id)!
  close(oneWireLayoutBounds(heading).x, feed.start.x + 8)
  assert.deepEqual(updateSelectionProperties(right, { bindingLabelSide: 'right' }, context), right)
  assert.deepEqual(placeOneWireFamilyLabels(right), right)
  const restored = sanitizeShapes(right)
  assert.deepEqual(restored.find((shape) => shape.id === label.id)?.bindingLabelOffset, heading.bindingLabelOffset)
  const fresh = { ...label, id: 'fresh-label', position: { x: label.position.x + 200, y: label.position.y + 100 } }
  const regenerated = reconcileGeneratedOneWire(restored, [fresh]).shapes[0] as TextShape
  assert.deepEqual(regenerated.bindingLabelOffset, heading.bindingLabelOffset)
  assert.deepEqual(regenerated.position, { x: heading.position.x + 200, y: heading.position.y + 100 })
  const reset = updateSelectionProperties(right, { bindingLabelSide: 'auto' }, context)!
  assert.deepEqual(reset, automatic)
  assert.equal(reset.find((shape) => shape.id === feed.id), feed)
})

test('renders one circuit heading without a duplicate binding label while retaining point identifiers', () => {
  const { label, feed } = familyLabelFixture()
  const point: SymbolShape = { id: 'point', kind: 'symbol', name: 'Motor', path: 'motor.svg',
    position: { x: 800, y: 800 }, scale: 1, bindingId: 'BP1' }
  const markup = bindingLabelsMarkup([label, feed, point])
  assert.doesNotMatch(markup, />BP<\/text>/)
  assert.match(markup, />BP1<\/text>/)
  assert.match(bindingLabelsMarkup([{ ...label, hidden: true }, feed]), />BP<\/text>/)
})

test('rail packing owns complete ungrouped branches without claiming crossings, neighbours or rail feeders', () => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const a: SymbolShape = { id: 'a', kind: 'symbol', name: 'Automaat', path,
    scale: oneWireSymbolScaleFor(path)!, position: { x: 400, y: 600 } }
  const b: SymbolShape = { ...a, id: 'b', position: { x: 700, y: 600 } }
  const [top, bottom] = oneWireSymbolConnectionAnchors(a).map(({ point }) => point)
  const rail: LineShape = { id: 'rail', kind: 'line', groupId: 'onewire-kamrail-test',
    start: { x: bottom.x - 100, y: bottom.y }, end: { x: bottom.x + 400, y: bottom.y } }
  const meter: SymbolShape = { id: 'meter', kind: 'symbol', name: 'kWh meter',
    path: 'symbols/Consumption appliances/kWh meter.svg', scale: 3, position: { x: 0, y: 0 } }
  const offset = oneWireSymbolConnectionAnchors(meter).find(({ side }) => side === 'bottom')!.point
  const end = { x: top.x, y: top.y - 100 }
  meter.position = { x: end.x - offset.x, y: end.y - offset.y }
  const shapes: Shape[] = [rail, a, b, meter, wire('trunk', top, end),
    wire('tap', { x: top.x, y: top.y - 50 }, { x: top.x + 80, y: top.y - 50 }),
    wire('crossing', { x: top.x - 30, y: top.y - 70 }, { x: top.x + 30, y: top.y - 70 }),
    wire('nearby', { x: top.x + 1, y: top.y }, { x: top.x + 1, y: top.y - 40 }),
    wire('rail-feeder', bottom, { x: bottom.x + 300, y: bottom.y })]
  const original = structuredClone(shapes)
  const owners = connectedOneWireBranchOwners(shapes, new Map([['a', 'a'], ['b', 'b']]))
  for (const id of ['a', 'meter', 'trunk', 'tap']) assert.equal(owners.get(id), 'a')
  assert.equal(owners.get('b'), 'b')
  for (const id of ['rail', 'crossing', 'nearby', 'rail-feeder']) assert.equal(owners.has(id), false)
  assert.deepEqual(shapes, original)
})

test('rail packing leaves ambiguous shared branches and locked or hidden objects independent', () => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const a: SymbolShape = { id: 'a', kind: 'symbol', name: 'Automaat', path, scale: 3, position: { x: 400, y: 600 } }
  const b: SymbolShape = { ...a, id: 'b', position: { x: 700, y: 600 } }
  const start = oneWireSymbolConnectionAnchors(a).find(({ side }) => side === 'top')!.point
  const end = oneWireSymbolConnectionAnchors(b).find(({ side }) => side === 'top')!.point
  const shared = wire('shared', start, end)
  const locked = { ...wire('locked', start, { x: start.x, y: start.y - 100 }), locked: true }
  const hidden = { ...wire('hidden', end, { x: end.x, y: end.y - 100 }), hidden: true }
  const tap = wire('tap', { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: start.y - 100 })
  const owners = connectedOneWireBranchOwners([a, b, shared, locked, hidden, tap], new Map([['a', 'a'], ['b', 'b']]))
  assert.deepEqual(owners, new Map([['a', 'a'], ['b', 'b']]))
})

test('rail packing does not drag locked devices or independent inter-board feeders through an attached branch', () => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const device: SymbolShape = { id: 'device', kind: 'symbol', name: 'Automaat', path, scale: 3, position: { x: 400, y: 600 } }
  const [top, bottom] = oneWireSymbolConnectionAnchors(device).map(({ point }) => point)
  const locked: SymbolShape = { ...device, id: 'locked', locked: true, position: { x: 200, y: 300 } }
  const contact = oneWireSymbolConnectionAnchors(locked).find(({ side }) => side === 'bottom')!.point
  const toLocked = wire('to-locked', top, contact)
  const upper: LineShape = { id: 'upper', kind: 'line', groupId: 'onewire-kamrail-upper',
    start: { x: top.x - 100, y: 100 }, end: { x: top.x + 500, y: 100 } }
  const lower: LineShape = { ...upper, id: 'lower', groupId: 'onewire-kamrail-lower',
    start: { x: top.x - 100, y: bottom.y }, end: { x: top.x + 500, y: bottom.y } }
  const feeder = wire('feeder', { x: top.x + 200, y: 100 }, { x: top.x + 200, y: bottom.y })
  const tap = wire('tap', top, { x: feeder.start.x, y: (feeder.start.y + feeder.end.y) / 2 })
  const owners = connectedOneWireBranchOwners([device, locked, toLocked, upper, lower, feeder, tap], new Map([['device', 'device']]))
  assert.deepEqual(owners, new Map([['device', 'device']]))
})

test('rail packing stops at an upstream differential instead of owning its supply branch', () => {
  const breaker: SymbolShape = { id: 'breaker', kind: 'symbol', name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg', scale: 3, position: { x: 400, y: 600 } }
  const top = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'top')!.point
  const differential: SymbolShape = { ...breaker, id: 'differential', name: 'Differentieel',
    groupId: 'supply-group', path: 'symbols/Protection devices/Residual-current circuit breaker.svg' }
  const offset = oneWireSymbolTerminalInfo(differential.path, differential.scale)!.bottom
  differential.position = { x: top.x - offset.x, y: top.y - 100 - offset.y }
  const ports = oneWireSymbolConnectionAnchors(differential)
  const feeder = wire('feeder', top, ports.find((anchor) => anchor.side === 'bottom')!.point)
  const supply = wire('supply', ports.find((anchor) => anchor.side === 'top')!.point, { x: top.x, y: top.y - 400 })
  const owners = connectedOneWireBranchOwners([breaker, differential, feeder, supply], new Map([[breaker.id, breaker.id]]))
  assert.deepEqual(owners, new Map([[breaker.id, breaker.id]]))
})

test('dragging a symbol repeatedly keeps both contacts attached and leaves remote ends fixed', () => {
  const path = 'symbols/Protection devices/Automaat.svg'
  const device: SymbolShape = { id: 'device', kind: 'symbol', name: 'Automaat', path,
    scale: oneWireSymbolScaleFor(path)!, position: { x: 400, y: 600 } }
  const [top, bottom] = oneWireSymbolConnectionAnchors(device).map(({ point }) => point)
  const source: Shape[] = [device, wire('upper', { x: top.x, y: top.y - 100 }, top),
    wire('lower', bottom, { x: bottom.x, y: bottom.y + 100 }),
    wire('unrelated', { x: top.x + 10, y: top.y }, { x: top.x + 10, y: top.y - 80 })]
  const copy = structuredClone(source)
  const drag: DragState = { ids: ['device'], initial: [structuredClone(device)], pointerStart: { x: 0, y: 0 } }
  let current = source
  for (const delta of [{ x: 40, y: 25 }, { x: 80, y: 30 }, { x: 0, y: 0 }]) {
    current = applyDragMove(delta, drag, (point) => point, current, 1, true)
    const moved = current[0] as SymbolShape
    const [a, b] = oneWireSymbolConnectionAnchors(moved).map(({ point }) => point)
    assert.deepEqual((current[1] as LineShape).end, a)
    assert.deepEqual((current[2] as LineShape).start, b)
    assert.deepEqual((current[1] as LineShape).start, (source[1] as LineShape).start)
    assert.deepEqual((current[2] as LineShape).end, (source[2] as LineShape).end)
    assert.deepEqual(current[3], source[3])
  }
  assert.deepEqual(source, copy)
  assert.deepEqual(current, source)
  const changedElsewhere = current.map((shape) => shape.id === 'unrelated' && shape.kind === 'line'
    ? { ...shape, end: { x: shape.end.x + 300, y: shape.end.y } } : shape)
  const continued = applyDragMove({ x: 120, y: 40 }, drag, (point) => point, changedElsewhere, 1, true)
  assert.strictEqual(continued[3], changedElsewhere[3])
})

test('a moved bus retains T junctions at their position along the conductor', () => {
  const bus = wire('bus', { x: 0, y: 100 }, { x: 200, y: 100 })
  const branch = wire('branch', { x: 50, y: 100 }, { x: 50, y: 0 })
  const crossing = wire('crossing', { x: 70, y: 0 }, { x: 70, y: 200 })
  const moved = { ...bus, start: { x: 100, y: 150 }, end: { x: 300, y: 150 } }
  const result = followConnectedConductors([bus, branch, crossing], [moved, branch, crossing], new Set(['bus']))
  assert.deepEqual((result[1] as LineShape).start, { x: 150, y: 150 })
  assert.deepEqual((result[1] as LineShape).end, branch.end)
  assert.strictEqual(result[2], crossing)
})

test('rotating and mirroring a device keep wires on its source contacts', () => {
  const device: SymbolShape = { id: 'device', kind: 'symbol', name: 'RCD',
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    scale: 5, position: { x: 400, y: 500 } }
  const [top, bottom] = oneWireSymbolConnectionAnchors(device).map(({ point }) => point)
  const source = [device, wire('a', { x: top.x, y: top.y - 100 }, top), wire('b', bottom, { x: bottom.x, y: bottom.y + 100 })]
  for (const transform of [{ rotation: 90 }, { rotation: 45, flipX: true }, { scale: 6 }]) {
    const moved = { ...device, ...transform }
    const result = followConnectedConductors(source, [moved, source[1], source[2]], new Set(['device']))
    const ports = oneWireSymbolConnectionAnchors(moved)
    assert.deepEqual((result[1] as LineShape).end, ports[0].point)
    assert.deepEqual((result[2] as LineShape).start, ports[1].point)
  }
})

test('wrapped names keep the incoming cable before the main breaker and survive serialization', () => {
  let id = 0
  const initial = buildOneWireTopology({ version: 1, consumers: true, solar: false, residualBreaker: false,
    additionalDifferentials: [{ count: 1, purpose: 'consumers', sensitivityMa: 30 }],
    mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 }, incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' } },
  { start: { x: 100, y: 600 }, end: { x: 900, y: 600 } }, () => `${++id}`)
  const device = initial.find((shape) => shape.sourceLink?.role === 'main-differential') as SymbolShape
  device.symbolTextOverrides!.description = 'Algemene differentieel voor de volledige woning en garage'
  const mainSwitch = initial.find((shape) => shape.sourceLink?.role === 'main-switch') as SymbolShape
  mainSwitch.symbolTextOverrides!.description = 'Hoofdautomaat voor de volledige elektrische installatie'
  const incoming = initial.find((shape) => shape.sourceLink?.role === 'grid-incoming') as LineShape
  incoming.connection!.name = 'Voeding woning & garage met afzonderlijke kabel naar verdeelbord'
  const branch = initial.find((shape) => shape.kind === 'symbol' && shape.sourceLink?.role.startsWith('additional-differential-')) as SymbolShape
  branch.symbolTextOverrides!.description = 'Beveiliging van alle stopcontacten in de garage en de keuken'
  const spaced = spaceOneWireTopologyAnnotations(presentConnectionLabels(initial))
  const caption = spaced.find((shape) => shape.sourceLink?.role === 'incoming-cable-label')!
  const meter = spaced.find((shape) => shape.sourceLink?.role === 'meter') as SymbolShape
  assert.equal(caption.kind, 'text')
  if (caption.kind !== 'text') return
  assert.ok(paperTextLinesForShape(caption).length > 1)
  assert.match(paperTextContentMarkup(caption), /&amp;/)
  assert.match(symbolTextPresentation(device).annotations, /<tspan/)
  const name = protectionDescriptionLayout(device)!
  const lastName = name.y + (name.lines.length - 1) * name.lineHeight
  assert.ok(oneWireLayoutBounds(caption).y > lastName)
  const meterTop = meter.position.y + oneWireSymbolTerminalInfo(meter.path, meter.scale)!.top!.y
  close(meterTop, Math.max(device.position.y + oneWireSymbolTerminalInfo(device.path, device.scale)!.bottom!.y + 40, lastName + 48))
  const movedSwitch = spaced.find((shape) => shape.id === mainSwitch.id) as SymbolShape
  const switchName = protectionDescriptionLayout(movedSwitch)!
  assert.ok(oneWireLayoutBounds(caption).y > switchName.y + (switchName.lines.length - 1) * switchName.lineHeight)
  const cable = spaced.find((shape) => shape.id === incoming.id) as LineShape
  close(cable.end.y - (oneWireLayoutBounds(caption).y + oneWireLayoutBounds(caption).height), 20)
  assert.deepEqual(cable.start, oneWireSymbolConnectionAnchors(movedSwitch).find((anchor) => anchor.side === 'bottom')!.point)
  assert.ok(protectionPhaseLabelLayout(device)!.y >= lastName + 28)
  const movedBranch = spaced.find((shape) => shape.id === branch.id) as SymbolShape
  const feed = spaced.find((shape) => shape.sourceLink?.role === `${branch.sourceLink!.role}-to-rail`) as LineShape
  const branchText = protectionAnnotationBounds(movedBranch)!
  assert.ok(branchText.y + branchText.height <= feed.start.y - 24 + 1e-8)
  assert.deepEqual(spaceOneWireTopologyAnnotations(spaced), spaced)
  assert.equal((sanitizeShapes(spaced).find((shape) => shape.id === incoming.id) as LineShape).connection?.name, incoming.connection!.name)

  const area = pageLayout(2376, 1680).content
  const centered = alignOneWireContent(spaced, area)
  const boxes = centered.shapes.filter((shape) => !shape.hidden).map(oneWireLayoutBounds)
  const minX = Math.min(...boxes.map((box) => box.x)), maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  close((minX + maxX) / 2, area.x + area.width / 2)
  close(maxY, area.y + area.height - 24)
  assert.equal((centered.shapes.find((shape) => shape.id === device.id) as SymbolShape).scale, device.scale)
  assert.equal(alignOneWireContent(centered.shapes, area).changed, false)
})

test('repairs legacy EXVB ownership before the main breaker without moving devices or losing cable edits', () => {
  for (const hidden of [false, true]) {
    let id = 0
    const plan = { version: 1 as const, consumers: true, solar: false, residualBreaker: false,
      mainDifferential: { ratedCurrentA: 40, sensitivityMa: 300 },
      incomingCable: { conductors: 4, sectionMm2: 10, cableType: 'EXVB' } }
    const rail = { start: { x: 100, y: 600 }, end: { x: 900, y: 600 } }
    const legacy = buildOneWireTopology(plan, rail, () => `${++id}`)
    const grid = legacy.find((shape) => shape.sourceLink?.role === 'grid-incoming') as LineShape
    const oldIncoming = legacy.find((shape) => shape.sourceLink?.role === 'incoming') as LineShape
    oldIncoming.connection = { ...grid.connection!, name: 'Eigen netvoeding EXVB', showLabel: !hidden, offsetMm: 7 }
    grid.connection = { kind: 'wire', showLabel: false }
    grid.end.y = grid.start.y + 36
    const caption = legacy.find((shape) => shape.sourceLink?.role === 'incoming-cable-label') as TextShape
    caption.position.y = oldIncoming.start.y - 24
    caption.hidden = hidden
    const before = structuredClone(legacy)
    const repaired = placeOneWireIncomingCable(legacy)
    assert.equal(repaired.changed, true)
    assert.deepEqual(legacy, before)
    assert.deepEqual(repaired.shapes.map((shape) => shape.id), legacy.map((shape) => shape.id))
    for (const device of legacy.filter((shape) => shape.kind === 'symbol')) {
      assert.equal(repaired.shapes.find((shape) => shape.id === device.id), device)
    }
    const cable = repaired.shapes.find((shape) => shape.id === grid.id) as LineShape
    assert.deepEqual(cable.connection, oldIncoming.connection)
    assert.deepEqual(cable.start, grid.start)
    assert.equal(cable.energyFlow, grid.energyFlow)
    assert.deepEqual((repaired.shapes.find((shape) => shape.id === oldIncoming.id) as LineShape).connection,
      { kind: 'wire', showLabel: false })
    const label = repaired.shapes.find((shape) => shape.id === caption.id) as TextShape
    assert.ok(label.position.y > grid.start.y)
    assert.equal(label.hidden, hidden)
    assert.equal(placeOneWireIncomingCable(repaired.shapes).changed, false)
    assert.deepEqual(placeOneWireIncomingCable(sanitizeShapes(repaired.shapes)).shapes, sanitizeShapes(repaired.shapes))

    const fresh = buildOneWireTopology({ ...plan, incomingCable: { ...plan.incomingCable, sectionMm2: 16 } },
      rail, () => `${++id}`)
    const regenerated = placeOneWireIncomingCable(reconcileGeneratedOneWire(legacy, fresh).shapes).shapes
    const regeneratedCable = regenerated.find((shape) => shape.id === grid.id) as LineShape
    assert.equal(regeneratedCable.connection?.sectionMm2, 16)
    assert.equal(regeneratedCable.connection?.kind, 'cable')
    assert.equal(regeneratedCable.connection?.name, oldIncoming.connection.name)
    assert.equal(regeneratedCable.connection?.showLabel, !hidden)
    assert.equal(regeneratedCable.connection?.offsetMm, 7)
  }
})

test('leaves supply conductors without an incoming cable configuration unchanged', () => {
  let id = 0
  const shapes = buildOneWireTopology({ version: 1, consumers: true, solar: false, residualBreaker: false },
    { start: { x: 100, y: 600 }, end: { x: 900, y: 600 } }, () => `${++id}`)
  const grid = shapes.find((shape) => shape.sourceLink?.role === 'grid-incoming') as LineShape
  grid.end.y += 150
  const repaired = placeOneWireIncomingCable(shapes)
  assert.equal(repaired.changed, false)
  assert.deepEqual(repaired.shapes, shapes)
})
