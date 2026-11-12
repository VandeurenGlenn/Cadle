import { segmentDistance } from './heating-distance.js'
import type { Point, Shape, SymbolShape } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { shapeBounds } from './model/model.js'
import { namedRoomRegions } from './room-regions.js'
import { heatingDoorSymbolThreshold, isHeatingDoorSymbol, isHeatingStairSymbol, heatingObstacleBounds } from './heating-openings.js'
import { isRoomLabel, roomLabelName } from './room-labels.js'

export type HeatingRoom = { id: number; name: string; roomKey?: string; members?: { key: string; name: string }[]; cells: number[]; minX: number; maxX: number; minY: number; maxY: number }
export type HeatingGrid = {
  drawingScale?: number
  feedCorridor?: Uint8Array
  feedReservation?: Uint8Array
  feedPaths?: number[][]
  feedDistances?: Int32Array
  origin: Point; step: number; width: number; height: number
  wall: Uint8Array; door: Uint8Array; obstacle: Uint8Array; loopObstacle: Uint8Array; room: Int32Array; rooms: HeatingRoom[]
  point: (index: number) => Point
  index: (point: Point) => number
}

export { segmentDistance } from './heating-distance.js'

/** Closed wall/door boundaries identify rooms; device footprints are always hard obstacles. */
export const buildHeatingGrid = (shapes: readonly Shape[], scale: number, spacingMm: number, manifold: Point,
  pipe?: { pipeDiameterMm: number; minBendRadiusMm: number }, options: { includeClosedRooms?: boolean } = {}): HeatingGrid => {
  const walls = shapes.filter((s) => s.kind === 'wall' && !s.hidden)
  if (!walls.length) throw new Error('Geen muren gevonden. Teken eerst de gesloten ruimtes op het grondplan.')
  const points = walls.flatMap((s) => 'start' in s ? [s.start, s.end] : [])
  // An integer number of cells per laying interval preserves the entered spacing exactly.
  let divisions = Math.max(2, Math.ceil(spacingMm / 25))
  // Preserve the selected pitch and, when tube clearance permits, the real
  // bend radius too. A 25 mm raster silently turned R80 approaches into R100.
  // At 16/100, five 20 mm cells represent both dimensions without oversampling.
  if (pipe?.minBendRadiusMm) for (let n = divisions; n <= Math.min(12, Math.floor(spacingMm / (pipe.pipeDiameterMm * 1.1))); n++) {
    const bendCells = pipe.minBendRadiusMm * n / spacingMm
    if (Math.abs(bendCells - Math.round(bendCells)) < 1e-7) { divisions = n; break }
  }
  const step = drawingUnitsForMetres(spacingMm / 1000, scale) / divisions
  const pad = Math.max(4 * step, drawingUnitsForMetres(1.2, scale))
  const origin = { x: Math.min(manifold.x, ...points.map((p) => p.x)) - pad,
    y: Math.min(manifold.y, ...points.map((p) => p.y)) - pad }
  const width = Math.ceil((Math.max(manifold.x + drawingUnitsForMetres(2.5, scale), ...points.map((p) => p.x)) - origin.x + pad) / step) + 1
  const height = Math.ceil((Math.max(manifold.y + 80, ...points.map((p) => p.y)) - origin.y + pad) / step) + 1
  const size = width * height
  if (size > 900_000) throw new Error('Dit grondplan is te groot voor deze legafstand. Verdeel het over meerdere legplannen.')
  const point = (i: number): Point => ({ x: origin.x + i % width * step, y: origin.y + Math.floor(i / width) * step })
  const index = (p: Point) => {
    const x = Math.round((p.x - origin.x) / step), y = Math.round((p.y - origin.y) / step)
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x
  }
  const wall = new Uint8Array(size), door = new Uint8Array(size), obstacle = new Uint8Array(size), loopObstacle = new Uint8Array(size), room = new Int32Array(size)
  const raster = (a: Point, b: Point, radius: number, target: Uint8Array) => {
    const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - origin.x) / step))
    const maxX = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + radius - origin.x) / step))
    const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - origin.y) / step))
    const maxY = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + radius - origin.y) / step))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = y * width + x
      if (segmentDistance(point(i), a, b) <= radius) target[i] = 1
    }
  }
  const rasterDoor = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (!length) return
    const depth = Math.max(drawingUnitsForMetres(.2, scale), step * 2)
    const trim = drawingUnitsForMetres((pipe?.pipeDiameterMm ?? 16) / 2000, scale) + step / 2
    const left = Math.max(0, Math.floor((Math.min(a.x, b.x) - depth - origin.x) / step)), right = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + depth - origin.x) / step))
    const top = Math.max(0, Math.floor((Math.min(a.y, b.y) - depth - origin.y) / step)), bottom = Math.min(height - 1, Math.ceil((Math.max(a.y, b.y) + depth - origin.y) / step))
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const cell = y * width + x, p = point(cell), along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length
      const across = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / length
      if (along >= trim && along <= length - trim && across <= depth) door[cell] = 1
    }
  }
  for (const shape of shapes) {
    if (!shape.hidden && isHeatingDoorSymbol(shape)) {
      const { start, end } = heatingDoorSymbolThreshold(shape)
      // Close the room boundary for flood filling, while marking this exact
      // threshold as a preferred passage for supply and return pipes.
      raster(start, end, step * .8, wall)
      rasterDoor(start, end)
    }
    if (shape.hidden || !('start' in shape)) continue
    if (shape.kind === 'wall') raster(shape.start, shape.end, Math.max(step * .75, (shape.strokeWidth ?? 6) / 2) +
      drawingUnitsForMetres((pipe?.pipeDiameterMm ?? 16) / 2000, scale) + step / 2, wall)
    if (shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate') {
      raster(shape.start, shape.end, step * .8, wall)
      if (shape.kind !== 'window') rasterDoor(shape.start, shape.end)
    }
  }
  for (const b of heatingObstacleBounds(shapes, shapeBounds)) {
    // These are centre-line nodes, not solid raster squares. Adding half a
    // cell here blocked physically clear R80 approaches near fixtures; the
    // final rounded-curve audit checks the actual tube envelope as well.
    for (const [target, clearance] of [[obstacle, drawingUnitsForMetres((pipe?.pipeDiameterMm ?? 16) / 2000, scale)],
      [loopObstacle, drawingUnitsForMetres(Math.max(.05, (pipe?.minBendRadiusMm ?? 80) * .002 + (pipe?.pipeDiameterMm ?? 16) / 2000), scale) + step]] as const) {
      const minX = Math.max(0, Math.ceil((b.x - clearance - origin.x) / step))
      const maxX = Math.min(width - 1, Math.floor((b.x + b.width + clearance - origin.x) / step))
      const minY = Math.max(0, Math.ceil((b.y - clearance - origin.y) / step))
      const maxY = Math.min(height - 1, Math.floor((b.y + b.height + clearance - origin.y) / step))
      for (let y = minY; y <= maxY; y++) target.fill(1, y * width + minX, y * width + maxX + 1)
    }
  }
  const queue = new Int32Array(size), candidates: { room: HeatingRoom; hasDoor: boolean }[] = [], namedRegions = namedRoomRegions(shapes)
  let id = 0
  for (let root = 0; root < size; root++) {
    if (wall[root] || room[root]) continue
    id++
    let read = 0, write = 1, outside = false
    queue[0] = root; room[root] = id
    const cells: number[] = []
    let minX = width, minY = height, maxX = 0, maxY = 0
    while (read < write) {
      const i = queue[read++], x = i % width, y = Math.floor(i / width)
      cells.push(i); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      if (!x || !y || x === width - 1 || y === height - 1) outside = true
      for (const n of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
        if (n >= 0 && !wall[n] && !room[n]) { room[n] = id; queue[write++] = n }
      }
    }
    if (outside) { for (const i of cells) room[i] = -1; continue }
    const area = cells.length * (step * scale / 8000) ** 2
    if (area < .4) continue
    const hasDoor = cells.some((cell) => {
      const x = cell % width, y = Math.floor(cell / width)
      return Boolean(door[cell] || (x && door[cell - 1]) || (x + 1 < width && door[cell + 1]) ||
        (y && door[cell - width]) || (y + 1 < height && door[cell + width]))
    })
    const centre = point(cells[Math.floor(cells.length / 2)])
    const named = namedRegions.filter((region) => centre.x > region.x && centre.x < region.x + region.width &&
      centre.y > region.y && centre.y < region.y + region.height).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const label = shapes.filter(isRoomLabel).find((shape) => !shape.hidden && room[index(shape.position)] === id)
    candidates.push({ hasDoor, room: { id, name: label ? roomLabelName(label.roomLabel) : named?.name ?? `Ruimte ${candidates.length + 1}`,
      ...(label ? { roomKey: label.id } : {}), cells, minX, maxX, minY, maxY } })
  }
  const stairs = new Set(shapes.filter((shape): shape is SymbolShape => !shape.hidden && isHeatingStairSymbol(shape))
    .map((shape) => room[index(shape.position)]).filter((roomId) => roomId > 0))
  const rooms = candidates.filter(({ hasDoor, room }) => options.includeClosedRooms || hasDoor || stairs.has(room.id)).map(({ room }) => room)
  if (!rooms.length && candidates.length) throw new Error('Geen gesloten ruimtes met een deur of trap gevonden. Teken een deur of voeg een trap toe aan de ruimtes die je wilt gebruiken.')
  if (!rooms.length) throw new Error('Geen gesloten ruimtes herkend. Sluit de muren van het grondplan voordat je een legplan maakt.')
  return { drawingScale: scale, origin, step, width, height, wall, door, obstacle, loopObstacle, room, rooms, point, index }
}

