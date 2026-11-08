import type { HeatingGrid } from './heating-routing.js'

type Run = { first: number; last: number; direction: number; vertical: boolean }
const runCache = new WeakMap<number[], Run[]>()
const runs = (cells: number[], width: number) => {
  const cached = runCache.get(cells)
  if (cached) return cached
  const result: Run[] = []
  for (let first = 0, last = 1; last < cells.length; last++) {
    const direction = cells[last] - cells[last - 1]
    if (last + 1 < cells.length && cells[last + 1] - cells[last] === direction) continue
    result.push({ first, last, direction, vertical: Math.abs(direction) === width }); first = last
  }
  runCache.set(cells, result); return result
}

/** Insert a neighbouring spiral through two short bridges at facing straight
 * runs. Its former inlet is closed with the same rounded-return construction.
 * Unlike endpoint-only joining, the combined coil keeps the accessible ports
 * of the first field. All proposed curves still require the full geometry audit. */
export function* heatingSpliceCandidates(a: number[], b: number[], grid: HeatingGrid, pitch: number, radius: number,
  checkpoint: () => void): Generator<number[]> {
  if (a.length < 3 || b.length < 3) return
  const first = b[0], last = b.at(-1)!, delta = first - last
  const closureStep = first % grid.width === last % grid.width ? Math.sign(delta) * grid.width : Math.floor(first / grid.width) === Math.floor(last / grid.width) ? Math.sign(delta) : 0
  if (!closureStep || Math.abs(delta / closureStep) > pitch * 2 || b[1] - first !== b.at(-2)! - last) return
  const closure = [last]
  for (let c = last + closureStep; c !== first + closureStep; c += closureStep) {
    if (c < 0 || c >= grid.wall.length || grid.obstacle[c] || grid.wall[c] || grid.room[c] !== grid.room[first]) return
    closure.push(c)
  }
  const cycle = [...b, ...closure.slice(1, -1)], size = cycle.length
  const along = (cell: number, vertical: boolean) => vertical ? Math.floor(cell / grid.width) : cell % grid.width
  const across = (cell: number, vertical: boolean) => vertical ? cell % grid.width : Math.floor(cell / grid.width)
  let proposals = 0
  for (const x of runs(a, grid.width)) for (const y of runs(b, grid.width)) {
    checkpoint()
    if (x.vertical !== y.vertical) continue
    const gap = Math.abs(across(a[x.first], x.vertical) - across(b[y.first], y.vertical))
    if (!gap || gap > pitch * 2) continue
    const delta = Math.max(0, radius - gap / 2), theta = delta ? Math.acos(1 - delta / (2 * radius)) : 0
    const tangent = Math.ceil(radius + 2 * radius * Math.sin(theta) + .01)
    const lower = Math.max(Math.min(along(a[x.first], x.vertical), along(a[x.last], x.vertical)), Math.min(along(b[y.first], y.vertical), along(b[y.last], y.vertical))) + tangent
    const upper = Math.min(Math.max(along(a[x.first], x.vertical), along(a[x.last], x.vertical)), Math.max(along(b[y.first], y.vertical), along(b[y.last], y.vertical))) - tangent
    const cutLength = Math.min(pitch * 4, upper - lower)
    if (cutLength < Math.ceil(radius * 2 + 1)) continue
    const mid = Math.round((lower + upper) / 2), sign = Math.sign(x.direction)
    const from = mid - sign * Math.floor(cutLength / 2), to = from + sign * cutLength
    const indexAt = (cells: number[], run: Run, n: number) => run.first + (n - along(cells[run.first], run.vertical)) * Math.sign(run.direction)
    const a0 = indexAt(a, x, from), a1 = indexAt(a, x, to), b0 = indexAt(b, y, from), b1 = indexAt(b, y, to)
    const bridge = (start: number, end: number) => {
      const step = x.vertical ? Math.sign(end - start) : Math.sign(end - start) * grid.width, path: number[] = []
      for (let c = start + step; c !== end + step; c += step) {
        if (grid.obstacle[c] || grid.wall[c] || grid.room[c] !== grid.room[a[0]]) return null
        path.push(c)
      }
      return path
    }
    const out = bridge(a[a0], b[b0]), back = bridge(b[b1], a[a1])
    if (!out || !back) continue
    const detour: number[] = [], direction = x.direction === y.direction ? -1 : 1
    for (let index = (b0 + direction + size) % size; index !== b1; index = (index + direction + size) % size) {
      if (detour.length > size) return
      detour.push(cycle[index])
    }
    detour.push(b[b1])
    yield [...a.slice(0, a0 + 1), ...out, ...detour, ...back, ...a.slice(a1 + 1)]
    if (++proposals >= 4) return
  }
}
