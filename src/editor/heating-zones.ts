import type { Point, Shape } from './model/types.js'
import { routeHeating, type HeatingGrid, type HeatingRoom } from './heating-routing.js'
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
export const reserveHeatingAccess = (grid: HeatingGrid, routingObstacle: Uint8Array, shapes: readonly Shape[], position: Point, scale: number,
  diameterMm: number, capacity: number, radiusMm: number, checkpoint: () => void,
  options: { accessTargets?: readonly Point[]; original?: HeatingGrid; targets?: ReadonlyMap<string, number>; origin?: Point; spacingMm?: number } = {}): HeatingGrid => {
  const sourceId = grid.room[grid.index(position)], zone = grid.rooms.find((room) => room.id === sourceId)
  if (!zone?.members || zone.members.length < 2) return grid
  const original = options.original ?? grid, originalSource = original.room[original.index(position)]
  const doors: { a: number; b: number; centre: Point; normal: Point }[] = []
  for (const shape of shapes) {
    if (shape.hidden || (shape.kind !== 'door' && shape.kind !== 'gate' && !isHeatingDoorSymbol(shape))) continue
    const opening = isHeatingDoorSymbol(shape) ? heatingDoorSymbolThreshold(shape) : 'start' in shape ? shape : null
    if (!opening) continue
    const dx = opening.end.x - opening.start.x, dy = opening.end.y - opening.start.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const centre = { x: (opening.start.x + opening.end.x) / 2, y: (opening.start.y + opening.end.y) / 2 }, normal = { x: -dy / length, y: dx / length }
    const probe = 1600 / scale
    const a = original.room[original.index({ x: centre.x + normal.x * probe, y: centre.y + normal.y * probe })], b = original.room[original.index({ x: centre.x - normal.x * probe, y: centre.y - normal.y * probe })]
    if (a > 0 && b > 0 && a !== b) doors.push({ a, b, centre, normal })
  }
  const levels = new Map([[originalSource, 0]]), queue = [originalSource]
  for (let read = 0; read < queue.length; read++) for (const door of doors) {
    const next = door.a === queue[read] ? door.b : door.b === queue[read] ? door.a : -1
    if (next > 0 && !levels.has(next)) { levels.set(next, levels.get(queue[read])! + 1); queue.push(next) }
  }
  const distances = heatingWallDistances(original), areas = new Map(original.rooms.map((room) => [room.id, room.cells.filter((c) => !original.obstacle[c] && distances[c] * grid.step * scale / 8 >= 100).length * (grid.step * scale / 8000) ** 2]))
  const load = (id: number) => {
    const originalRoom = original.rooms.find((r) => r.id === id)
    if (!originalRoom) return 1
    const parent = grid.rooms.find((r) => r.id === grid.room[originalRoom.cells[0]])
    const groupArea = original.rooms.filter((r) => grid.room[r.cells[0]] === parent?.id).reduce((sum, r) => sum + (areas.get(r.id) ?? 0), 0)
    const groups = parent ? options.targets?.get(heatingRoomKey(parent)) ?? Math.ceil(groupArea / Math.max(1, (options.spacingMm ?? 100) / 1000 * 90)) : 1
    return Math.max(1, Math.round(groups * (areas.get(id) ?? 0) / Math.max(.1, groupArea)))
  }
  const hard = new Uint8Array(grid.wall.length)
  for (let cell = 0; cell < hard.length; cell++) hard[cell] = routingObstacle[cell] || grid.wall[cell] && !grid.door[cell] ? 1 : 0
  const clear = heatingWallDistances({ ...grid, wall: hard })
  const laneMm = grid.step * scale / 8, bundleClearance = Math.ceil((radiusMm + capacity * laneMm) / laneMm)
  const centred = routingObstacle.slice()
  for (let cell = 0; cell < centred.length; cell++) if (clear[cell] < bundleClearance) centred[cell] = 1
  const routingGrid = { ...grid, obstacle: centred }, loopObstacle = grid.loopObstacle.slice(), origin = options.origin ?? position
  const sourceCells = zone.cells.filter((cell) => !centred[cell])
  if (!sourceCells.length) return grid
  const source = sourceCells.reduce((best, cell) => {
    const p = grid.point(cell), q = grid.point(best)
    return Math.abs(p.x - origin.x) + Math.abs(p.y - origin.y) < Math.abs(q.x - origin.x) + Math.abs(q.y - origin.y) ? cell : best
  }, sourceCells[0])
  const traffic = new Uint16Array(grid.wall.length)
  const reserveRoute = (goal: number, tubes: number, roomId?: number) => {
    const path = routeHeating(routingGrid, source, goal, { roomId, radiusCells: Math.ceil(radiusMm * 16 / scale / grid.step), checkpoint })
    if (path) for (const cell of path) traffic[cell] = Math.min(capacity * 2, traffic[cell] + tubes)
  }
  if (options.accessTargets?.length) {
    // The first coil proposal exposes the actual remote entries. Reserve their
    // approaches as well as the shared hall, including paths around long shafts.
    // Door-only reservation left distant fields hidden behind other spirals.
    for (const target of options.accessTargets) {
      checkpoint()
      const room = grid.rooms.find((room) => room.id === grid.room[grid.index(target)])
      const available = room?.cells.filter((cell) => !centred[cell]) ?? []
      if (!available.length) continue
      const goal = available.reduce((best, cell) => {
        const p = grid.point(cell), q = grid.point(best)
        return Math.abs(p.x - target.x) + Math.abs(p.y - target.y) < Math.abs(q.x - target.x) + Math.abs(q.y - target.y) ? cell : best
      }, available[0])
      reserveRoute(goal, 2)
    }
  } else for (const door of doors) {
    checkpoint()
    if (door.a === originalSource || door.b === originalSource) continue
    const forward = (levels.get(door.a) ?? Infinity) < (levels.get(door.b) ?? Infinity), far = forward ? door.b : door.a, side = forward ? 1 : -1
    const goal = grid.index({ x: door.centre.x + door.normal.x * side * 1600 / scale, y: door.centre.y + door.normal.y * side * 1600 / scale })
    if (goal < 0 || grid.room[goal] !== sourceId || centred[goal]) continue
    reserveRoute(goal, Math.min(capacity * 2, load(far) * 2), sourceId)
  }
  // Size each shared strip by the number of tubes that actually traverse it.
  // A bathroom approach no longer reserves the full twelve-circuit bundle.
  const bands = new Map<number, number[]>()
  for (let cell = 0; cell < traffic.length; cell++) if (traffic[cell]) { const cells = bands.get(traffic[cell]) ?? []; cells.push(cell); bands.set(traffic[cell], cells) }
  for (const [tubes, cells] of bands) {
    const reach = Math.ceil((radiusMm + tubes * Math.max(laneMm, diameterMm * 1.2) / 2) * 8 / scale / grid.step)
    // Cells need their own local disks; unrelated routes must not be connected
    // by the bounding box of the whole list.
    for (const cell of cells) {
      checkpoint()
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > reach * reach) continue
        const xx = x + dx, yy = y + dy, next = yy * grid.width + xx
        if (xx >= 0 && yy >= 0 && xx < grid.width && yy < grid.height && grid.room[next] > 0) loopObstacle[next] = 1
      }
    }
  }
  return { ...grid, loopObstacle }
}