/** A wall-mounted source still belongs to the nearby room with the closest
 * usable door. Do not start half of its tails in the room across that wall. */
export const heatingSourceRoom = (grid: HeatingGrid, position: Point): HeatingRoom | undefined => {
  const cell = grid.index(position), direct = grid.rooms.find((room) => room.id === grid.room[cell])
  if (direct) return direct
  const reach = Math.ceil(drawingUnitsForMetres(.2, grid.drawingScale ?? 100) / grid.step), candidates = new Map<number, number>()
  const cx = cell % grid.width, cy = Math.floor(cell / grid.width)
  if (cell < 0) return undefined
  for (let y = Math.max(0, cy - reach); y <= Math.min(grid.height - 1, cy + reach); y++) for (let x = Math.max(0, cx - reach); x <= Math.min(grid.width - 1, cx + reach); x++) {
    const next = y * grid.width + x, distance = Math.hypot(x - cx, y - cy)
    if (distance <= reach && !grid.wall[next] && !grid.obstacle[next]) candidates.set(grid.room[next], Math.min(candidates.get(grid.room[next]) ?? Infinity, distance))
  }
  const doorDistance = (room: HeatingRoom) => room.cells.reduce((best, cell) => { if (!grid.door[cell]) return best; const p = grid.point(cell); return Math.min(best, Math.hypot(p.x - position.x, p.y - position.y)) }, Infinity)
  return grid.rooms.filter((room) => candidates.has(room.id)).sort((a, b) => {
    const difference = candidates.get(a.id)! - candidates.get(b.id)!
    return Math.abs(difference) > 1 ? difference : doorDistance(a) - doorDistance(b)
  })[0]
}

