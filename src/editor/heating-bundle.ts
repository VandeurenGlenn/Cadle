import { wallStepCost, type HeatingGrid, type HeatingRoutingOptions } from './heating-routing.js'

type Path = { source: number; cells: number[] }
class Heap {
  nodes: number[] = []; costs: number[] = []; turns: number[] = []
  before(a: number, b: number) { return this.costs[a] < this.costs[b] - 1e-8 || Math.abs(this.costs[a] - this.costs[b]) < 1e-8 && this.turns[a] < this.turns[b] }
  swap(a: number, b: number) { for (const values of [this.nodes, this.costs, this.turns]) [values[a], values[b]] = [values[b], values[a]] }
  push(node: number, cost: number, turns: number) {
    let i = this.nodes.length; this.nodes.push(node); this.costs.push(cost); this.turns.push(turns)
    while (i) { const parent = (i - 1) >> 1; if (!this.before(i, parent)) break; this.swap(i, parent); i = parent }
  }
  pop() {
    const node = this.nodes[0], last = this.nodes.length - 1
    this.swap(0, last); this.nodes.pop(); this.costs.pop(); this.turns.pop()
    let i = 0
    for (;;) { let child = i * 2 + 1; if (child >= this.nodes.length) break; if (child + 1 < this.nodes.length && this.before(child + 1, child)) child++; if (!this.before(child, i)) break; this.swap(i, child); i = child }
    return node
  }
}

/** Route all feed tubes as one vertex-disjoint flow. Residual edges can move an
 * earlier tube when it blocks a later one; ports are assigned after the complete
 * bundle exists. This avoids exponential backtracking of fixed port pairs.
 * Rounded geometry remains a separate, mandatory validation step. */
export const routeHeatingBundle = (grid: HeatingGrid, sources: readonly number[], goals: readonly number[], blocked: Uint8Array,
  options: HeatingRoutingOptions, onProgress?: (done: number) => void): Path[] | null => {
  if (!sources.length || sources.length !== goals.length || new Set(sources).size !== sources.length || new Set(goals).size !== goals.length) return null
  const size = grid.wall.length, states = size * 2
  if ([...sources, ...goals].some((c) => c < 0 || blocked[c] || grid.obstacle[c])) return null
  const used = new Uint8Array(size), next = new Int32Array(size).fill(-1), incoming = new Int32Array(size).fill(-1)
  const goalIndex = new Int16Array(size).fill(-1), goalUsed = new Uint8Array(goals.length), sourceUsed = new Uint8Array(sources.length)
  goals.forEach((cell, i) => { goalIndex[cell] = i })
  const potential = new Float64Array(states), distance = new Float64Array(states), previous = new Int32Array(states), closed = new Uint8Array(states)
  const turns = new Uint16Array(states), roots = new Int16Array(states), heading = new Int32Array(states)
  const free = (cell: number) => !blocked[cell] && !grid.obstacle[cell]
  const cost = (a: number, b: number) => 1 + wallStepCost(grid, a, b, options)
  for (let flow = 0; flow < goals.length; flow++) {
    options.checkpoint?.(); onProgress?.(flow)
    distance.fill(Infinity); previous.fill(-1); closed.fill(0); turns.fill(65535); roots.fill(-1); heading.fill(0)
    const heap = new Heap()
    sources.forEach((cell, i) => { if (!sourceUsed[i]) { const state = cell * 2; distance[state] = 0; turns[state] = 0; roots[state] = i; heap.push(state, 0, 0) } })
    let found = -1, iterations = 0
    const relax = (from: number, to: number, edgeCost: number, direction = 0) => {
      if (closed[to]) return
      const reduced = Math.max(0, edgeCost + potential[from] - potential[to]), candidate = distance[from] + reduced
      const bends = turns[from] + (direction && heading[from] && direction !== heading[from] ? 1 : 0)
      if (candidate > distance[to] + 1e-8 || Math.abs(candidate - distance[to]) < 1e-8 && bends >= turns[to]) return
      distance[to] = candidate; previous[to] = from; turns[to] = bends; roots[to] = roots[from]; heading[to] = direction || heading[from]
      heap.push(to, candidate, bends)
    }
    while (heap.nodes.length) {
      if (++iterations % 1024 === 0) options.checkpoint?.()
      const state = heap.pop()
      if (closed[state]) continue
      closed[state] = 1
      const cell = state >> 1, out = state & 1, goal = goalIndex[cell]
      if (out && goal >= 0 && !goalUsed[goal]) { found = state; break }
      if (!out && !used[cell]) relax(state, state + 1, 0)
      if (out && used[cell]) relax(state, state - 1, 0)
      if (out) {
        const x = cell % grid.width, y = Math.floor(cell / grid.width)
        for (const neighbour of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
          if (neighbour >= 0 && free(neighbour) && next[cell] !== neighbour) relax(state, neighbour * 2, cost(cell, neighbour), neighbour - cell)
        }
      } else if (incoming[cell] >= 0) relax(state, incoming[cell] * 2 + 1, -cost(incoming[cell], cell), incoming[cell] - cell)
    }
    if (found < 0) return null
    const endDistance = distance[found]
    for (let i = 0; i < states; i++) potential[i] += Math.min(distance[i], endDistance)
    const path: number[] = [found]
    while (previous[path.at(-1)!] >= 0) {
      if (path.length > states) return null
      path.push(previous[path.at(-1)!])
    }
    path.reverse()
    // Remove reverse residual edges before installing the replacements.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], ac = a >> 1, bc = b >> 1
      if ((a & 1) && !(b & 1) && ac === bc) used[ac] = 0
      else if (!(a & 1) && (b & 1) && ac !== bc) { next[bc] = -1; incoming[ac] = -1 }
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], ac = a >> 1, bc = b >> 1
      if (!(a & 1) && (b & 1) && ac === bc) used[ac] = 1
      else if ((a & 1) && !(b & 1) && ac !== bc) { next[ac] = bc; incoming[bc] = ac }
    }
    sourceUsed[roots[found]] = 1; goalUsed[goalIndex[found >> 1]] = 1
  }
  const result: Path[] = Array(goals.length)
  for (let source = 0; source < sources.length; source++) {
    const cells = [sources[source]]
    while (goalIndex[cells.at(-1)!] < 0 || !goalUsed[goalIndex[cells.at(-1)!]]) {
      const cell = next[cells.at(-1)!]
      if (cell < 0 || cells.length > size) return null
      cells.push(cell)
    }
    const goal = goalIndex[cells.at(-1)!]
    if (result[goal]) return null
    result[goal] = { source, cells }
  }
  onProgress?.(goals.length)
  return result
}
