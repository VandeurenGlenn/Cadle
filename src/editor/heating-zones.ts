import type { Shape } from './model/types.js'
import { heatingRouteCorridor, routeHeating, type HeatingGrid, type HeatingRoom } from './heating-routing.js'
import { isHeatingDoorSymbol, heatingDoorSymbolThreshold } from './heating-openings.js'
import { heatingRoomKey, heatingWallDistances } from './heating-coverage.js'

/** Only small rooms choose a neighbouring zone. A small hall between two large
 * rooms does not implicitly merge those large rooms into one control zone. */
export const shareSmallHeatingRooms = (grid: HeatingGrid, shapes: readonly Shape[], scale: number, diameterMm: number, checkpoint: () => void = () => {}): HeatingGrid => {
  const eligible = new Map(grid.rooms.map((room) => [room.id, room])), distance = heatingWallDistances(grid)
  const area = new Map(grid.rooms.map((room) => [room.id, room.cells.filter((c) => !grid.obstacle[c] && distance[c] * grid.step * scale / 8000 >= .1).length * (grid.step * scale / 8000) ** 2]))
  const parent = new Map(grid.rooms.map((room) => [room.id, room.id]))
  const root = (id: number): number => { let p = id; while (parent.get(p) !== p) p = parent.get(p)!; return p }
  const doors: { a: number; b: number; start: { x: number; y: number }; end: { x: number; y: number } }[] = []
  for (const shape of shapes) {
    if (shape.hidden || (shape.kind !== 'door' && shape.kind !== 'gate' && !isHeatingDoorSymbol(shape))) continue
    const opening = isHeatingDoorSymbol(shape) ? heatingDoorSymbolThreshold(shape) : 'start' in shape ? shape : null
    if (!opening) continue
    const { start, end } = opening, dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const x = (start.x + end.x) / 2, y = (start.y + end.y) / 2, reach = Math.max(grid.step * 4, 1200 / scale)
    const a = grid.room[grid.index({ x: x - dy / length * reach, y: y + dx / length * reach })], b = grid.room[grid.index({ x: x + dy / length * reach, y: y - dx / length * reach })]
    if (a !== b && eligible.has(a) && eligible.has(b)) doors.push({ a, b, start, end })
  }
  for (const room of [...grid.rooms].sort((a, b) => (area.get(a.id) ?? 0) - (area.get(b.id) ?? 0))) {
    checkpoint()
    if ((area.get(room.id) ?? 0) > 12) continue
    const neighbour = doors.flatMap((door) => door.a === room.id ? [door.b] : door.b === room.id ? [door.a] : [])
      .sort((a, b) => (area.get(b) ?? 0) - (area.get(a) ?? 0))[0]
    if (neighbour !== undefined) parent.set(root(room.id), root(neighbour))
  }
  if (![...parent.keys()].some((id) => root(id) !== id)) return grid
  const wall = grid.wall.slice(), roomMap = grid.room.slice(), byZone = new Map<number, HeatingRoom[]>()
  for (const room of grid.rooms) {
    const id = root(room.id), members = byZone.get(id) ?? []
    members.push(room); byZone.set(id, members)
    for (const cell of room.cells) roomMap[cell] = id
  }
  const openings = new Map<number, number[]>()
  for (const door of doors) {
    if (root(door.a) !== root(door.b)) continue
    const dx = door.end.x - door.start.x, dy = door.end.y - door.start.y, length = Math.hypot(dx, dy), trim = diameterMm * 4 / scale + grid.step
    const radius = Math.max(grid.step * 2, 4)
    for (let y = Math.max(0, Math.floor((Math.min(door.start.y, door.end.y) - radius - grid.origin.y) / grid.step)); y <= Math.min(grid.height - 1, Math.ceil((Math.max(door.start.y, door.end.y) + radius - grid.origin.y) / grid.step)); y++) {
      for (let x = Math.max(0, Math.floor((Math.min(door.start.x, door.end.x) - radius - grid.origin.x) / grid.step)); x <= Math.min(grid.width - 1, Math.ceil((Math.max(door.start.x, door.end.x) + radius - grid.origin.x) / grid.step)); x++) {
        const cell = y * grid.width + x, p = grid.point(cell), along = ((p.x - door.start.x) * dx + (p.y - door.start.y) * dy) / length
        const across = Math.abs((p.x - door.start.x) * dy - (p.y - door.start.y) * dx) / length
        if (along <= trim || along >= length - trim || across > radius || grid.obstacle[cell]) continue
        const id = root(door.a)
        if (wall[cell]) { const list = openings.get(id) ?? []; list.push(cell); openings.set(id, list) }
        wall[cell] = 0; roomMap[cell] = id
      }
    }
  }
  const rooms = [...byZone.entries()].map(([id, members]): HeatingRoom => {
    const cells = [...new Set([...members.flatMap((member) => member.cells), ...openings.get(id) ?? []])]
    const primary = members.find((member) => member.id === id)!
    return { ...primary, cells, members: members.map((member) => ({ key: heatingRoomKey(member), name: member.name })),
      name: members.map((member) => member.name).join(' / '), minX: Math.min(...members.map((r) => r.minX)), maxX: Math.max(...members.map((r) => r.maxX)),
      minY: Math.min(...members.map((r) => r.minY)), maxY: Math.max(...members.map((r) => r.maxY)) }
  })
  return { ...grid, wall, room: roomMap, rooms }
}

