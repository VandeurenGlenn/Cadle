import type { Point } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingWallDistances } from './heating-coverage.js'

const cache = new WeakMap<Uint8Array, Map<string, { pitchCells: number; penalty: Float32Array; pitchMm: Float32Array }>>()

/** Feed pipes heat the floor too. Spread them at the requested laying pitch in
 * rooms, compressing only their approaches to doors and the distribution point. */
export const heatingFeedLanes = (grid: HeatingGrid, point: Point, spacingMm: number, diameterMm: number, scale: number) => {
  const key = `${point.x}:${point.y}:${spacingMm}:${diameterMm}:${scale}`
  const entries = cache.get(grid.door) ?? new Map()
  if (!cache.has(grid.door)) cache.set(grid.door, entries)
  const found = entries.get(key)
  if (found) return found
  const distance = heatingWallDistances({ ...grid, wall: grid.door }), cellMm = grid.step * scale / 8
  const penalty = new Float32Array(grid.wall.length), pitchMm = new Float32Array(grid.wall.length)
  const compact = Math.max(cellMm, diameterMm * 1.2)
  for (let cell = 0; cell < penalty.length; cell++) {
    const p = grid.point(cell), sourceMm = Math.hypot(p.x - point.x, p.y - point.y) * scale / 8
    const blend = Math.max(0, Math.min(1, (Math.min(sourceMm, distance[cell] * cellMm) - 400) / 500))
    penalty[cell] = grid.room[cell] > 0 ? blend * 12 : 0
    pitchMm[cell] = compact + (spacingMm - compact) * blend
  }
  const result = { pitchCells: Math.max(1, Math.round(spacingMm / cellMm)), penalty, pitchMm }
  entries.set(key, result)
  return result
}
