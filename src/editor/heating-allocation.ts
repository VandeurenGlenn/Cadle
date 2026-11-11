import type { Point } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingRoomKey, heatingWallDistances } from './heating-coverage.js'

/** Allocate manifold groups by their estimated complete length, including the
 * approach to each room. This is a planning target, not product certification. */
export const allocateHeatingCircuits = (grid: HeatingGrid, point: Point, capacity: number, spacingMm: number, edgeMm: number,
  scale: number, maxM: number, allowanceM: number, omitted: ReadonlySet<number>) => {
  const distance = heatingWallDistances(grid), cellArea = (grid.step * scale / 8000) ** 2
  const rooms = grid.rooms.flatMap((room) => {
    const cells = room.cells.filter((c) => !omitted.has(c) && !grid.obstacle[c] && !grid.loopObstacle[c] && distance[c] * grid.step * scale / 8 >= edgeMm)
    if (cells.length * cellArea < .1) return []
    const centre = cells.reduce((p, c) => { const q = grid.point(c); p.x += q.x / cells.length; p.y += q.y / cells.length; return p }, { x: 0, y: 0 })
    const leadM = 2 * (Math.abs(centre.x - point.x) + Math.abs(centre.y - point.y)) * scale / 8000
    return [{ key: heatingRoomKey(room), floorM: cells.length * cellArea / (spacingMm / 1000), leadM, count: 1 }]
  })
  if (!rooms.length || rooms.length > capacity) return { targets: new Map<string, number>(), suggestedMaxM: maxM }
  const totalFloor = rooms.reduce((n, room) => n + room.floorM, 0), meanLead = rooms.reduce((n, room) => n + room.floorM * room.leadM, 0) / totalFloor
  const requested = Math.min(capacity, Math.max(rooms.length, Math.ceil(totalFloor / Math.max(10, Math.min(100, maxM) - meanLead - allowanceM))))
  for (let i = rooms.length; i < requested; i++) {
    rooms.sort((a, b) => b.floorM / b.count + b.leadM - a.floorM / a.count - a.leadM)
    rooms[0].count++
  }
  // The average lead estimate must not leave a long, irregular room without
  // a usable group while the manifold still has spare outlets.
  for (let used = requested; used < capacity; used++) {
    rooms.sort((a, b) => b.floorM / b.count + b.leadM - a.floorM / a.count - a.leadM)
    if (rooms[0].floorM / rooms[0].count + rooms[0].leadM + allowanceM <= maxM * .9) break
    rooms[0].count++
  }
  const suggestedMaxM = Math.ceil(Math.max(...rooms.map((r) => r.floorM / r.count + r.leadM + allowanceM)) / 5) * 5
  return { targets: new Map(rooms.map((r) => [r.key, r.count])), suggestedMaxM }
}
