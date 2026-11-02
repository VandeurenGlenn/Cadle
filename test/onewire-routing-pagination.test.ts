import assert from 'node:assert/strict'
import test from 'node:test'
import type { LineShape, Shape, SymbolShape } from '../src/editor/model/types.ts'
import { followConnectedConductors } from '../src/editor/interaction/connected-conductors.ts'
import { connectionPoints, connectionSegments } from '../src/editor/model/electrical-connection.ts'
import { findConnectionIssues } from '../src/editor/layout/connection-issues.ts'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../src/editor/layout/onewire-symbol-nodes.ts'
import { buildKamrailCircuitBundle } from '../src/editor/layout/onewire-helpers.ts'
import { paginateOneWireCircuits } from '../src/editor/layout/onewire-overflow.ts'
import { cloneShape, sanitizeShapes } from '../src/editor/model/model.ts'
import { translateShape } from '../src/editor/interaction/shape-transforms.ts'

const wire = (id: string, start: { x: number; y: number }, end: { x: number; y: number }): LineShape =>
  ({ id, kind: 'line', start, end, connection: { kind: 'wire', showLabel: false }, strokeWidth: 2 })
const onRoute = (point: { x: number; y: number }, shape: LineShape) => connectionSegments(shape).some(({ start, end }) =>
  Math.abs(start.x - end.x) < 1e-8 ? Math.abs(point.x - start.x) < 1e-8 && point.y >= Math.min(start.y, end.y) - 1e-8 && point.y <= Math.max(start.y, end.y) + 1e-8
    : Math.abs(point.y - start.y) < 1e-8 && point.x >= Math.min(start.x, end.x) - 1e-8 && point.x <= Math.max(start.x, end.x) + 1e-8)

test('reroutes a moved contact with right angles and keeps intermediate T junctions fixed', () => {
  const device: SymbolShape = { id: 'device', kind: 'symbol', name: 'Automaat',
    path: 'symbols/Protection devices/Automaat.svg', scale: 4, position: { x: 400, y: 500 } }
  const top = oneWireSymbolConnectionAnchors(device)[0].point
  const feed = wire('feed', top, { x: top.x, y: top.y - 300 })
  const junction = { x: top.x, y: top.y - 150 }
  const branch = wire('branch', junction, { x: junction.x + 100, y: junction.y })
  const moved = { ...device, position: { x: 480, y: 530 } }
  const result = followConnectedConductors([device, feed, branch], [moved, feed, branch], new Set(['device']))
  const routed = result[1] as LineShape
  assert.ok(connectionSegments(routed).every(({ start, end }) => start.x === end.x || start.y === end.y))
  assert.ok(onRoute(junction, routed))
  assert.deepEqual((result[2] as LineShape).start, junction)
  assert.deepEqual((sanitizeShapes(result)[1] as LineShape).connection, routed.connection)
  const cloned = cloneShape(routed) as LineShape
  cloned.connection!.via![0].x += 10
  assert.notDeepEqual(cloned.connection!.via, routed.connection!.via)
  const translated = translateShape(routed, 40, 20) as LineShape
  assert.deepEqual(connectionPoints(translated), connectionPoints(routed).map(({ x, y }) => ({ x: x + 40, y: y + 20 })))
})

test('moving an inline lamp reroutes the continuous wire through its new connection point', () => {
  const lamp: SymbolShape = { id: 'lamp', kind: 'symbol', name: 'Lamp', path: 'symbols/Consumption appliances/Lighting.svg',
    position: { x: 150, y: 300 }, scale: 1.5 }
  const line = wire('wire', { x: 0, y: 300 }, { x: 300, y: 300 })
  const moved = { ...lamp, position: { x: 150, y: 380 } }
  const result = followConnectedConductors([lamp, line], [moved, line], new Set(['lamp']))
  assert.ok(onRoute(moved.position, result[1] as LineShape))
  assert.ok(connectionSegments(result[1] as LineShape).every(({ start, end }) => start.x === end.x || start.y === end.y))
})

test('marks a near miss but accepts real T junctions and intentional incoming ends', () => {
  const lamp: SymbolShape = { id: 'lamp', kind: 'symbol', name: 'Lamp', path: 'symbols/Consumption appliances/Lighting.svg',
    position: { x: 200, y: 100 }, scale: 1.5 }
  const loose = { ...wire('loose', { x: 200, y: 108 }, { x: 200, y: 300 }), sourceLink: { kind: 'board' as const, id: 'main', role: 'grid-incoming' } }
  const issues = findConnectionIssues([lamp, loose])
  assert.equal(issues.length, 1)
  assert.equal(issues[0].endpoint, 'start')
  assert.deepEqual(issues[0].nearby, lamp.position)
  const bus = { ...wire('bus', { x: 0, y: 200 }, { x: 400, y: 200 }), groupId: 'onewire-kamrail-bus', strokeWidth: 4 }
  assert.equal(findConnectionIssues([bus, { ...loose, start: { x: 200, y: 200 } }]).length, 0)
})

