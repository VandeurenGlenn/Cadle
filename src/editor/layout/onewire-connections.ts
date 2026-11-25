import type { Point, Shape, SymbolShape } from '../model/types.js'
import { shapeBounds } from '../model/model.js'
import { symbolContentBounds } from './symbol-layout.js'
import {
  oneWireSymbolBounds,
  oneWireSymbolNodeInfo,
  oneWireSymbolPortInfo,
  oneWireSymbolTerminalInfo,
  oneWireSymbolUsesExplicitPorts
} from './onewire-symbol-nodes.js'
import { paperTextBounds } from './paper-text-layout.js'
import { protectionAnnotationBounds } from './protection-label-layout.js'
import { connectionSegments } from '../model/electrical-connection.js'

export type ConnectionSide = 'top' | 'bottom' | 'left' | 'right'
export type SymbolConnectionAnchor = { side: ConnectionSide; point: Point }

const directions: Record<ConnectionSide, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
}

export const oneWireLayoutBounds = (shape: Shape) => {
  if (shape.kind === 'symbol') {
    const body = oneWireSymbolBounds(shape) ?? symbolContentBounds(shape)
    const text = protectionAnnotationBounds(shape)
    if (!text) return body
    const x = Math.min(body.x, text.x), y = Math.min(body.y, text.y)
    return { x, y, width: Math.max(body.x + body.width, text.x + text.width) - x,
      height: Math.max(body.y + body.height, text.y + text.height) - y }
  }
  if (shape.kind !== 'text') return shapeBounds(shape)
  return paperTextBounds(shape)
}

export const oneWireSymbolConnectionAnchors = (shape: SymbolShape): SymbolConnectionAnchor[] => {
  const terminals = oneWireSymbolTerminalInfo(shape.path, shape.scale)
  const node = oneWireSymbolNodeInfo(shape.path, shape.scale)
  if (!terminals && !node) {
    const bounds = symbolContentBounds(shape)
    return [
      { side: 'top', point: { x: bounds.x + bounds.width / 2, y: bounds.y } },
      { side: 'bottom', point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height } },
      { side: 'left', point: { x: bounds.x, y: bounds.y + bounds.height / 2 } },
      { side: 'right', point: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 } }
    ]
  }
  const radians = (shape.rotation ?? 0) * Math.PI / 180
  const transform = (point: Point): Point => {
    const x = point.x * (shape.flipX ? -1 : 1)
    const y = point.y * (shape.flipY ? -1 : 1)
    return { x: x * Math.cos(radians) - y * Math.sin(radians), y: x * Math.sin(radians) + y * Math.cos(radians) }
  }
  const transformedSide = (direction: Point): ConnectionSide => {
    const facing = transform(direction)
    return Math.abs(facing.x) > Math.abs(facing.y)
      ? facing.x < 0 ? 'left' : 'right'
      : facing.y < 0 ? 'top' : 'bottom'
  }
  if (terminals) {
    return (Object.entries(terminals) as Array<['top' | 'bottom', Point]>).map(([side, offset]) => ({
      side: transformedSide(directions[side]),
      point: {
        x: shape.position.x + transform(offset).x,
        y: shape.position.y + transform(offset).y
      }
    }))
  }
  const ports = oneWireSymbolPortInfo(shape.path, shape.scale, shape.oneWireConnectionAxis)
  if (oneWireSymbolUsesExplicitPorts(shape.path) && ports) {
    return (Object.entries(ports) as Array<[ConnectionSide, Point]>).map(([side, offset]) => {
      const transformed = transform(offset)
      return {
        side: transformedSide(directions[side]),
        point: { x: shape.position.x + transformed.x, y: shape.position.y + transformed.y }
      }
    })
  }
  return (Object.entries(directions) as Array<[ConnectionSide, Point]>).map(([side, direction]) => {
    // Circle-based symbols connect at the node edge; passthroughs at the node.
    const offset = ports?.[side] ?? {
      x: node!.offset.x + direction.x * (node!.cutHalfWidth ?? 0),
      y: node!.offset.y + direction.y * (node!.cutHalfWidth ?? 0)
    }
    const transformed = transform(offset)
    return { side: transformedSide(direction), point: { x: shape.position.x + transformed.x, y: shape.position.y + transformed.y } }
  })
}

export const oppositeConnectionSide = (side: ConnectionSide): ConnectionSide =>
  ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })[side] as ConnectionSide

