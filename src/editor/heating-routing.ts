import type { Point, Shape } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { shapeBounds } from './model/model.js'
import { namedRoomRegions } from './room-regions.js'
import { heatingDoorSymbolThreshold, isHeatingDoorSymbol, isHeatingSymbolObstacle } from './heating-openings.js'

export type HeatingRoom = { id: number; name: string; cells: number[]; minX: number; maxX: number; minY: number; maxY: number }
export type HeatingGrid = {
  origin: Point; step: number; width: number; height: number
  wall: Uint8Array; door: Uint8Array; obstacle: Uint8Array; loopObstacle: Uint8Array; room: Int32Array; rooms: HeatingRoom[]
  point: (index: number) => Point
  index: (point: Point) => number
}

export const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Closed wall/door boundaries identify rooms; device footprints are always hard obstacles. */
export const buildHeatingGrid = (shapes: readonly Shape[], scale: number, spacingMm: number, manifold: Point,
  pipe?: { pipeDiameterMm: number; minBendRadiusMm: number }): HeatingGrid => {
  const walls = shapes.filter((s) => s.kind === 'wall' && !s.hidden)
  if (!walls.length) throw new Error('Geen muren gevonden. Teken eerst de gesloten ruimtes op het grondplan.')
  const points = walls.flatMap((s) => 'start' in s ? [s.start, s.end] : [])
  // An integer number of cells per laying interval preserves the entered spacing exactly.
  const step = drawingUnitsForMetres(spacingMm / 1000, scale) / Math.max(2, Math.ceil(spacingMm / 25))
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
  for (const shape of shapes) {
    if (!shape.hidden && isHeatingDoorSymbol(shape)) {
      const { start, end } = heatingDoorSymbolThreshold(shape)
      // Close the room boundary for flood filling, while marking this exact
      // threshold as a preferred passage for supply and return pipes.
      raster(start, end, step * .8, wall)
      raster(start, end, Math.max(drawingUnitsForMetres(.2, scale), step * 2), door)
    }
    if (shape.hidden || !('start' in shape)) continue
    if (shape.kind === 'wall') raster(shape.start, shape.end, Math.max(step * .75, (shape.strokeWidth ?? 6) / 2), wall)
    if (shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate') {
      raster(shape.start, shape.end, step * .8, wall)
      if (shape.kind !== 'window') raster(shape.start, shape.end,
        Math.max(drawingUnitsForMetres(.2, scale), step * 2), door)
    }
  }
  for (const shape of shapes) {
    if (!isHeatingSymbolObstacle(shape)) continue
    const b = shapeBounds(shape)
    for (const [target, clearance] of [[obstacle, drawingUnitsForMetres(Math.max(.05, (pipe?.pipeDiameterMm ?? 16) / 2000), scale) + step],
      [loopObstacle, drawingUnitsForMetres(Math.max(.05, (pipe?.minBendRadiusMm ?? 80) * .002 + (pipe?.pipeDiameterMm ?? 16) / 2000), scale) + step]] as const) {
      const minX = Math.max(0, Math.floor((b.x - clearance - origin.x) / step))
      const maxX = Math.min(width - 1, Math.ceil((b.x + b.width + clearance - origin.x) / step))
      const minY = Math.max(0, Math.floor((b.y - clearance - origin.y) / step))
      const maxY = Math.min(height - 1, Math.ceil((b.y + b.height + clearance - origin.y) / step))
      for (let y = minY; y <= maxY; y++) target.fill(1, y * width + minX, y * width + maxX + 1)
    }
  }
  const queue = new Int32Array(size), rooms: HeatingRoom[] = [], namedRegions = namedRoomRegions(shapes)
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
    const centre = point(cells[Math.floor(cells.length / 2)])
    const named = namedRegions.filter((region) => centre.x > region.x && centre.x < region.x + region.width &&
      centre.y > region.y && centre.y < region.y + region.height).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    rooms.push({ id, name: named?.name ?? `Ruimte ${rooms.length + 1}`, cells, minX, maxX, minY, maxY })
  }
  if (!rooms.length) throw new Error('Geen gesloten ruimtes herkend. Sluit de muren van het grondplan voordat je een legplan maakt.')
  return { origin, step, width, height, wall, door, obstacle, loopObstacle, room, rooms, point, index }
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
  roomId?: number
  occupied?: ReadonlySet<number>
  allowWalls?: boolean
  congestion?: ReadonlyMap<number, number>
  startDirection?: number
  endDirection?: number
  radiusCells?: number
  wallEntryPenalty?: number
  manifoldAccess?: { point: Point; radius: number; entryPenalty: number }
}

// Charge every separate wall entry, not just the number of wall cells. Several
// thin-wall penetrations must not become cheaper than one slightly thicker wall.
// A short access through a wall next to the manifold is a preferred alternative
// to a long detour, but still costs more than an equally short open doorway.
const wallStepCost = (grid: HeatingGrid, from: number, to: number, options: HeatingRoutingOptions): number => {
  if (!grid.wall[to] || grid.door[to]) return 0
  if (grid.wall[from] && !grid.door[from]) return 4
  const access = options.manifoldAccess
  const nearManifold = access && Math.hypot(grid.origin.x + to % grid.width * grid.step - access.point.x,
    grid.origin.y + Math.floor(to / grid.width) * grid.step - access.point.y) <= access.radius
  return 4 + (nearManifold ? access.entryPenalty : options.wallEntryPenalty ?? 24)
}