class MinHeap {
  values: { id: number; score: number }[] = []
  push(id: number, score: number) {
    const item = { id, score }, values = this.values
    let i = values.length; values.push(item)
    while (i) { const p = (i - 1) >> 1; if (values[p].score <= score) break; values[i] = values[p]; i = p }
    values[i] = item
  }
  pop() {
    const values = this.values, first = values[0], last = values.pop()!
    if (values.length) {
      let i = 0
      while (true) {
        let child = i * 2 + 1
        if (child >= values.length) break
        if (child + 1 < values.length && values[child + 1].score < values[child].score) child++
        if (last.score <= values[child].score) break
        values[i] = values[child]; i = child
      }
      values[i] = last
    }
    return first.id
  }
}

export type HeatingRoutingOptions = {
  /** Checked inside the search, so a single difficult route cannot exhaust a room's budget. */
  checkpoint?: () => void
  roomId?: number
  occupied?: ReadonlySet<number>
  allowWalls?: boolean
  permittedWallCells?: ReadonlySet<number>
  congestion?: ReadonlyMap<number, number>
  startDirection?: number
  endDirection?: number
  radiusCells?: number
  preferArcs?: boolean
  /** Exact clearance at fractional arc samples; static grid constraints still apply. */
  pointFree?: (point: Point) => boolean
  wallEntryPenalty?: number
  manifoldAccess?: { point: Point; radius: number; entryPenalty: number }
  preferredCorridor?: ReadonlySet<number>
  requiredCorridor?: ReadonlySet<number>
  preferredDoors?: ReadonlySet<number>
  obstacleHeuristic?: boolean
  lanePitchCells?: number
  lanePenalty?: Float32Array
  cellPenalty?: Float32Array
}