/** Repair only known generated legacy contacts; never snap nearby manual wires or move devices. */
export const repairGeneratedOneWireContacts = (shapes: readonly Shape[]): Shape[] => {
  const symbols = shapes.filter((shape): shape is SymbolShape =>
    shape.kind === 'symbol' && !shape.hidden && Boolean(shape.generationKey))
  const family = (shape: Shape) => (shape.bindingId ?? shape.sourceLink?.id ?? '').replace(/\d+$/, '').toUpperCase()
  return shapes.map((shape) => {
    if (shape.kind !== 'line' || shape.hidden || shape.locked || !shape.generationKey ||
      !/^(?:row-wire|trunk(?:-\d+)?)$/.test(shape.sourceLink?.role ?? '')) return shape
    let next = shape
    for (const endpoint of ['start', 'end'] as const) {
      const point = shape[endpoint]
      const candidates = symbols.filter((symbol) => family(symbol) === family(shape) &&
        (!shape.oneWireRailId || !symbol.oneWireRailId || shape.oneWireRailId === symbol.oneWireRailId))
      if (candidates.some((symbol) => oneWireSymbolConnectionAnchors(symbol).some(({ point: port }) =>
        Math.hypot(port.x - point.x, port.y - point.y) < 0.01))) continue
      const segments = connectionSegments(shape)
      const other = endpoint === 'start' ? segments[0].end : segments.at(-1)!.start
      const side: ConnectionSide = Math.abs(other.x - point.x) > Math.abs(other.y - point.y)
        ? other.x < point.x ? 'left' : 'right' : other.y < point.y ? 'top' : 'bottom'
      const matches = candidates.flatMap((symbol) => {
        const bounds = oneWireSymbolBounds(symbol) ?? symbolContentBounds(symbol)
        const node = oneWireSymbolNodeInfo(symbol.path, symbol.scale, symbol.rotation, symbol.flipX, symbol.flipY)
        const legacy = [symbol.position,
          ...(node ? [
            { x: symbol.position.x + node.offset.x, y: symbol.position.y + node.offset.y },
            { x: bounds.x, y: symbol.position.y + node.offset.y },
            { x: bounds.x + bounds.width, y: symbol.position.y + node.offset.y },
            ...Object.values(directions).map((direction) => ({
              x: symbol.position.x + node.offset.x + direction.x * (node.cutHalfWidth ?? 0),
              y: symbol.position.y + node.offset.y + direction.y * (node.cutHalfWidth ?? 0)
            }))
          ] : []),
          { x: bounds.x, y: bounds.y + bounds.height / 2 },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
          { x: bounds.x + bounds.width / 2, y: bounds.y },
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }]
        if (!legacy.some((old) => Math.hypot(old.x - point.x, old.y - point.y) < 0.01)) return []
        const port = oneWireSymbolConnectionAnchors(symbol).find((anchor) => anchor.side === side)
        return port ? [port.point] : []
      })
      if (matches.length === 1) {
        next = { ...next, [endpoint]: matches[0] }
        if (Math.abs(next.start.x - next.end.x) > 0.01 && Math.abs(next.start.y - next.end.y) > 0.01)
          next = { ...next, connection: { ...(next.connection ?? { kind: 'wire' }), routing: 'orthogonal' } }
      }
    }
    return next
  })
}

export const positionOneWireSymbolForConnection = (
  target: SymbolShape,
  from: Point,
  side: ConnectionSide,
  host?: SymbolShape,
  minimumGap = 24
): { symbol: SymbolShape; connection: Point } => {
  let symbol = { ...target, position: { x: 0, y: 0 } }
  const incomingSide = oppositeConnectionSide(side)
  let anchors = oneWireSymbolConnectionAnchors(symbol)
  let incoming = anchors.find((anchor) => anchor.side === incomingSide)
  if (!incoming) {
    // Rotate a terminal-based device so its conductor faces the incoming wire.
    const anchor = anchors.find((candidate) => candidate.side === 'bottom') ?? anchors[0]
    const angle: Record<ConnectionSide, number> = { right: 0, bottom: 90, left: 180, top: 270 }
    symbol.rotation = (symbol.rotation ?? 0) + angle[incomingSide] - angle[anchor.side]
    anchors = oneWireSymbolConnectionAnchors(symbol)
    incoming = anchors.find((candidate) => candidate.side === incomingSide)!
  }
  const extent = (shape: SymbolShape, point: Point, facing: ConnectionSide) => {
    const bounds = oneWireSymbolBounds(shape) ?? symbolContentBounds(shape)
    return Math.max(0, facing === 'top' ? point.y - bounds.y
      : facing === 'bottom' ? bounds.y + bounds.height - point.y
      : facing === 'left' ? point.x - bounds.x : bounds.x + bounds.width - point.x)
  }
  const gap = host
    ? Math.max(minimumGap, extent(host, from, side) + extent(symbol, incoming.point, incomingSide) + 8)
    : minimumGap
  const direction = directions[side]
  const connection = { x: from.x + direction.x * gap, y: from.y + direction.y * gap }
  symbol.position = { x: connection.x - incoming.point.x, y: connection.y - incoming.point.y }
  return { symbol, connection }
}
