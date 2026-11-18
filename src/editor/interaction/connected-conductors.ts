import type { LineShape, Point, Shape } from '../model/types.js'
import { connectionSegments } from '../model/electrical-connection.js'
import { oneWireSymbolConnectionAnchors } from '../layout/onewire-connections.js'
import { oneWireSymbolNodeInfo, oneWireSymbolTerminalInfo } from '../layout/onewire-symbol-nodes.js'
import { isOneWireRailShape } from '../layout/onewire-regeneration.js'

const same = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01
const key = (point: Point) => `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`
const fraction = (point: Point, start: Point, end: Point): number | null => {
  const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy
  if (!squared) return same(point, start) ? 0 : null
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared
  return t >= 0 && t <= 1 && same(point, { x: start.x + t * dx, y: start.y + t * dy }) ? t : null
}

export const removeRedundantRailAttachments = (shapes: readonly Shape[]): Shape[] => {
  const rails = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && isOneWireRailShape(shape))
  return shapes.filter((shape) => {
    if (shape.kind !== 'line' || shape.locked || shape.connection?.kind !== 'wire') return true
    const rail = rails.find((candidate) =>
      (shape.oneWireRailId === candidate.id && shape.sourceLink?.role === 'rail-attachment') ||
      shape.id.startsWith(`${candidate.id}-attachment-`))
    if (!rail) return true
    const contained = connectionSegments(shape).every(({ start, end }) =>
      connectionSegments(rail).some((segment) =>
        fraction(start, segment.start, segment.end) !== null && fraction(end, segment.start, segment.end) !== null))
    if (contained) return false
    // Generated feeders with a detached end are stale movement artifacts, not reserved circuits.
    return [shape.start, shape.end].every((point) => shapes.some((other) => {
      if (other.id === shape.id || other.hidden) return false
      return other.kind === 'line'
        ? connectionSegments(other).some((segment) => fraction(point, segment.start, segment.end) !== null)
        : other.kind === 'symbol' && oneWireSymbolConnectionAnchors(other).some((anchor) => same(point, anchor.point))
    }))
  })
}

/** Extend explicit circuit ownership through real contacts, stopping at busbars and shared branches. */
export const connectedOneWireBranchOwners = (
  shapes: readonly Shape[], owners: ReadonlyMap<string, string>
): Map<string, string> => {
  const rails = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && isOneWireRailShape(shape))
  const onRail = (point: Point) => rails.some((rail) => connectionSegments(rail).some((segment) =>
    fraction(point, segment.start, segment.end) !== null))
  const nodes = shapes.filter((shape) => !shape.hidden && !isOneWireRailShape(shape))
  const fixed = new Set(nodes.filter((shape) => shape.locked ||
    (shape.kind === 'line' && !owners.has(shape.id) && onRail(shape.start) && onRail(shape.end)))
    .map((shape) => shape.id))
  const lines = nodes.filter((shape): shape is LineShape => shape.kind === 'line')
  const ports = nodes.flatMap((shape) => {
    const points = shape.kind === 'line' ? [shape.start, shape.end]
      : shape.kind === 'symbol' && (oneWireSymbolNodeInfo(shape.path, shape.scale) || oneWireSymbolTerminalInfo(shape.path, shape.scale))
        ? oneWireSymbolConnectionAnchors(shape).map(({ point }) => point) : []
    return points.filter((point) => !onRail(point)).map((point) => ({ id: shape.id, point }))
  })
  const adjacent = new Map<string, Set<string>>()
  const join = (left: string, right: string) => {
    if (left === right) return
    if (!adjacent.has(left)) adjacent.set(left, new Set())
    if (!adjacent.has(right)) adjacent.set(right, new Set())
    adjacent.get(left)!.add(right)
    adjacent.get(right)!.add(left)
  }
  const byPoint = new Map<string, string[]>()
  for (const { id, point } of ports) {
    const ids = byPoint.get(key(point)) ?? []
    for (const other of ids) join(id, other)
    ids.push(id)
    byPoint.set(key(point), ids)
    for (const line of lines) {
      if (line.id !== id && connectionSegments(line).some((segment) =>
        fraction(point, segment.start, segment.end) !== null)) join(id, line.id)
    }
  }
  const result = new Map(owners)
  const visited = new Set([...owners.keys(), ...fixed])
  for (const shape of nodes) {
    if (visited.has(shape.id)) continue
    const pending = [shape.id], component: string[] = []
    const touchingOwners = new Set<string | null>()
    visited.add(shape.id)
    while (pending.length) {
      const id = pending.pop()!
      component.push(id)
      for (const next of adjacent.get(id) ?? []) {
        const owner = owners.get(next)
        if (fixed.has(next)) touchingOwners.add(null)
        else if (owner !== undefined) touchingOwners.add(owner)
        else if (!visited.has(next)) {
          visited.add(next)
          pending.push(next)
        }
      }
    }
    if (touchingOwners.size !== 1) continue
    const owner = [...touchingOwners][0]
    if (owner === null) continue
    for (const id of component) result.set(id, owner)
  }
  return result
}

