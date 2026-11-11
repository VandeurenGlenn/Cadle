import type { Point, Shape } from './model/types.js'
import { heatingSourceRoom, routeHeating, type HeatingGrid, type HeatingRoom } from './heating-routing.js'
import { isHeatingDoorSymbol, heatingDoorSymbolThreshold } from './heating-openings.js'
import { heatingRoomKey, heatingWallDistances } from './heating-coverage.js'
import { routeHeatingBundle } from './heating-bundle.js'
import { heatingAccessDistances } from './heating-access-distances.js'

export class HeatingFeedReservationFailure extends Error {
  constructor(readonly point: Point) {
    super('Geen volledige aanvoer- en retourbundel naar alle ruimtes gevonden. Er zijn nog geen kringen gelegd.')
  }
}

/** Reserve a disjoint pair for every allocated group before creating leg fields.
 * Only the room approaches are retained; the room interiors remain free to pack. */
export const reserveHeatingFeedPairs = (grid: HeatingGrid, original: HeatingGrid, sources: readonly number[][],
  interior: readonly number[], targets: ReadonlyMap<string, number>, omitted: ReadonlySet<number>,
  scale: number, diameterMm: number, radiusMm: number, spacingMm: number, permittedWallCells: ReadonlySet<number>,
  checkpoint: () => void, onProgress?: (done: number, total: number) => void): HeatingGrid => {
  const distances = heatingWallDistances(original), radius = Math.ceil(radiusMm * 8 / scale / grid.step)
  const goals: number[] = [], nativeIds: number[] = []
  for (const room of grid.rooms) {
    const count = targets.get(heatingRoomKey(room)) ?? 0
    const members = original.rooms.flatMap((member) => {
      const cells = member.cells.filter((cell) => grid.room[cell] === room.id && !grid.obstacle[cell] && !omitted.has(cell) && distances[cell] > radius)
      return cells.length ? [{ id: member.id, cells, count: 0 }] : []
    })
    for (let i = 0; i < count; i++) {
      checkpoint()
      members.sort((a, b) => b.cells.length / (b.count + 1) - a.cells.length / (a.count + 1))
      if (!members.length) throw new Error(`${room.name}: geen vrije ruimte voor aanvoer en retour.`)
      members[0].count++
    }
    for (const member of members) {
      if (!member.count) continue
      const centre = member.cells.reduce((p, cell) => { const q = grid.point(cell); p.x += q.x / member.cells.length; p.y += q.y / member.cells.length; return p }, { x: 0, y: 0 })
      const sorted = [...member.cells].sort((a, b) => {
        const p = grid.point(a), q = grid.point(b)
        return Math.abs(p.x - centre.x) + Math.abs(p.y - centre.y) - Math.abs(q.x - centre.x) - Math.abs(q.y - centre.y)
      })
      const separation = Math.max(1, Math.ceil(diameterMm * 1.2 * 8 / scale / grid.step))
      let selected: number[] = []
      for (const vertical of [false, true]) {
        selected = []
        const anchor = sorted[0]
        for (const cell of sorted) {
          if (vertical ? cell % grid.width !== anchor % grid.width : Math.floor(cell / grid.width) !== Math.floor(anchor / grid.width)) continue
          if (selected.some((other) => Math.abs(other - cell) < separation * (vertical ? grid.width : 1))) continue
          selected.push(cell)
          if (selected.length === member.count * 2) break
        }
        if (selected.length === member.count * 2) break
      }
      if (selected.length < member.count * 2) throw new Error(`${room.name}: onvoldoende plaats voor de aanvoer en retour van elke kring.`)
      goals.push(...selected); nativeIds.push(...selected.map(() => member.id))
    }
  }
  if (!goals.length) return grid
  const blocked = grid.obstacle.slice()
  for (const cell of interior) blocked[cell] = 1
  const stubs = sources.filter((stub) => stub.length > 0 && stub.every((cell) => cell >= 0 && cell < grid.wall.length && !grid.obstacle[cell]))
  for (const stub of stubs) for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  const cellPenalty = grid.feedReservation ? Float32Array.from(grid.feedReservation, (value, cell) => !value && grid.room[cell] > 0 ? 10 : 0) : undefined
  onProgress?.(0, goals.length)
  let blockedGoal = 0
  const paths = routeHeatingBundle(grid, stubs.map((stub) => stub.at(-1)!), goals, blocked,
    { allowWalls: true, permittedWallCells, checkpoint, cellPenalty, onBlocked: (indices) => { blockedGoal = indices[0] ?? 0 } },
    (done) => onProgress?.(done, goals.length))
  if (!paths) throw new HeatingFeedReservationFailure(grid.point(goals[blockedGoal]))
  const loopObstacle = grid.loopObstacle.slice(), feedReservation = grid.feedReservation?.slice() ?? new Uint8Array(grid.wall.length)
  const feedCorridor = grid.feedCorridor?.slice() ?? new Uint8Array(grid.wall.length)
  const pitch = Math.max(1, Math.round(spacingMm * 8 / scale / grid.step))
  const reach = radius + Math.ceil(Math.max(diameterMm, spacingMm / 2) * 8 / scale / grid.step), blocks = new Set<number>()
  const feedPaths = paths.map((route, index) => {
    const path = [...stubs[route.source].slice(0, -1), ...route.cells]
    const first = path.findIndex((cell) => original.room[cell] === nativeIds[index])
    return first > 0 ? path.slice(0, first + 1) : path
  })
  const leadDistances = heatingAccessDistances(original, stubs.map((stub) => stub.at(-1)!), permittedWallCells,
    original.room[stubs[0].at(-1)!] > 0, checkpoint)
  const feedDistances = leadDistances.slice(), assigned = new Set(nativeIds)
  for (const room of original.rooms) if (assigned.has(room.id)) for (const cell of room.cells) feedDistances[cell] = -1
  const queue = new Int32Array(grid.wall.length), steps = new Int32Array(grid.wall.length), visited = new Uint8Array(grid.wall.length)
  for (const [index, path] of feedPaths.entries()) {
    const root = path.at(-1)!, room = nativeIds[index], stamp = index + 1
    let read = 0, write = 1
    queue[0] = root; steps[root] = path.length - stubs[paths[index].source].length; visited[root] = stamp
    while (read < write) {
      if (read % 4096 === 0) checkpoint()
      const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
      if (feedDistances[cell] < 0 || steps[cell] < feedDistances[cell]) feedDistances[cell] = steps[cell]
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next < 0 || visited[next] === stamp || original.room[next] !== room || grid.obstacle[next]) continue
        visited[next] = stamp; steps[next] = steps[cell] + 1; queue[write++] = next
      }
    }
  }
  for (const path of feedPaths) for (const cell of path) {
    checkpoint()
    const x = cell % grid.width, y = Math.floor(cell / grid.width)
    feedCorridor[cell] = 1
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || yy < 0 || xx >= grid.width || yy >= grid.height || dx * dx + dy * dy > reach * reach) continue
      blocks.add(Math.floor(yy / pitch) * pitch * grid.width + Math.floor(xx / pitch) * pitch)
    }
  }
  for (const cell of blocks) {
    const x = cell % grid.width, y = Math.floor(cell / grid.width)
    for (let dy = 0; dy < pitch && y + dy < grid.height; dy++) for (let dx = 0; dx < pitch && x + dx < grid.width; dx++) {
      const next = (y + dy) * grid.width + x + dx
      if (grid.room[next] > 0) { loopObstacle[next] = 1; feedReservation[next] = 1 }
    }
  }
  return { ...grid, loopObstacle, feedReservation, feedCorridor, feedPaths, feedDistances }
}

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
  const sourceId = heatingSourceRoom(grid, position)?.id ?? grid.room[grid.index(position)], zone = grid.rooms.find((room) => room.id === sourceId)
  if (!zone?.members || zone.members.length < 2) return grid
  const original = options.original ?? grid, originalSource = heatingSourceRoom(original, position)?.id ?? original.room[original.index(position)]
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
  const feedCorridor = grid.feedCorridor?.slice() ?? new Uint8Array(grid.wall.length)
  const feedReservation = grid.feedReservation?.slice() ?? new Uint8Array(grid.wall.length)
  const reserveRoute = (goal: number, tubes: number, roomId?: number) => {
    const path = routeHeating(routingGrid, source, goal, { roomId, radiusCells: Math.ceil(radiusMm * 16 / scale / grid.step), checkpoint })
    if (path) for (const cell of path) traffic[cell] = Math.min(capacity * 2, traffic[cell] + tubes)
  }
  for (const door of doors) {
    checkpoint()
    if (door.a === originalSource || door.b === originalSource) continue
    const forward = (levels.get(door.a) ?? Infinity) < (levels.get(door.b) ?? Infinity), far = forward ? door.b : door.a, side = forward ? 1 : -1
    const goal = grid.index({ x: door.centre.x + door.normal.x * side * 1600 / scale, y: door.centre.y + door.normal.y * side * 1600 / scale })
    if (goal < 0 || grid.room[goal] !== sourceId || centred[goal]) continue
    reserveRoute(goal, Math.min(capacity * 2, load(far) * 2), sourceId)
  }
  // The source opening must pass the complete bundle. A route to a farther
  // doorway can miss this short throat, leaving only one pipe-width between a
  // coil and its jamb. Keep the whole physical approach clear before packing.
  for (const door of doors) {
    if (door.a !== originalSource && door.b !== originalSource) continue
    const half = (radiusMm * 2 + capacity * Math.max(laneMm, diameterMm * 1.2)) * 8 / scale
    const across = (radiusMm + capacity * Math.max(laneMm, diameterMm * 1.2)) * 8 / scale
    const tangent = { x: -door.normal.y, y: door.normal.x }
    for (const cell of zone.cells) {
      const p = grid.point(cell), dx = p.x - door.centre.x, dy = p.y - door.centre.y
      if (Math.abs(dx * door.normal.x + dy * door.normal.y) <= half && Math.abs(dx * tangent.x + dy * tangent.y) <= across) { loopObstacle[cell] = 1; feedCorridor[cell] = 1; feedReservation[cell] = 1 }
    }
  }
  // Size each shared strip by the number of tubes that actually traverse it.
  // A bathroom approach no longer reserves the full twelve-circuit bundle.
  const bands = new Map<number, number[]>()
  for (let cell = 0; cell < traffic.length; cell++) if (traffic[cell]) { const cells = bands.get(traffic[cell]) ?? []; cells.push(cell); bands.set(traffic[cell], cells) }
  for (const [tubes, cells] of bands) {
    // Cells need their own local disks; unrelated routes must not be connected
    // by the bounding box of the whole list.
    for (const cell of cells) {
      checkpoint()
      const reach = Math.ceil((radiusMm + tubes * Math.max(laneMm, diameterMm * 1.2) / 2) / laneMm)
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        if (dx * dx + dy * dy > reach * reach) continue
        const xx = x + dx, yy = y + dy, next = yy * grid.width + xx
        if (xx >= 0 && yy >= 0 && xx < grid.width && yy < grid.height && grid.room[next] > 0) loopObstacle[next] = 1
      }
    }
  }
  // Keep the laying boundary orthogonal at the selected pitch. A 25 mm raster
  // of round/tapered approaches left dozens of tiny triangular remainder fields.
  const pitch = Math.max(1, Math.round((options.spacingMm ?? 100) / laneMm)), blocks = new Set<number>()
  for (let cell = 0; cell < loopObstacle.length; cell++) if (loopObstacle[cell] && !grid.loopObstacle[cell]) {
    const x = Math.floor(cell % grid.width / pitch) * pitch, y = Math.floor(Math.floor(cell / grid.width) / pitch) * pitch
    blocks.add(y * grid.width + x)
  }
  for (const cell of blocks) {
    checkpoint()
    const x = cell % grid.width, y = Math.floor(cell / grid.width)
    for (let dy = 0; dy < pitch && y + dy < grid.height; dy++) for (let dx = 0; dx < pitch && x + dx < grid.width; dx++) {
      const next = (y + dy) * grid.width + x + dx
      if (grid.room[next] > 0) { loopObstacle[next] = 1; feedReservation[next] = 1 }
    }
  }
  return { ...grid, loopObstacle, feedCorridor, feedReservation }
}
