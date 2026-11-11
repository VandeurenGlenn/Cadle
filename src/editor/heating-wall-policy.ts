import type { Point } from './model/types.js'
import { heatingSourceRoom, type HeatingGrid } from './heating-routing.js'
import { heatingWallDistances } from './heating-coverage.js'

/** A partition needs recognised floor on both sides, even when those sides
 * connect elsewhere. Facades, shafts and furnishings never become shortcuts. */
export const heatingInternalWallCells = (grid: HeatingGrid, scale: number, checkpoint: () => void = () => {}): ReadonlySet<number> => {
  const cells = new Set<number>(), rooms = new Set(grid.rooms.map((room) => room.id))
  const probe = Math.max(1600 / scale, grid.step * 2), doorDistances = heatingWallDistances({ ...grid, wall: grid.door })
  for (let cell = 0; cell < grid.wall.length; cell++) {
    if (cell % 4096 === 0) checkpoint()
    if (!grid.wall[cell] || grid.obstacle[cell] || doorDistances[cell] * grid.step < probe) continue
    const p = grid.point(cell)
    for (const normal of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
      const a = grid.index({ x: p.x + normal.x * probe, y: p.y + normal.y * probe })
      const b = grid.index({ x: p.x - normal.x * probe, y: p.y - normal.y * probe })
      if (a < 0 || b < 0 || grid.obstacle[a] || grid.obstacle[b] || !rooms.has(grid.room[a]) || !rooms.has(grid.room[b])) continue
      cells.add(cell)
      break
    }
  }
  return cells
}

/** A fallback is one local internal passage, only when it saves at least two
 * metres versus the real door network. The source room always uses its door. */
export const heatingFallbackPassage = (grid: HeatingGrid, source: Point, target: Point, scale: number) => {
  const region = heatingSourceRoom(grid, source), goal = grid.index(target)
  let sourceCell = grid.index(source)
  const sourceRoom = region?.id ?? grid.room[sourceCell]
  if (region && grid.room[sourceCell] !== sourceRoom) sourceCell = region.cells.reduce((best, cell) => {
    const p = grid.point(cell), q = grid.point(best)
    return Math.hypot(p.x - source.x, p.y - source.y) < Math.hypot(q.x - source.x, q.y - source.y) ? cell : best
  }, region.cells[0])
  if (sourceCell < 0 || goal < 0 || sourceRoom <= 0) return undefined
  const size = grid.wall.length, queue = new Int32Array(size)
  const distances = (root: number) => {
    const result = new Int32Array(size).fill(-1)
    if (grid.obstacle[root]) return result
    let read = 0, write = 1; queue[0] = root; result[root] = 0
    while (read < write) {
      const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next < 0 || result[next] >= 0 || grid.obstacle[next] || grid.room[next] < 0 || grid.wall[next] && !grid.door[next]) continue
        result[next] = result[cell] + 1; queue[write++] = next
      }
    }
    return result
  }
  const from = distances(sourceCell), to = distances(goal), baseline = from[goal] < 0 ? Infinity : from[goal]
  const probe = 1600 / scale, saving = 16000 / scale / grid.step, rooms = new Set(grid.rooms.map((room) => room.id))
  let best: { cell: number; normal: Point; a: number; b: number; cost: number } | undefined
  for (let cell = 0; cell < size; cell++) {
    if (!grid.wall[cell] || grid.door[cell] || grid.obstacle[cell]) continue
    const p = grid.point(cell)
    for (const normal of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
      const a = grid.index({ x: p.x + normal.x * probe, y: p.y + normal.y * probe })
      const b = grid.index({ x: p.x - normal.x * probe, y: p.y - normal.y * probe })
      if (a < 0 || b < 0 || !rooms.has(grid.room[a]) || !rooms.has(grid.room[b]) || grid.room[a] === grid.room[b] || grid.room[a] === sourceRoom || grid.room[b] === sourceRoom) continue
      const cost = Math.min(from[a] >= 0 && to[b] >= 0 ? from[a] + to[b] : Infinity,
        from[b] >= 0 && to[a] >= 0 ? from[b] + to[a] : Infinity) + 2 * probe / grid.step
      if (!Number.isFinite(cost) || cost + saving > baseline || best && cost >= best.cost) continue
      best = { cell, normal, a: grid.room[a], b: grid.room[b], cost }
    }
  }
  if (!best) return undefined
  const centre = grid.point(best.cell), tangent = { x: -best.normal.y, y: best.normal.x }, cells = new Set<number>(), clearance: number[] = []
  const reach = Math.ceil(2400 / scale / grid.step)
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const x = best.cell % grid.width + dx, y = Math.floor(best.cell / grid.width) + dy
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue
    const cell = y * grid.width + x, p = grid.point(cell), along = (p.x - centre.x) * tangent.x + (p.y - centre.y) * tangent.y
    if (Math.abs(along) > 800 / scale || grid.obstacle[cell]) continue
    clearance.push(cell)
    if (!grid.wall[cell] || grid.door[cell]) continue
    const a = grid.room[grid.index({ x: p.x + best.normal.x * probe, y: p.y + best.normal.y * probe })]
    const b = grid.room[grid.index({ x: p.x - best.normal.x * probe, y: p.y - best.normal.y * probe })]
    if (a === best.a && b === best.b || a === best.b && b === best.a) cells.add(cell)
  }
  return cells.size ? { cells, clearance, point: centre } : undefined
}