/** Only move established connections. Nearby graphics and crossings stay independent. */
export const followConnectedConductors = (
  before: readonly Shape[], after: readonly Shape[], movedIds: ReadonlySet<string>
): Shape[] => {
  const oldById = new Map(before.map((shape) => [shape.id, shape]))
  after = after.map((shape) => {
    const old = oldById.get(shape.id)
    if (!movedIds.has(shape.id) || shape.kind !== 'line' || old?.kind !== 'line' ||
      !old.connection?.via || !shape.connection?.via ||
      old.connection.via.length !== shape.connection.via.length ||
      !old.connection.via.every((point, index) => same(point, shape.connection!.via![index]))) return shape
    const ox = old.end.x - old.start.x, oy = old.end.y - old.start.y
    const nx = shape.end.x - shape.start.x, ny = shape.end.y - shape.start.y
    const squared = ox * ox + oy * oy
    const a = squared ? (ox * nx + oy * ny) / squared : 1
    const b = squared ? (ox * ny - oy * nx) / squared : 0
    const via = old.connection.via.map((point) => {
      if (Boolean(old.flipX) !== Boolean(shape.flipX)) return { x: old.start.x + shape.start.x - point.x, y: point.y + shape.start.y - old.start.y }
      if (Boolean(old.flipY) !== Boolean(shape.flipY)) return { x: point.x + shape.start.x - old.start.x, y: old.start.y + shape.start.y - point.y }
      return { x: shape.start.x + a * (point.x - old.start.x) - b * (point.y - old.start.y),
        y: shape.start.y + b * (point.x - old.start.x) + a * (point.y - old.start.y) }
    })
    return { ...shape, connection: { ...shape.connection, via } }
  })
  const nextById = new Map(after.map((shape) => [shape.id, shape]))
  const anchors = new Map<string, Point>()
  const anchorInputs: Point[] = []
  const movedLines: Array<{ before: LineShape; after: LineShape }> = []
  for (const shape of before) {
    if (!movedIds.has(shape.id) || shape.hidden) continue
    const next = nextById.get(shape.id)
    if (shape.kind === 'symbol' && next?.kind === 'symbol' &&
      (oneWireSymbolNodeInfo(shape.path, shape.scale) || oneWireSymbolTerminalInfo(shape.path, shape.scale))) {
      const oldPorts = oneWireSymbolConnectionAnchors(shape), newPorts = oneWireSymbolConnectionAnchors(next)
      // Anchor order follows the source ports, including rotations and mirrors.
      oldPorts.forEach((port, index) => { if (newPorts[index]) {
        anchors.set(key(port.point), newPorts[index].point); anchorInputs.push(port.point)
      } })
    } else if (shape.kind === 'line' && next?.kind === 'line') {
      movedLines.push({ before: shape, after: next })
      anchors.set(key(shape.start), next.start)
      anchors.set(key(shape.end), next.end)
      anchorInputs.push(shape.start, shape.end)
    }
  }
  const movePoint = (point: Point): Point | null => {
    const target = anchors.get(key(point))
    if (target) return target
    for (const line of movedLines) {
      const oldSegments = connectionSegments(line.before), nextSegments = connectionSegments(line.after)
      for (let i = 0; i < oldSegments.length; i++) {
        const t = fraction(point, oldSegments[i].start, oldSegments[i].end), segment = nextSegments[i]
        if (t !== null && segment) return { x: segment.start.x + t * (segment.end.x - segment.start.x),
          y: segment.start.y + t * (segment.end.y - segment.start.y) }
      }
    }
    return null
  }
  const fixedPorts = before.flatMap((shape) => {
    if (movedIds.has(shape.id) || shape.hidden) return []
    if (shape.kind === 'line') return [shape.start, shape.end].map((point) => ({ id: shape.id, point }))
    return shape.kind === 'symbol' && (oneWireSymbolNodeInfo(shape.path, shape.scale) || oneWireSymbolTerminalInfo(shape.path, shape.scale))
      ? oneWireSymbolConnectionAnchors(shape).map(({ point }) => ({ id: shape.id, point })) : []
  })
  const railAttachments = new Map<string, LineShape | null>()
  for (const rail of before) {
    if (rail.kind !== 'line' || !isOneWireRailShape(rail) || movedIds.has(rail.id) || rail.locked) continue
    for (const point of anchorInputs) {
      if (!connectionSegments(rail).some((segment) => fraction(point, segment.start, segment.end) !== null)) continue
      const next = movePoint(point)
      const id = `${rail.id}-attachment-${key(point)}`
      const owner = before.find((shape) => movedIds.has(shape.id) && shape.kind === 'symbol' &&
        oneWireSymbolConnectionAnchors(shape).some((anchor) => same(anchor.point, point)))
      const staysOnRail = next && connectionSegments(rail).some((segment) =>
        fraction(next, segment.start, segment.end) !== null)
      railAttachments.set(id, next && !same(point, next) && !staysOnRail ? {
        id, kind: 'line', start: { ...point }, end: { ...next }, stroke: rail.stroke ?? '#000000', strokeWidth: 2,
        ...(owner?.bindingId ? { bindingId: owner.bindingId } : {}),
        ...(owner?.sourceLink?.kind === 'board' ? { sourceLink: { ...owner.sourceLink, role: 'rail-attachment' } } : {}),
        oneWireRailId: rail.id, connection: { kind: 'wire', routing: 'orthogonal', showLabel: false }
      } : null)
    }
  }
  const connected = after.filter((shape) => !railAttachments.has(shape.id)).map((shape) => {
    if (shape.kind !== 'line' || shape.hidden || shape.locked || movedIds.has(shape.id)) return shape
    // A busbar is rigid. Moving a device off it adds a feeder instead of bending the bar.
    if (isOneWireRailShape(shape)) return shape
    const old = oldById.get(shape.id)
    if (old?.kind !== 'line') return shape
    const segments = connectionSegments(old)
    const location = (point: Point): number | null => {
      if (same(point, old.start) || same(point, old.end)) return null
      let length = 0
      for (const segment of segments) {
        const t = fraction(point, segment.start, segment.end)
        const size = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y)
        if (t !== null) return length + t * size
        length += size
      }
      return null
    }
    const middleAnchors = anchorInputs.filter((point) => location(point) !== null)
    const mappedStart = movePoint(old.start), mappedEnd = movePoint(old.end)
    if (!mappedStart && !mappedEnd && !middleAnchors.length) return shape
    const start = mappedStart ?? shape.start, end = mappedEnd ?? shape.end
    if (same(start, shape.start) && same(end, shape.end) && !middleAnchors.length) return shape
    const connection = { ...(shape.connection ?? { kind: 'wire' as const, showLabel: false }) }
    const original = same(start, old.start) && same(end, old.end) && middleAnchors.every((point) => same(movePoint(point) ?? point, point))
    if (original) {
      if (old.connection?.routing) connection.routing = old.connection.routing
      else delete connection.routing
      if (old.connection?.via) connection.via = old.connection.via.map((point) => ({ ...point }))
      else delete connection.via
    } else {
      connection.routing = 'orthogonal'
      const junctions = [...fixedPorts.filter((port) => port.id !== old.id).map(({ point }) => point),
        ...middleAnchors, ...(old.connection?.via ?? [])]
        .flatMap((point) => { const t = location(point); return t === null ? [] : [{ point: movePoint(point) ?? point, t }] })
        .sort((a, b) => a.t - b.t)
      const via = junctions.map(({ point }) => point).filter((point, index, points) =>
        !same(point, start) && !same(point, end) && points.findIndex((candidate) => same(point, candidate)) === index)
      if (via.length) connection.via = via.map((point) => ({ ...point }))
      else delete connection.via
    }
    return { ...shape, start: { ...start }, end: { ...end }, connection }
  })
  return removeRedundantRailAttachments([
    ...connected, ...[...railAttachments.values()].filter((shape): shape is LineShape => shape !== null)
  ])
}