let sequence = 0
const nextId = () => `overflow-${++sequence}`
const rail: LineShape = { id: 'rail', kind: 'line', start: { x: 80, y: 1200 }, end: { x: 2300, y: 1200 },
  strokeWidth: 4, groupId: 'onewire-kamrail-main' }
const circuit = (family: string, anchorX: number, rows: number): Shape[] => buildKamrailCircuitBundle({
  rail, anchorX, options: { family, amps: 16, autoIncludeFamily: true },
  familyComponents: Array.from({ length: rows }, (_, index) => ({ bindingId: `${family}${index + 1}`, kind: 'load' as const,
    sourcePath: 'symbols/Consumption appliances/Lighting.svg', sourceShapeId: `${family}-lamp-${index}` })),
  nextShapeId: nextId, oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
  oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
  symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
})!.shapes.map((shape) => ({ ...shape, oneWireRailId: rail.id }))

const inside = (pages: Shape[][], area: { x: number; y: number; width: number; height: number }) => {
  for (const page of pages) for (const shape of page.filter((shape) => !shape.hidden)) {
    const bounds = oneWireLayoutBounds(shape)
    assert.ok(bounds.x >= area.x - 1e-6 && bounds.y >= area.y - 1e-6, `${shape.id} above/left of page`)
    assert.ok(bounds.x + bounds.width <= area.x + area.width + 1e-6 &&
      bounds.y + bounds.height <= area.y + area.height + 1e-6, `${shape.id} below/right of page`)
  }
}

test('redistributes complete circuits without losing names, device IDs or paper sizes', () => {
  const source = [rail, ...circuit('A', 400, 3), ...circuit('B', 1300, 3), ...circuit('C', 2100, 3)]
  const before = structuredClone(source)
  const area = { x: 80, y: 80, width: 300, height: 1200 }
  const result = paginateOneWireCircuits(source, area, nextId)
  assert.equal(result.changed, true)
  assert.equal(result.fits, true)
  assert.ok(result.pages.length >= 2)
  inside(result.pages, area)
  const devices = source.filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.kind === 'device')
  for (const device of devices) {
    const copies = result.pages.flat().filter((shape) => shape.id === device.id)
    assert.equal(copies.length, 1)
    assert.equal((copies[0] as SymbolShape).scale, (device as SymbolShape).scale)
  }
  assert.deepEqual(source, before)
})

test('splits an oversized family only between complete numbered points', () => {
  const source = [rail, ...circuit('A', 400, 22)]
  const area = { x: 80, y: 80, width: 300, height: 1200 }
  const result = paginateOneWireCircuits(source, area, nextId)
  assert.equal(result.fits, true)
  assert.ok(result.pages.length > 1)
  inside(result.pages, area)
  const loads = result.pages.flat().filter((shape) => shape.kind === 'symbol' && shape.sourceLink?.role === 'load')
  assert.equal(loads.length, 22)
  assert.equal(new Set(loads.map((shape) => shape.id)).size, 22)
  assert.ok(result.pages.every((page) => page.some((shape) => shape.sourceLink?.role === 'breaker')))
})

test('does not partially redistribute a locked circuit', () => {
  const shapes = [rail, ...circuit('A', 400, 3).map((shape) => ({ ...shape, locked: true }))]
  const result = paginateOneWireCircuits(shapes, { x: 80, y: 80, width: 600, height: 500 }, nextId)
  assert.equal(result.changed, false)
  assert.equal(result.fits, false)
  assert.deepEqual(result.pages[0], shapes)
})

test('moving a breaker off a busbar keeps the bar rigid and adds an orthogonal feeder', () => {
  const breaker: SymbolShape = { id: 'breaker', kind: 'symbol', name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg',
    scale: oneWireSymbolScaleFor('symbols/Protection devices/Automaat.svg')!, position: { x: 200, y: 200 } }
  const bottom = oneWireSymbolConnectionAnchors(breaker).find((anchor) => anchor.side === 'bottom')!.point
  const bus: LineShape = { id: 'bus', kind: 'line', start: { x: bottom.x - 100, y: bottom.y }, end: { x: bottom.x + 100, y: bottom.y },
    groupId: 'onewire-kamrail-bus', strokeWidth: 4 }
  const result = followConnectedConductors([breaker, bus], [{ ...breaker, position: { x: 250, y: 150 } }, bus], new Set(['breaker']))
  assert.deepEqual(result.find((shape) => shape.id === 'bus'), bus)
  const feeder = result.find((shape) => shape.kind === 'line' && shape.id !== 'bus') as LineShape
  assert.ok(feeder)
  assert.ok(connectionSegments(feeder).every(({ start, end }) => start.x === end.x || start.y === end.y))
})

test('pagination retains empty manually placed busbars', () => {
  const emptyRail = { ...rail, id: 'empty-rail', start: { x: 110, y: 100 }, end: { x: 210, y: 100 } }
  const result = paginateOneWireCircuits([rail, emptyRail, ...circuit('A', 400, 3), ...circuit('B', 1000, 3)],
    { x: 80, y: 80, width: 300, height: 1200 }, nextId)
  assert.ok(result.pages.flat().some((shape) => shape.id === emptyRail.id))
})