/** Favor openings and fewer penetrations, allowing worthwhile short wall routes. */
export const routeHeating = (grid: HeatingGrid, start: number, end: number,
  options: HeatingRoutingOptions = {}): number[] | null => {
  if (options.radiusCells) return routeWithBends(grid, start, end, options)
  const { width, height } = grid
  if (start < 0 || end < 0 || grid.obstacle[start] || grid.obstacle[end]) return null
  const previous = new Int32Array(width * height).fill(-1), cost = new Float64Array(width * height).fill(Infinity)
  const closed = new Uint8Array(width * height), heap = new MinHeap()
  const heuristic = (i: number) => Math.abs(i % width - end % width) + Math.abs(Math.floor(i / width) - Math.floor(end / width))
  cost[start] = 0; heap.push(start, heuristic(start))
  while (heap.values.length) {
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
      if (n < 0 || closed[n] || grid.obstacle[n] ||
        (i === start && options.startDirection !== undefined && n - i !== options.startDirection) ||
        (n === end && options.endDirection !== undefined && n - i !== options.endDirection) ||
        (options.roomId !== undefined && grid.room[n] !== options.roomId) ||
        (!options.allowWalls && grid.wall[n]) || (n !== end && n !== start && options.occupied?.has(n))) continue
      const last = previous[i], turn = last >= 0 && n - i !== i - last ? .15 : 0
      const next = cost[i] + 1 + turn + wallStepCost(grid, i, n, options) + (options.congestion?.get(n) ?? 0) * 30
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


type RoutingWorkspace = { cost: Float64Array; previous: Int32Array; visited: Uint32Array; closed: Uint32Array; generation: number }
// A wall mask belongs to one immutable grid. Generation stamps avoid allocating and
// clearing millions of state slots on every route; a new grid gets a fresh workspace.
const routingWorkspaces = new WeakMap<Uint8Array, RoutingWorkspace>()

/** Direction-aware rays leave at least two bend radii between successive corners. */
const routeWithBends = (grid: HeatingGrid, start: number, end: number, options: HeatingRoutingOptions): number[] | null => {
  const { width, height } = grid, size = width * height, reach = Math.max(2, options.radiusCells ?? 2)
  const directions = [1, width, -1, -width]
  const validStep = (a: number, b: number) => b >= 0 && b < size && Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width)) === 1
  const free = (i: number) => i >= 0 && i < size && !grid.obstacle[i] && (options.roomId === undefined || grid.room[i] === options.roomId) && (options.allowWalls || !grid.wall[i]) && (i === start || i === end || !options.occupied?.has(i))
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
  let workspace = routingWorkspaces.get(grid.wall)
  if (!workspace) {
    workspace = { cost: new Float64Array(size * 4), previous: new Int32Array(size * 4), visited: new Uint32Array(size * 4), closed: new Uint32Array(size * 4), generation: 0 }
    routingWorkspaces.set(grid.wall, workspace)
  }
  if (workspace.generation >= 0xffffffff) { workspace.visited.fill(0); workspace.closed.fill(0); workspace.generation = 0 }
  const generation = ++workspace.generation, { cost, previous, visited, closed } = workspace, heap = new MinHeap()
  const heuristic = (i: number) => Math.abs(i % width - target % width) + Math.abs(Math.floor(i / width) - Math.floor(target / width))
  for (let d = 0; d < 4; d++) if (options.startDirection === undefined || directions[d] === options.startDirection) {
    const state = root * 4 + d; cost[state] = 0; previous[state] = -1; visited[state] = generation; heap.push(state, heuristic(root))
  }
  let explored = 0
  while (heap.values.length) {
    const state = heap.pop(), i = Math.floor(state / 4), heading = state % 4
    if (closed[state] === generation) continue
    if (i === target && (options.endDirection === undefined || directions[heading] !== -options.endDirection)) {
      const nodes = [state]
      while (previous[nodes.at(-1)!] >= 0) nodes.push(previous[nodes.at(-1)!])
      nodes.reverse()
      const path = [root]
      for (let n = 1; n < nodes.length; n++) {
        const destination = Math.floor(nodes[n] / 4), direction = directions[nodes[n] % 4]
        while (path.at(-1) !== destination) path.push(path.at(-1)! + direction)
      }
      return [...first.slice(0, -1), ...path, ...last.slice(1)]
    }
    if (++explored > 80000) return null
    closed[state] = generation
    for (const d of [heading, (heading + 1) % 4, (heading + 3) % 4]) {
      let n = i, added = d === heading ? 0 : reach * .3, valid = true
      for (let step = 0; step < (d === heading ? 1 : reach); step++) {
        const next = n + directions[d]
        if (!validStep(n, next) || !free(next) || blocked.has(next)) { valid = false; break }
        added += 1 + wallStepCost(grid, n, next, options) + (options.congestion?.get(next) ?? 0) * 30
        n = next
        if (n === target && (options.endDirection === undefined || directions[d] === options.endDirection || ((d === heading || step + 1 === reach) && directions[d] !== -options.endDirection))) break
      }
      if (!valid) continue
      const nextState = n * 4 + d, nextCost = cost[state] + added
      if (closed[nextState] === generation || (visited[nextState] === generation && nextCost >= cost[nextState])) continue
      previous[nextState] = state; cost[nextState] = nextCost; visited[nextState] = generation; heap.push(nextState, nextCost + heuristic(n))
    }
  }
  return null
}