/** Reserve the common feed network before filling a shared zone with coils.
 * These strips remain open for joins and manifold leads, rather than receiving
 * an extra coil underneath the bundle that already heats the same floor. */
export const reserveHeatingAccess = (grid: HeatingGrid, routingObstacle: Uint8Array, shapes: readonly Shape[], position: { x: number; y: number }, scale: number,
  diameterMm: number, capacity: number, radiusMm: number, checkpoint: () => void): HeatingGrid => {
  const sourceId = grid.room[grid.index(position)], zone = grid.rooms.find((room) => room.id === sourceId)
  if (!zone?.members || zone.members.length < 2) return grid
  const routingGrid = { ...grid, obstacle: routingObstacle }, loopObstacle = grid.loopObstacle.slice()
  const source = zone.cells.filter((cell) => !routingObstacle[cell]).sort((a, b) => {
    const distance = (cell: number) => { const p = grid.point(cell); return Math.abs(p.x - position.x) + Math.abs(p.y - position.y - 2800 / scale) }
    return distance(a) - distance(b)
  })[0]
  if (source === undefined) return grid
  const reach = Math.ceil((radiusMm + capacity * diameterMm) * 8 / scale / grid.step)
  const goals = new Set<number>()
  for (const shape of shapes) {
    if (shape.hidden || (shape.kind !== 'door' && shape.kind !== 'gate' && !isHeatingDoorSymbol(shape))) continue
    const opening = isHeatingDoorSymbol(shape) ? heatingDoorSymbolThreshold(shape) : 'start' in shape ? shape : null
    if (!opening) continue
    const dx = opening.end.x - opening.start.x, dy = opening.end.y - opening.start.y, length = Math.hypot(dx, dy)
    if (!length) continue
    for (const side of [-1, 0, 1]) {
      const cell = grid.index({ x: (opening.start.x + opening.end.x) / 2 - dy / length * side * 1600 / scale, y: (opening.start.y + opening.end.y) / 2 + dx / length * side * 1600 / scale })
      if (cell >= 0 && grid.room[cell] === sourceId && !routingObstacle[cell]) goals.add(cell)
    }
  }
  for (const goal of goals) {
    checkpoint()
    const path = routeHeating(routingGrid, source, goal, { roomId: sourceId, radiusCells: Math.ceil(radiusMm * 16 / scale / grid.step), checkpoint })
    if (!path) continue
    for (const cell of heatingRouteCorridor(grid, path, reach)) if (grid.room[cell] === sourceId) loopObstacle[cell] = 1
  }
  return { ...grid, loopObstacle }
}