const doorComponents = new WeakMap<Uint8Array, { components: Int32Array; members: Map<number, number[]> }>()
export const heatingSharedDoors = (grid: HeatingGrid, path: readonly number[]) => {
  const cached = doorComponents.get(grid.door)
  let components = cached?.components, members = cached?.members
  if (!components) {
    components = new Int32Array(grid.door.length)
    members = new Map()
    let id = 0
    for (let root = 0; root < components.length; root++) if (grid.door[root] && !components[root]) {
      const queue = [root]; components[root] = ++id
      for (let read = 0; read < queue.length; read++) {
        const cell = queue[read], x = cell % grid.width, y = Math.floor(cell / grid.width)
        for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
          if (next >= 0 && grid.door[next] && !components[next]) { components[next] = id; queue.push(next) }
        }
      }
      members.set(id, queue)
    }
    doorComponents.set(grid.door, { components, members })
  }
  const selected = new Set(path.map((cell) => components![cell]).filter(Boolean)), result = new Set<number>()
  if (!selected.size) return result
  for (const id of selected) for (const cell of members!.get(id) ?? []) result.add(cell)
  return result
}

export const heatingRouteCorridor = (grid: HeatingGrid, path: readonly number[], radiusCells: number) => {
  const corridor = new Set<number>()
  const corners = path.filter((_, i) => !i || i === path.length - 1 || path[i] - path[i - 1] !== path[i + 1] - path[i])
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[Math.max(0, i - 1)]
    const left = Math.max(0, Math.min(a % grid.width, b % grid.width) - radiusCells), right = Math.min(grid.width - 1, Math.max(a % grid.width, b % grid.width) + radiusCells)
    const top = Math.max(0, Math.min(Math.floor(a / grid.width), Math.floor(b / grid.width)) - radiusCells), bottom = Math.min(grid.height - 1, Math.max(Math.floor(a / grid.width), Math.floor(b / grid.width)) + radiusCells)
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) corridor.add(y * grid.width + x)
  }
  return corridor
}

/** The same permission is used by rays, square routes and the bundle solver. */
export const heatingWallAllowed = (grid: HeatingGrid, cell: number, options: HeatingRoutingOptions) =>
  !grid.wall[cell] || Boolean(grid.door[cell]) || Boolean(options.allowWalls && (!options.permittedWallCells || options.permittedWallCells.has(cell)))

/** Rounding a square route must not cut through a jamb or an unapproved wall. */
export const heatingCurveWallConflict = (grid: HeatingGrid, pieces: readonly { a: Point; b: Point }[], options: HeatingRoutingOptions): Point | undefined => {
  for (const piece of pieces) {
    options.checkpoint?.()
    const count = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (grid.step / 2)))
    for (let n = 0; n <= count; n++) {
      const p = { x: piece.a.x + (piece.b.x - piece.a.x) * n / count, y: piece.a.y + (piece.b.y - piece.a.y) * n / count }
      const cell = grid.index(p)
      if (cell < 0 || !heatingWallAllowed(grid, cell, options)) return p
    }
  }
}

// Charge every separate wall entry, not just the number of wall cells. Several
// thin-wall penetrations must not become cheaper than one slightly thicker wall.
// A short access through a wall next to the manifold is a preferred alternative
// to a long detour, but still costs more than an equally short open doorway.
export const wallStepCost = (grid: HeatingGrid, from: number, to: number, options: HeatingRoutingOptions): number => {
  const pitch = options.lanePitchCells ?? 1
  const axis = Math.abs(to - from) === 1 ? Math.floor(to / grid.width) : to % grid.width
  const extra = (options.cellPenalty?.[to] ?? 0) + (pitch > 1 && axis % pitch !== 0 ? options.lanePenalty?.[to] ?? 0 : 0)
  if (grid.door[to] && !grid.door[from] && options.preferredDoors?.size && !options.preferredDoors.has(to)) return extra + drawingUnitsForMetres(.5, grid.drawingScale ?? 100) / grid.step
  if (!grid.wall[to] || grid.door[to]) return extra
  if (grid.wall[from] && !grid.door[from]) return extra + 4
  const access = options.manifoldAccess
  const nearManifold = access && Math.hypot(grid.origin.x + to % grid.width * grid.step - access.point.x,
    grid.origin.y + Math.floor(to / grid.width) * grid.step - access.point.y) <= access.radius
  return extra + 4 + (nearManifold ? access.entryPenalty : options.wallEntryPenalty ?? 24)
}

