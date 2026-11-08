import type { Point } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingSpliceCandidates } from './heating-splice.js'

type Bounds = { x: number; y: number; width: number; height: number }

/** Join obstacle-separated fields into one open tube. Bounded work is essential:
 * manual zone previews are rendered on the UI thread and cached by the caller. */
export const joinHeatingZoneFields = (fields: readonly Point[][], bounds: Bounds, obstacles: readonly Bounds[],
  spacing: number, radius: number, valid: (points: Point[], remaining: readonly Point[][]) => boolean): Point[] | null => {
  if (fields.length < 2) return fields[0] ?? null
  if (fields.length > 24) return null
  const step = spacing / 4, origin = { x: bounds.x - step * 2, y: bounds.y - step * 2 }
  const width = Math.ceil(bounds.width / step) + 5, height = Math.ceil(bounds.height / step) + 5, size = width * height
  if (size > 250_000) return null
  const point = (cell: number) => ({ x: origin.x + cell % width * step, y: origin.y + Math.floor(cell / width) * step })
  const index = (p: Point) => Math.round((p.y - origin.y) / step) * width + Math.round((p.x - origin.x) / step)
  const obstacle = new Uint8Array(size), wall = new Uint8Array(size), room = new Int32Array(size)
  for (let cell = 0; cell < size; cell++) {
    const p = point(cell)
    if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.height) { wall[cell] = 1; continue }
    room[cell] = 1
    if (obstacles.some((b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)) obstacle[cell] = 1
  }
  const grid: HeatingGrid = { origin, step, width, height, wall, door: new Uint8Array(size), obstacle, loopObstacle: obstacle, room, rooms: [], point, index }
  const compact = (cells: number[]) => cells.map(point).filter((p, i, all) => !i || i === all.length - 1 ||
    Math.abs((p.x - all[i - 1].x) * (all[i + 1].y - p.y) - (p.y - all[i - 1].y) * (all[i + 1].x - p.x)) > 1e-7)
  const raster = (points: readonly Point[]) => {
    const vertices = points.map(index), result = [vertices[0]]
    for (const end of vertices.slice(1)) {
      const start = result.at(-1)!
      if (start === end) continue
      const stride = start % width === end % width ? Math.sign(end - start) * width : Math.floor(start / width) === Math.floor(end / width) ? Math.sign(end - start) : 0
      if (!stride || Math.abs((end - start) / stride) > size || result.length > 100_000) return null
      for (let cell = start + stride; cell !== end + stride; cell += stride) result.push(cell)
    }
    return result
  }
  const paths = fields.map(raster)
  if (paths.some((path) => !path)) return null
  const pending = paths as number[][]
  let attempts = 0
  while (pending.length > 1 && attempts < 96) {
    let joined = false
    for (let a = 0; a < pending.length && !joined; a++) for (let b = 0; b < pending.length && !joined; b++) {
      if (a === b || ++attempts > 96) continue
      const remaining = pending.filter((_, i) => i !== a && i !== b).map(compact)
      for (const candidate of heatingSpliceCandidates(pending[a], pending[b], grid, 4, radius / step, () => {})) {
        const points = compact(candidate)
        if (!valid(points, remaining)) continue
        pending[a] = candidate; pending.splice(b, 1); joined = true; break
      }
    }
    if (!joined) return null
  }
  if (pending.length !== 1) return null
  return compact(pending[0])
}
