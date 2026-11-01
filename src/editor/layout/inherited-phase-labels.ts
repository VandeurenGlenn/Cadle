import type { Project } from '../../types.js'
import type { LineShape, Point, Shape, SymbolShape } from '../model/types.js'
import { oneWireSymbolConnectionAnchors } from './onewire-connections.js'
import { oneWireSymbolTerminalInfo } from './onewire-symbol-nodes.js'
import { isOneWireRailShape } from './onewire-regeneration.js'
import { connectionSegments } from '../model/electrical-connection.js'

type Edge = { to: number; device?: SymbolShape }
type Node = { point: Point; edges: Edge[] }

const poles = (shape: SymbolShape) => shape.electrical?.poles ??
  Number(/^(\d+)P$/i.exec(shape.symbolTextOverrides?.poles ?? shape.symbolTextOverrides?.['desc:nP'] ?? '')?.[1])

const railHasTwoPoleSupply = (rail: LineShape, project?: Project | null): boolean => {
  const profile = project?.electricalProfile
  if (project?.oneWireTopology && (profile?.defaultPoles ?? 2) === 2) return true
  const boardId = rail.sourceLink?.id ?? 'main'
  const railId = /^rail:/.test(rail.sourceLink?.role ?? '') ? rail.sourceLink!.role.split(':').at(-1) : undefined
  const seen = new Set<string>()
  let board = profile?.boards?.find((item) => item.id === boardId)
  while (board && !seen.has(board.id)) {
    seen.add(board.id)
    if (board.mainDifferential?.poles === 2) return true
    if (board.id === boardId && board.additionalDifferentials?.some((item) => item.railId === railId && item.poles === 2)) return true
    board = profile?.boards?.find((item) => item.id === board!.parentBoardId)
  }
  return false
}

