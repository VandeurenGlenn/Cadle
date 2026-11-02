import type { LineShape, Point, Shape } from '../model/types.js'
import { connectionSegments } from '../model/electrical-connection.js'
import { oneWireSymbolConnectionAnchors } from './onewire-connections.js'
import { oneWireSymbolNodeInfo, oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { isOneWireRailShape } from './onewire-regeneration.js'

export type ConnectionIssue = { shapeId: string; endpoint: 'start' | 'end'; point: Point; nearby?: Point }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const closest = (point: Point, start: Point, end: Point): Point => {
  const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared)) : 0
  return { x: start.x + t * dx, y: start.y + t * dy }
}

/** Editor guidance for actual endpoints; crossings and deliberate sheet exits stay distinct. */
export const findConnectionIssues = (shapes: readonly Shape[]): ConnectionIssue[] => {
  const lines = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && !shape.hidden)
  const segments = lines.flatMap((line) => connectionSegments(line).map((segment) => ({ ...segment, id: line.id })))
  const ports = shapes.flatMap((shape) => shape.kind === 'symbol' && !shape.hidden &&
    (oneWireSymbolNodeInfo(shape.path, shape.scale) || oneWireSymbolTerminalInfo(shape.path, shape.scale))
    ? oneWireSymbolConnectionAnchors(shape).map(({ point }) => point) : [])
  const result: ConnectionIssue[] = []
  for (const line of lines) {
    if ((!line.connection && !line.bindingId && !line.sourceLink) || isOneWireRailShape(line) || (line.strokeWidth ?? 2) >= 4) continue
    const role = line.sourceLink?.role ?? ''
    for (const endpoint of ['start', 'end'] as const) {
      if (endpoint === 'end' && (role === 'grid-incoming' || role.endsWith('-outgoing') || role === 'residual-outgoing')) continue
      const point = line[endpoint]
      const candidates = [...ports, ...segments.filter((segment) => segment.id !== line.id)
        .map((segment) => closest(point, segment.start, segment.end))]
      if (candidates.some((target) => distance(point, target) < 0.01)) continue
      const nearby = candidates.reduce<Point | undefined>((best, target) => distance(point, target) <= 16 &&
        (!best || distance(point, target) < distance(point, best)) ? target : best, undefined)
      result.push({ shapeId: line.id, endpoint, point: { ...point }, ...(nearby ? { nearby } : {}) })
    }
  }
  return result
}