/** Favor openings and fewer penetrations, allowing worthwhile short wall routes. */
export const routeHeating = (grid: HeatingGrid, start: number, end: number,
  options: HeatingRoutingOptions = {}): number[] | null => {
  options.checkpoint?.()
  if (options.radiusCells) return options.preferArcs
    ? routeWithArcs(grid, start, end, options) ?? routeWithBends(grid, start, end, options)
    : routeWithBends(grid, start, end, options) ?? routeWithArcs(grid, start, end, options)
  const { width, height } = grid
  if (start < 0 || end < 0 || grid.obstacle[start] || grid.obstacle[end]) return null
  const previous = new Int32Array(width * height).fill(-1), cost = new Float64Array(width * height).fill(Infinity)
  const closed = new Uint8Array(width * height), heap = new MinHeap()
  const heuristic = (i: number) => (Math.abs(i % width - end % width) + Math.abs(Math.floor(i / width) - Math.floor(end / width))) * (options.preferredCorridor ? .9 : 1)
  cost[start] = 0; heap.push(start, heuristic(start))
  let iterations = 0
  while (heap.values.length) {
    if (++iterations % 256 === 0) options.checkpoint?.()
    const i = heap.pop()
    if (closed[i]) continue
    if (i === end) {
      const path = [i]
      while (path.at(-1) !== start) path.push(previous[path.at(-1)!])
      return path.reverse()
    }
    closed[i] = 1
    const x = i % width, y = Math.floor(i / width)
    for (const n of [x ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (n < 0 || closed[n] || grid.obstacle[n] || (options.requiredCorridor && !options.requiredCorridor.has(n)) ||
        (i === start && options.startDirection !== undefined && n - i !== options.startDirection) ||
        (n === end && options.endDirection !== undefined && n - i !== options.endDirection) ||
        (options.roomId !== undefined && grid.room[n] !== options.roomId) ||
        !heatingWallAllowed(grid, n, options) || (n !== end && n !== start && options.occupied?.has(n))) continue
      const last = previous[i], turn = last >= 0 && n - i !== i - last ? .15 : 0
      const next = cost[i] + 1 + turn + wallStepCost(grid, i, n, options) + (options.congestion?.get(n) ?? 0) * 30 + (options.preferredCorridor?.has(n) ? -.1 : 0)
      if (next >= cost[n]) continue
      cost[n] = next; previous[n] = i; heap.push(n, next + heuristic(n))
    }
  }
  return null
}

export const simplifyHeatingPath = (points: Point[]): Point[] => points.filter((p, i) => {
  if (!i || i === points.length - 1) return true
  const a = points[i - 1], b = points[i + 1]
  return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-7
})

type RoutingWorkspace = { cost: Float64Array; previous: Int32Array; visited: Uint32Array; closed: Uint32Array; generation: number; lowerCost?: Float64Array; lowerClosed?: Uint8Array }
// A wall mask belongs to one immutable grid. Generation stamps avoid allocating and
// clearing millions of state slots on every route; a new grid gets a fresh workspace.
const routingWorkspaces = new WeakMap<Uint8Array, RoutingWorkspace>()

/** Direction-aware rays leave at least two bend radii between successive corners. */
const routeWithBends = (grid: HeatingGrid, start: number, end: number, options: HeatingRoutingOptions): number[] | null => {
  const { width, height } = grid, size = width * height, reach = Math.max(2, options.radiusCells ?? 2)
  const directions = [1, width, -1, -width]
  const validStep = (a: number, b: number) => b >= 0 && b < size && Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width)) === 1
  const free = (i: number) => i >= 0 && i < size && !grid.obstacle[i] && (!options.requiredCorridor || options.requiredCorridor.has(i)) && (options.roomId === undefined || grid.room[i] === options.roomId) && heatingWallAllowed(grid, i, options) && (i === start || i === end || !options.occupied?.has(i))
  if (!free(start) || !free(end)) return null
  const first: number[] = [start], last: number[] = [end]
  for (let n = 0; n < Math.ceil(reach / 2); n++) {
    if (options.startDirection !== undefined) {
      const a = first.at(-1)!, b = a + options.startDirection
      if (!validStep(a, b) || !free(b)) return null
      first.push(b)
    }
    if (options.endDirection !== undefined) {
      const a = last[0], b = a - options.endDirection
      if (!validStep(a, b) || !free(b)) return null
      last.unshift(b)
    }
  }
  const root = first.at(-1)!, target = last[0], blocked = new Set([...first.slice(0, -1), ...last.slice(1)])
  // Rays leave room for a fillet, but the square rays themselves do not cover
  // its inside arc. Check that envelope while searching, so a rejected rounded
  // corner leads to another route rather than rejecting the whole circuit.
  const cornerFree = (cell: number, incoming: number, outgoing: number) => {
    if (incoming === outgoing) return true
    const a = directions[incoming], b = directions[outgoing]
    const ux = Math.abs(a) === 1 ? a : 0, uy = Math.abs(a) === width ? a / width : 0
    const vx = Math.abs(b) === 1 ? b : 0, vy = Math.abs(b) === width ? b / width : 0
    const radius = reach / 2, x = cell % width - ux * radius + vx * radius, y = Math.floor(cell / width) - uy * radius + vy * radius
    const angle = Math.atan2(-vy, -vx), sign = ux * vy - uy * vx
    for (let n = 0; n <= 12; n++) {
      const theta = angle + sign * Math.PI / 2 * n / 12
      const xx = Math.round(x + radius * Math.cos(theta)), yy = Math.round(y + radius * Math.sin(theta))
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || !free(yy * width + xx)) return false
    }
    return true
  }

  let workspace = routingWorkspaces.get(grid.wall)
  if (!workspace) {
    workspace = { cost: new Float64Array(size * 4), previous: new Int32Array(size * 4), visited: new Uint32Array(size * 4), closed: new Uint32Array(size * 4), generation: 0 }
    routingWorkspaces.set(grid.wall, workspace)
  }
  if (workspace.generation >= 0xffffffff) { workspace.visited.fill(0); workspace.closed.fill(0); workspace.generation = 0 }
  const generation = ++workspace.generation, { cost, previous, visited, closed } = workspace, heap = new MinHeap()
  let heuristic = (i: number) => (Math.abs(i % width - target % width) + Math.abs(Math.floor(i / width) - Math.floor(target / width))) * (options.preferredCorridor ? .9 : 1)
  if (options.obstacleHeuristic) {
    const lower = workspace.lowerCost ??= new Float64Array(size), settled = workspace.lowerClosed ??= new Uint8Array(size), reverse = new MinHeap()
    lower.fill(Infinity); settled.fill(0); lower[target] = 0; reverse.push(target, 0)
    let steps = 0
    heuristic = (cell) => {
      while (!settled[cell] && reverse.values.length) {
        if (++steps % 4096 === 0) options.checkpoint?.()
        const from = reverse.pop()
        if (settled[from]) continue
        settled[from] = 1
        const x = from % width, y = Math.floor(from / width)
        for (const next of [x ? from - 1 : -1, x + 1 < width ? from + 1 : -1, y ? from - width : -1, y + 1 < height ? from + width : -1]) {
          if (next < 0 || settled[next] || !free(next) || blocked.has(next)) continue
          const candidate = lower[from] + 1 + wallStepCost(grid, next, from, options) + (options.congestion?.get(from) ?? 0) * 30 + (options.preferredCorridor?.has(from) ? -.1 : 0)
          if (candidate >= lower[next]) continue
          lower[next] = candidate; reverse.push(next, candidate)
        }
      }
      return lower[cell]
    }
    if (!Number.isFinite(heuristic(root))) return null
  }
  for (let d = 0; d < 4; d++) if (options.startDirection === undefined || directions[d] === options.startDirection) {
    const state = root * 4 + d; cost[state] = 0; previous[state] = -1; visited[state] = generation; heap.push(state, heuristic(root))
  }
  let explored = 0
  const cellMm = grid.step * (grid.drawingScale ?? 100) / 8
  const stateLimit = Math.min(size * 4, 400000, Math.ceil(80000 * (25 / cellMm) ** 2))
  let iterations = 0
  while (heap.values.length) {
    if (++iterations % 256 === 0) options.checkpoint?.()
    const state = heap.pop(), i = Math.floor(state / 4), heading = state % 4
    if (closed[state] === generation) continue
    if (i === target && (options.endDirection === undefined || directions[heading] !== -options.endDirection && cornerFree(i, heading, directions.indexOf(options.endDirection)))) {
      const nodes = [state]
      while (previous[nodes.at(-1)!] >= 0) {
        if (nodes.length % 256 === 0) options.checkpoint?.()
        if (nodes.length > size * 4) return null
        nodes.push(previous[nodes.at(-1)!])
      }
      nodes.reverse()
      const path = [root]
      for (let n = 1; n < nodes.length; n++) {
        const destination = Math.floor(nodes[n] / 4), direction = directions[nodes[n] % 4]
        const start = path.at(-1)!, count = (destination - start) / direction
        if (!Number.isInteger(count) || count < 0 || count > size || (Math.abs(direction) === 1 && Math.floor(start / width) !== Math.floor(destination / width))) return null
        for (let step = 1; step <= count; step++) {
          if (step % 256 === 0) options.checkpoint?.()
          path.push(start + step * direction)
        }
      }
      return [...first.slice(0, -1), ...path, ...last.slice(1)]
    }
    if (++explored > stateLimit) return options.obstacleHeuristic ? null : routeWithBends(grid, start, end, { ...options, obstacleHeuristic: true })
    closed[state] = generation
    for (const d of [heading, (heading + 1) % 4, (heading + 3) % 4]) {
      let n = i, added = d === heading ? 0 : reach * .3, valid = true
      for (let step = 0; step < (d === heading ? 1 : reach); step++) {
        const next = n + directions[d]
        if (!validStep(n, next) || !free(next) || blocked.has(next)) { valid = false; break }
        added += 1 + wallStepCost(grid, n, next, options) + (options.congestion?.get(next) ?? 0) * 30 + (options.preferredCorridor?.has(next) ? -.1 : 0)
        n = next
        if (n === target && (options.endDirection === undefined || directions[d] === options.endDirection || ((d === heading || step + 1 === reach) && directions[d] !== -options.endDirection))) break
      }
      if (!valid || !cornerFree(i, heading, d)) continue
      const nextState = n * 4 + d, nextCost = cost[state] + added
      if (closed[nextState] === generation || (visited[nextState] === generation && nextCost >= cost[nextState])) continue
      previous[nextState] = state; cost[nextState] = nextCost; visited[nextState] = generation; heap.push(nextState, nextCost + heuristic(n))
    }
  }
  return null
}


