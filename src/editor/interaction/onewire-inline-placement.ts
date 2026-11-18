import type { LineShape, Point, Shape, SymbolShape } from '../model/types.js'
import { connectionPoints } from '../model/electrical-connection.js'
import { oneWireLayoutBounds, oneWireSymbolConnectionAnchors } from '../layout/onewire-connections.js'
import { oneWireSymbolNodeInfo, oneWireSymbolRotationFor, oneWireSymbolTerminalInfo } from '../layout/onewire-symbol-nodes.js'
import { isOneWireRailShape } from '../layout/onewire-regeneration.js'
import { connectedOneWireBranchOwners } from './connected-conductors.js'
import { translateShape } from './shape-transforms.js'

export type OneWireInlinePlacement = {
  symbol: SymbolShape
  conductor: LineShape
  point: Point
  cut: { before: Point[]; after: Point[] } | null
  shiftedShapes?: Shape[]
}

const makeRoomAbove = (
  shapes: readonly Shape[], conductor: LineShape, points: Point[], index: number, target: Point, symbol: SymbolShape
): Shape[] | { error: string } | null => {
  const startsAbove = points[index].y < points[index + 1].y
  const upperPoints = startsAbove ? [...points.slice(0, index + 1), { ...target, y: target.y - 0.001 }]
    : [{ ...target, y: target.y - 0.001 }, ...points.slice(index + 1)]
  const lowerPoints = startsAbove ? [{ ...target, y: target.y + 0.001 }, ...points.slice(index + 1)]
    : [...points.slice(0, index + 1), { ...target, y: target.y + 0.001 }]
  let lowerId = `${conductor.id}:inline-lower`
  while (shapes.some((shape) => shape.id === lowerId)) lowerId += ':'
  const section = (id: string, route: Point[]): LineShape => ({
    ...conductor, id, start: route[0], end: route.at(-1)!,
    connection: { ...(conductor.connection ?? { kind: 'wire' }), via: route.slice(1, -1) }
  })
  const family = (shape: Shape) => (shape.bindingId ??
    (shape.sourceLink?.kind === 'board' || shape.sourceLink?.kind === 'circuit' ? shape.sourceLink.id : '')).replace(/\d+$/, '')
  const circuit = family(conductor)
  const candidates = shapes.filter((shape) => shape.id !== conductor.id &&
    (isOneWireRailShape(shape) || ((!circuit || !family(shape) || family(shape) === circuit) &&
      (!conductor.oneWireRailId || !shape.oneWireRailId || shape.oneWireRailId === conductor.oneWireRailId))))
  const owners = connectedOneWireBranchOwners([
    ...candidates.map((shape) => shape.locked ? { ...shape, locked: false } : shape),
    section(conductor.id, upperPoints), section(lowerId, lowerPoints)
  ], new Map([[conductor.id, 'upper'], [lowerId, 'lower']]))
  const moved = new Set(candidates.filter((shape) => owners.get(shape.id) === 'upper').map((shape) => shape.id))
  const members = candidates.filter((shape) => moved.has(shape.id))
  const groups = new Set(members.flatMap((shape) => shape.groupId ? [shape.groupId] : []))
  const bindings = new Set(members.flatMap((shape) => shape.bindingId ? [shape.bindingId] : []))
  for (const shape of candidates) {
    if (shape.kind === 'text' && !/^(?:label|breaker-.*|cable-section|description)$/.test(shape.sourceLink?.role ?? '') &&
      ((shape.groupId && groups.has(shape.groupId)) || (shape.bindingId && bindings.has(shape.bindingId))) &&
      oneWireLayoutBounds(shape).y < target.y) moved.add(shape.id)
  }
  if (!moved.size) return null
  const bottom = Math.max(...candidates.filter((shape) => moved.has(shape.id)).map((shape) => {
    const bounds = oneWireLayoutBounds(shape)
    return bounds.y + bounds.height
  }))
  const delta = Math.min(0, oneWireLayoutBounds(symbol).y - 24 - bottom)
  if (delta > -1e-8) return null
  if (candidates.some((shape) => moved.has(shape.id) && shape.locked)) {
    return { error: 'De rijen erboven zijn vergrendeld. Ontgrendel ze eerst om ruimte voor dit symbool te maken.' }
  }
  const route = points.map((point, i) => (startsAbove ? i <= index : i > index) ? { ...point, y: point.y + delta } : point)
  return shapes.map((shape) => shape.id === conductor.id ? section(conductor.id, route)
    : moved.has(shape.id) ? translateShape(shape, 0, delta) : shape)
}

