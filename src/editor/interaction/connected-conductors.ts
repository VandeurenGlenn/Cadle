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
      railAttachments.set(id, next && !same(point, next) ? {
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
  return [...connected, ...[...railAttachments.values()].filter((shape): shape is LineShape => shape !== null)]
}