/** Search physical tangent points when square corner rays obstruct a valid
 * rounded route. A virtual fillet corner may lie on another tube even though
 * the actual quarter circle keeps the requested clearance. */
const routeWithArcs = (grid: HeatingGrid, start: number, end: number, options: HeatingRoutingOptions): number[] | null => {
  const { width, height } = grid, size = grid.wall.length, radius = Math.ceil((options.radiusCells ?? 2) / 2)
  const directions = [1, width, -1, -width], vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]]
  const staticFree = (cell: number) => cell >= 0 && cell < size && !grid.obstacle[cell] &&
    (options.roomId === undefined || grid.room[cell] === options.roomId) && heatingWallAllowed(grid, cell, options)
  const free = (cell: number) => staticFree(cell) && (!options.requiredCorridor || options.requiredCorridor.has(cell)) &&
    (cell === start || cell === end || !options.occupied?.has(cell) && (!options.pointFree || options.pointFree(grid.point(cell))))
  if (!free(start) || !free(end)) return null
  let workspace = routingWorkspaces.get(grid.wall)
  if (!workspace) {
    workspace = { cost: new Float64Array(size * 4), previous: new Int32Array(size * 4), visited: new Uint32Array(size * 4), closed: new Uint32Array(size * 4), generation: 0 }
    routingWorkspaces.set(grid.wall, workspace)
  }
  if (workspace.generation >= 0xffffffff) { workspace.visited.fill(0); workspace.closed.fill(0); workspace.generation = 0 }
  const generation = ++workspace.generation, { cost, previous, visited, closed } = workspace, heap = new MinHeap()
  const heuristic = (cell: number) => Math.hypot(cell % width - end % width, Math.floor(cell / width) - Math.floor(end / width))
  for (let heading = 0; heading < 4; heading++) if (options.startDirection === undefined || directions[heading] === options.startDirection) {
    const state = start * 4 + heading; cost[state] = 0; previous[state] = -1; visited[state] = generation; heap.push(state, heuristic(start))
  }
  const sampleCount = Math.max(8, Math.ceil(radius * Math.PI)), cellMm = grid.step * (grid.drawingScale ?? 100) / 8
  const limit = Math.min(size * 4, 400000, Math.ceil(80000 * (25 / cellMm) ** 2))
  let explored = 0
  while (heap.values.length) {
    if (++explored % 1024 === 0) options.checkpoint?.()
    if (explored > limit) return null
    const state = heap.pop(), cell = Math.floor(state / 4), heading = state % 4
    if (closed[state] === generation) continue
    if (cell === end && (options.endDirection === undefined || directions[heading] === options.endDirection)) {
      const nodes = [state]
      while (previous[nodes.at(-1)!] >= 0) { nodes.push(previous[nodes.at(-1)!]); if (nodes.length > size * 4) return null }
      nodes.reverse()
      const vertices = [start]
      for (let i = 1; i < nodes.length; i++) {
        const before = nodes[i - 1], after = nodes[i]
        if (before % 4 !== after % 4) vertices.push(Math.floor(before / 4) + directions[before % 4] * radius)
      }
      vertices.push(end)
      const path = [vertices[0]]
      for (const vertex of vertices.slice(1)) {
        const from = path.at(-1)!
        if (from === vertex) continue
        const stride = from % width === vertex % width ? Math.sign(vertex - from) * width : Math.sign(vertex - from)
        const count = (vertex - from) / stride
        if (!Number.isInteger(count) || count < 0 || count > size || Math.abs(stride) === 1 && Math.floor(from / width) !== Math.floor(vertex / width)) return null
        for (let n = 1; n <= count; n++) path.push(from + n * stride)
      }
      return path
    }
    closed[state] = generation
    const x = cell % width, y = Math.floor(cell / width), [ux, uy] = vectors[heading]
    for (const outgoing of [heading, (heading + 1) % 4, (heading + 3) % 4]) {
      const turn = outgoing !== heading, [vx, vy] = vectors[outgoing]
      const xx = x + (turn ? (ux + vx) * radius : ux), yy = y + (turn ? (uy + vy) * radius : uy)
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      const destination = yy * width + xx
      if (!free(destination)) continue
      let extra = turn ? radius * (Math.PI / 2 + .6) : 1, valid = true
      if (turn) {
        // Keep virtual control legs within static walls and furnishings. Only
        // occupancy and corridor masks describe physical tubes, so those are
        // checked on the actual arc instead of its discarded square corner.
        for (let n = 1; n <= radius; n++) if (!staticFree(cell + directions[heading] * n) || !staticFree(cell + directions[heading] * radius + directions[outgoing] * n)) { valid = false; break }
        if (!valid) continue
        const cx = x + vx * radius, cy = y + vy * radius, angle = Math.atan2(-vy, -vx), sign = ux * vy - uy * vx
        let before = cell
        for (let n = 1; n <= sampleCount; n++) {
          const theta = angle + sign * Math.PI / 2 * n / sampleCount
          const px = Math.round(cx + radius * Math.cos(theta)), py = Math.round(cy + radius * Math.sin(theta))
          if (px < 0 || py < 0 || px >= width || py >= height) { valid = false; break }
          const at = py * width + px
          const exact = options.pointFree
            ? staticFree(at) && (!options.requiredCorridor || options.requiredCorridor.has(at)) &&
              options.pointFree({ x: grid.origin.x + (cx + radius * Math.cos(theta)) * grid.step,
                y: grid.origin.y + (cy + radius * Math.sin(theta)) * grid.step })
            : free(at)
          if (!exact) { valid = false; break }
          if (at !== before) extra += wallStepCost(grid, before, at, options) + (options.congestion?.get(at) ?? 0) * 30
          before = at
        }
      } else extra += wallStepCost(grid, cell, destination, options) + (options.congestion?.get(destination) ?? 0) * 30
      if (!valid) continue
      const nextState = destination * 4 + outgoing, nextCost = cost[state] + extra
      if (closed[nextState] === generation || visited[nextState] === generation && nextCost >= cost[nextState]) continue
      cost[nextState] = nextCost; previous[nextState] = state; visited[nextState] = generation; heap.push(nextState, nextCost + heuristic(destination))
    }
  }
  return null
}