export const planOneWireInlinePlacement = (
  shapes: readonly Shape[],
  symbol: SymbolShape,
  point: Point,
  preserveRotation = false,
  spaceRows = true
): OneWireInlinePlacement | { error: string } | null => {
  const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale)
  const terminals = oneWireSymbolTerminalInfo(symbol.path, symbol.scale)
  if (!node && (!terminals?.top || !terminals.bottom)) return null
  let nearest: { conductor: LineShape; points: Point[]; index: number; point: Point; distance: number } | undefined
  for (const shape of shapes) {
    if (shape.kind !== 'line' || shape.hidden || isOneWireRailShape(shape) || shape.connection?.kind === 'bridge') continue
    const points = connectionPoints(shape)
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index], end = points[index + 1]
      const dx = end.x - start.x, dy = end.y - start.y
      const length = dx * dx + dy * dy
      if (length < 1e-8 || (Math.abs(dx) > 1e-8 && Math.abs(dy) > 1e-8)) continue
      const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
      const projected = { x: start.x + fraction * dx, y: start.y + fraction * dy }
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y)
      if (distance < 18 && (!nearest || distance < nearest.distance)) nearest = { conductor: shape, points, index, point: projected, distance }
    }
  }
  if (!nearest) return null
  if (nearest.conductor.locked) return { error: 'Deze draad is vergrendeld. Ontgrendel hem eerst om een symbool in te voegen.' }
  const { conductor, points, index, point: target } = nearest
  const start = points[index], end = points[index + 1]
  const vertical = Math.abs(start.x - end.x) < 1e-8
  const rotation = (symbol.rotation ?? oneWireSymbolRotationFor(symbol.path) ?? 0) +
    (preserveRotation ? 0 : terminals?.top && terminals.bottom ? (vertical ? 0 : -90) : (vertical ? -90 : 0))
  const probe = { ...symbol, position: { x: 0, y: 0 }, rotation }
  const offset = oneWireSymbolNodeInfo(probe.path, probe.scale, rotation)?.offset ?? (() => {
    const ports = oneWireSymbolConnectionAnchors(probe)
    return { x: (ports[0].point.x + ports[1].point.x) / 2, y: (ports[0].point.y + ports[1].point.y) / 2 }
  })()
  const placed: SymbolShape = {
    ...probe, position: { x: target.x - offset.x, y: target.y - offset.y },
    bindingId: conductor.bindingId ?? (conductor.sourceLink?.kind === 'board' ? conductor.sourceLink.id : undefined),
    oneWireRailId: conductor.oneWireRailId,
    sourceLink: { kind: 'circuit',
      id: conductor.sourceLink?.kind === 'board' || conductor.sourceLink?.kind === 'circuit'
        ? conductor.sourceLink.id : conductor.bindingId ?? conductor.id,
      role: 'inline' }
  }
  if (vertical && spaceRows) {
    const room = makeRoomAbove(shapes, conductor, points, index, target, placed)
    if (room) {
      if (!Array.isArray(room)) return room
      const plan = planOneWireInlinePlacement(room, placed, target, true, false)
      return plan && !('error' in plan) ? { ...plan, shiftedShapes: room } : plan
    }
  }
  if (node?.cutHalfWidth === null || node?.cutHalfWidth === 0) return { symbol: placed, conductor, point: target, cut: null }
  const axis = vertical ? 'y' : 'x'
  const across = vertical ? 'x' : 'y'
  const contacts = oneWireSymbolConnectionAnchors(placed).filter(({ side }) =>
    vertical ? side === 'top' || side === 'bottom' : side === 'left' || side === 'right')
    .map(({ point }) => point).sort((a, b) => (a[axis] - b[axis]) * Math.sign(end[axis] - start[axis]))
  if (contacts.length !== 2 || contacts.some((contact) => Math.abs(contact[across] - target[across]) > 1e-8)) {
    return { error: 'Dit symbool kan niet recht in deze draad worden ingevoegd.' }
  }
  const min = Math.min(contacts[0][axis], contacts[1][axis]), max = Math.max(contacts[0][axis], contacts[1][axis])
  const inCut = (point: Point) => Math.abs(point[across] - target[across]) < 1e-8 && point[axis] > min + 1e-8 && point[axis] < max - 1e-8
  if (min <= Math.min(start[axis], end[axis]) + 1e-8 || max >= Math.max(start[axis], end[axis]) - 1e-8 ||
    shapes.some((shape) => !shape.hidden && shape.id !== conductor.id &&
      (shape.kind === 'line' ? connectionPoints(shape).some(inCut)
        : shape.kind === 'symbol' && oneWireSymbolConnectionAnchors(shape).some(({ point }) => inCut(point))))) {
    return { error: 'Hier is onvoldoende vrije draad voor dit symbool. Kies een punt verder van een aansluiting of aftakking.' }
  }
  return { symbol: placed, conductor, point: target,
    cut: { before: [...points.slice(0, index + 1), contacts[0]], after: [contacts[1], ...points.slice(index + 1)] } }
}

