import type { Point, Shape, SymbolShape } from '../model/types.js'
import { shapeBounds } from '../model/model.js'
import { symbolContentBounds } from './symbol-layout.js'
import { oneWireSymbolBounds, oneWireSymbolNodeInfo, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'

export type ConnectionSide = 'top' | 'bottom' | 'left' | 'right'
export type SymbolConnectionAnchor = { side: ConnectionSide; point: Point }

const directions: Record<ConnectionSide, Point> = {
  top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
}

export const oneWireLayoutBounds = (shape: Shape) => {
  if (shape.kind === 'symbol') return oneWireSymbolBounds(shape) ?? symbolContentBounds(shape)
  if (shape.kind !== 'text') return shapeBounds(shape)
  const size = 18 * (shape.scale ?? 1)
  const width = shape.text.length * size * 0.68
  const x = shape.textAnchor === 'middle' ? -width / 2 : shape.textAnchor === 'end' ? -width : 0
  const radians = (shape.rotation ?? 0) * Math.PI / 180
  const corners = [{ x, y: -size }, { x: x + width, y: -size }, { x, y: size * 0.2 }, { x: x + width, y: size * 0.2 }]
    .map((point) => ({
      x: shape.position.x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
      y: shape.position.y + point.x * Math.sin(radians) + point.y * Math.cos(radians)
    }))
  const xs = corners.map(({ x }) => x)
  const ys = corners.map(({ y }) => y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
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
  return (Object.entries(directions) as Array<[ConnectionSide, Point]>).map(([, direction]) => {
    // Circle-based symbols connect at the node edge; passthroughs at the node.
    const offset = {
      x: node!.offset.x + direction.x * (node!.cutHalfWidth ?? 0),
      y: node!.offset.y + direction.y * (node!.cutHalfWidth ?? 0)
    }
    const transformed = transform(offset)
    return { side: transformedSide(direction), point: { x: shape.position.x + transformed.x, y: shape.position.y + transformed.y } }
  })
}

export const oppositeConnectionSide = (side: ConnectionSide): ConnectionSide =>
  ({ top: 'bottom', bottom: 'top', left: 'right', right: 'left' })[side] as ConnectionSide

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