/** Derive visibility from connected conductors; leave stored phase settings intact. */
export const presentInheritedPhaseLabels = (shapes: readonly Shape[], project?: Project | null): Shape[] => {
  const wires = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && !shape.hidden)
    .flatMap((shape) => connectionSegments(shape).map((segment) => ({ ...shape, ...segment })))
  const nodes: Node[] = []
  const indexes = new Map<string, number>()
  const nodeAt = (point: Point) => {
    const key = `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`
    let index = indexes.get(key)
    if (index === undefined) {
      index = nodes.length
      indexes.set(key, index)
      nodes.push({ point, edges: [] })
    }
    return index
  }
  const connect = (a: number, b: number, device?: SymbolShape) => {
    if (a === b) return
    nodes[a].edges.push({ to: b, device })
    nodes[b].edges.push({ to: a, device })
  }
  for (const wire of wires) { nodeAt(wire.start); nodeAt(wire.end) }
  const devices: Array<{ shape: SymbolShape; ports: number[] }> = []
  const inlineDevices = new Map<string, SymbolShape>()
  const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`
  const explicitRoots = new Set<number>()
  for (const shape of shapes) {
    if (shape.kind !== 'symbol' || shape.hidden || !oneWireSymbolTerminalInfo(shape.path, shape.scale)) continue
    const ports = oneWireSymbolConnectionAnchors(shape).map(({ point }) => nodeAt(point))
    if (ports.length === 2) {
      connect(ports[0], ports[1], shape)
      inlineDevices.set(pairKey(ports[0], ports[1]), shape)
      devices.push({ shape, ports })
    } else if (shape.sourceLink?.role === 'solar-panels') {
      for (const port of ports) explicitRoots.add(port)
    }
  }
  // Split conductors at endpoints, terminals and T junctions. A crossing with
  // no endpoint/junction does not silently become an electrical connection.
  for (const wire of wires) {
    const dx = wire.end.x - wire.start.x
    const dy = wire.end.y - wire.start.y
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) continue
    const minX = Math.min(wire.start.x, wire.end.x) - 0.01
    const maxX = Math.max(wire.start.x, wire.end.x) + 0.01
    const minY = Math.min(wire.start.y, wire.end.y) - 0.01
    const maxY = Math.max(wire.start.y, wire.end.y) + 0.01
    const attached: Array<{ index: number; t: number }> = []
    for (let index = 0; index < nodes.length; index++) {
      const { point } = nodes[index]
      if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) continue
      const t = ((point.x - wire.start.x) * dx + (point.y - wire.start.y) * dy) / lengthSquared
      if (t < -1e-8 || t > 1 + 1e-8) continue
      if (Math.hypot(point.x - wire.start.x - t * dx, point.y - wire.start.y - t * dy) < 0.01) attached.push({ index, t })
    }
    attached.sort((a, b) => a.t - b.t)
    for (let i = 1; i < attached.length; i++) {
      const a = attached[i - 1].index
      const b = attached[i].index
      connect(a, b, inlineDevices.get(pairKey(a, b)))
    }
    if (wire.sourceLink?.role === 'grid-incoming') explicitRoots.add(nodeAt(wire.end))
  }
  const visited = new Set<number>()
  const roots = new Map<number, boolean>()
  for (let start = 0; start < nodes.length; start++) {
    if (visited.has(start)) continue
    const component = [start]
    visited.add(start)
    for (let i = 0; i < component.length; i++) {
      for (const edge of nodes[component[i]].edges) {
        if (visited.has(edge.to)) continue
        visited.add(edge.to)
        component.push(edge.to)
      }
    }
    const sources = component.filter((index) => explicitRoots.has(index))
    if (sources.length) { for (const source of sources) roots.set(source, false); continue }
    const members = new Set(component)
    const rail = wires.filter((wire) => isOneWireRailShape(wire) && members.has(nodeAt(wire.start)))
      .sort((a, b) => b.start.y - a.start.y)[0]
    if (rail) roots.set(nodeAt(rail.start), railHasTwoPoleSupply(rail, project))
  }
  const distance = new Map<number, number>()
  const order = [...roots.keys()]
  for (const root of order) distance.set(root, 0)
  for (let i = 0; i < order.length; i++) {
    for (const edge of nodes[order[i]].edges) {
      if (distance.has(edge.to)) continue
      distance.set(edge.to, distance.get(order[i])! + 1)
      order.push(edge.to)
    }
  }
  const inherited = new Map(roots)
  for (const node of order) {
    if (roots.has(node)) continue
    const incoming = nodes[node].edges.filter((edge) => distance.get(edge.to) === distance.get(node)! - 1)
    // With multiple supplies, hide only when all upstream routes establish 2P.
    inherited.set(node, incoming.length > 0 && incoming.every((edge) => inherited.get(edge.to) || (edge.device && poles(edge.device) === 2)))
  }
  const hidden = new Set<string>()
  for (const { shape, ports } of devices) {
    // The incoming main breaker has no upstream device. Its own 2P marking
    // already identifies this supply, so it needs no repeated phase caption.
    if (shape.sourceLink?.kind === 'board' && shape.sourceLink.role === 'main-switch' && poles(shape) === 2) {
      hidden.add(shape.id)
    }
    const [a, b] = ports
    if (!distance.has(a) || !distance.has(b) || distance.get(a) === distance.get(b)) continue
    const upstream = distance.get(a)! < distance.get(b)! ? a : b
    if (inherited.get(upstream) && (shape.electrical?.role === 'protection' || /protection devices\//i.test(shape.path))) hidden.add(shape.id)
  }
  return shapes.map((shape) => {
    if (shape.kind === 'symbol' && hidden.has(shape.id)) {
      return { ...shape, symbolTextOverrides: { ...shape.symbolTextOverrides, phase: '' } }
    }
    if (shape.kind === 'text' && shape.sourceLink?.role === 'breaker-phase') {
      const owners = devices.filter(({ shape: device }) => device.sourceLink?.role === 'breaker' &&
        device.sourceLink.id === shape.sourceLink!.id && device.oneWireRailId === shape.oneWireRailId)
      if (owners.length && owners.every(({ shape: device }) => hidden.has(device.id))) return { ...shape, hidden: true }
    }
    return shape
  })
}