export const insertOneWireInlinePlacement = (
  shapes: readonly Shape[],
  placement: OneWireInlinePlacement,
  nextId: () => string
): { shapes: Shape[]; symbol: SymbolShape } => {
  const id = nextId()
  const symbol = placement.symbol.id === id ? placement.symbol : { ...placement.symbol, id }
  const prepared = placement.shiftedShapes ?? shapes
  if (!placement.cut) return { shapes: [...prepared, symbol], symbol }
  const { conductor, cut } = placement
  const section = (points: Point[], additional: boolean): LineShape => ({
    ...conductor, id: additional ? nextId() : conductor.id,
    start: points[0], end: points.at(-1)!,
    ...(additional ? { generationKey: undefined, groupId: undefined,
      sourceLink: { kind: 'circuit', id: symbol.sourceLink!.id, role: `inline-wire:${symbol.id}` } } : {}),
    connection: { ...(conductor.connection ?? { kind: 'wire' }),
      via: points.slice(1, -1), ...(additional ? { labelOwner: undefined, showLabel: false } : {}) }
  })
  return { shapes: [...prepared.flatMap((shape) => shape.id === conductor.id
    ? [section(cut.before, false), section(cut.after, true)] : [shape]), symbol], symbol }
}

export const repairOneWireInlineConnections = (shapes: readonly Shape[], nextId: () => string): Shape[] => {
  let next = [...shapes]
  for (const original of shapes.filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && shape.sourceLink?.role === 'inline' && !shape.hidden)) {
    const symbol = next.find((shape): shape is SymbolShape => shape.kind === 'symbol' && shape.id === original.id)!
    const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale, symbol.rotation)
    const ports = oneWireSymbolConnectionAnchors(symbol)
    const point = node ? { x: symbol.position.x + node.offset.x, y: symbol.position.y + node.offset.y }
      : { x: (ports[0].point.x + ports[1].point.x) / 2, y: (ports[0].point.y + ports[1].point.y) / 2 }
    const previous = next.find((shape): shape is LineShape =>
      shape.kind === 'line' && shape.sourceLink?.role === `inline-wire:${symbol.id}`)
    const candidates = next.filter((shape) => shape !== previous && shape.id !== symbol.id)
    const plan = planOneWireInlinePlacement(candidates, symbol, point, true)
    if (!plan || 'error' in plan || !plan.cut || Math.hypot(plan.point.x - point.x, plan.point.y - point.y) > 1e-8) continue
    let first = true
    next = insertOneWireInlinePlacement(candidates,
      { ...plan, symbol }, () => {
        if (first) { first = false; return symbol.id }
        return previous?.id ?? nextId()
      }).shapes.map((shape) => shape.kind === 'line' && previous && shape.id === previous.id
        ? { ...previous, start: shape.start, end: shape.end,
            connection: previous.connection ? { ...previous.connection, via: shape.connection?.via } : shape.connection } : shape)
  }
  return next
}
