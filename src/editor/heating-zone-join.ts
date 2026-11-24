import type { Point } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingSpliceCandidates } from './heating-splice.js'
import { exactHeatingSpliceCandidates } from './heating-paired-splice.js'
import { combineHeatingPatterns, type HeatingPattern } from './heating-pattern.js'

type Bounds = { x: number; y: number; width: number; height: number }
const compact = (points: readonly Point[]) => points.filter((p, i, all) => !i || i === all.length - 1 ||
  Math.abs((p.x - all[i - 1].x) * (all[i + 1].y - p.y) - (p.y - all[i - 1].y) * (all[i + 1].x - p.x)) > 1e-7)

/** Small, bounded joins for cached manual previews. No extra circuit is created
 * when fixtures divide the free floor into several rectangular spiral fields. */
export const joinHeatingZoneFields = (fields: readonly Point[][][], bounds: Bounds, obstacles: readonly Bounds[],
  spacing: number, radius: number, valid: (points: Point[], remaining: readonly Point[][]) => boolean,
  patternFor: (points: Point[]) => HeatingPattern = () => 'spiral',
  options: { timeMs?: number; auditLimit?: number; checkpoint?: () => void; prepare?: (points: Point[]) => Point[]; allowPortSplice?: boolean } = {}): { points: Point[]; pattern: HeatingPattern } | null => {
  if (fields.length < 2) return fields[0]?.[0] ? { points: fields[0][0], pattern: patternFor(fields[0][0]) } : null
  if (fields.length > 24) return null
  const stop = Symbol('manual-zone-work-limit'), deadline = Date.now() + (options.timeMs ?? 300), auditLimit = options.auditLimit ?? 96
  const checkpoint = () => { options.checkpoint?.(); if (Date.now() > deadline) throw stop }
  const prepared = new WeakMap<Point[], Point[]>()
  const prepare = (points: Point[]) => {
    let result = prepared.get(points)
    if (!result) { result = options.prepare?.(points) ?? points; prepared.set(points, result); prepared.set(result, result) }
    return result
  }
  try {
    let divisions = 4
    for (let n = 4; n <= 24; n += 2) if (Math.abs(radius * n / spacing - Math.round(radius * n / spacing)) < 1e-6) { divisions = n; break }
    const step = spacing / divisions, origin = { x: bounds.x - step * 2, y: bounds.y - step * 2 }
    const width = Math.ceil(bounds.width / step) + 5, height = Math.ceil(bounds.height / step) + 5, size = width * height
    if (size > 900_000) return null
    const point = (cell: number) => ({ x: origin.x + cell % width * step, y: origin.y + Math.floor(cell / width) * step })
    const index = (p: Point) => Math.round((p.y - origin.y) / step) * width + Math.round((p.x - origin.x) / step)
    const obstacle = new Uint8Array(size), wall = new Uint8Array(size), room = new Int32Array(size)
    for (let cell = 0; cell < size; cell++) {
      if (cell % 2048 === 0) checkpoint()
      const p = point(cell)
      if (p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.height) { wall[cell] = 1; continue }
      room[cell] = 1
      if (obstacles.some((b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height)) obstacle[cell] = 1
    }
    const grid: HeatingGrid = { origin, step, width, height, wall, door: new Uint8Array(size), obstacle, loopObstacle: obstacle, room, rooms: [], point, index }
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
    const patterns = new WeakMap<Point[], HeatingPattern>(), bases = new WeakMap<Point[], Point[]>()
    const orientations = (points: Point[], pattern: HeatingPattern) => {
      const reversed = [...points].reverse(); patterns.set(points, pattern); patterns.set(reversed, pattern)
      bases.set(points, points); bases.set(reversed, points)
      return [points, reversed]
    }
    const pending = fields.map((variants) => variants.flatMap((points) => orientations(prepare(points), patternFor(points))))
    const entryVariants = (variants: Point[][]) => {
      // Reversing supply/return does not move a physical inlet. Counting both
      // used half the variant budget before the farther, door-facing corners.
      const unique = [...new Set(variants.map((points) => bases.get(points) ?? points))]
      const signature = (points: Point[]) => JSON.stringify([[points[0], points[1]], [points.at(-1)!, points.at(-2)!]].map(([p, q]) => {
        const length = Math.hypot(q.x - p.x, q.y - p.y)
        return [p.x, p.y, (q.x - p.x) / length, (q.y - p.y) / length].map((n) => Math.round(n * 1e6) / 1e6)
      }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
      const entrances = new Map<string, Point[]>()
      for (const points of unique) if (!entrances.has(signature(points))) entrances.set(signature(points), points)
      // Joined fields can have several safe bridge locations with the same
      // inlet heading. A later pocket may need one of those other locations.
      return [...new Set([...entrances.values(), ...unique])].slice(0, 12)
    }
    const backtracks: { pending: Point[][][]; blocked: Set<string> }[] = []
    let blocked = new Set<string>()
    let audits = 0, pairs = 0, stateLimit = auditLimit
    const safe = (candidate: Point[], a: number, b: number) => {
      if (++audits > stateLimit) return false
      const remaining = pending.filter((_, i) => i !== a && i !== b).map((variants) => variants[0])
      return valid(candidate, remaining)
    }
    const accept = (candidate: Point[], a: number, b: number, pattern: HeatingPattern) => {
      if (!safe(candidate, a, b)) return false
      pending[a] = orientations(candidate, pattern); pending.splice(b, 1); return true
    }
    while (pending.length > 1 && audits < auditLimit && pairs < 256) {
      stateLimit = Math.min(auditLimit, audits + Math.max(16, Math.floor(auditLimit / 4)))
      let joined = false
      const boxes = pending.map((variants) => {
        const xs = variants[0].map((p) => p.x), ys = variants[0].map((p) => p.y)
        return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
      })
      const neighbours = boxes.flatMap((a, i) => boxes.flatMap((b, j) => i === j ? [] : [{ a: i, b: j,
        gap: Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom)) }]))
        .sort((a, b) => a.gap - b.gap || a.a - b.a || a.b - b.b)
      // Insert wide fields at facing runs first. This keeps both original ends
      // available for a narrow adjacent field that cannot fit two side bridges.
      for (const { a, b } of neighbours) {
        if (joined || ++pairs > 256) break
        const key = `${a}:${b}`
        if (blocked.has(key)) continue
        const alternatives: Point[][] = []
        variants: for (const av of entryVariants(pending[a])) for (const bv of entryVariants(pending[b])) {
          if (audits >= stateLimit) break variants
          // Keep exact fractional bends when fields have different raster
          // phases. Rounding every retained corner can shrink an R80 to R74.
          for (const raw of exactHeatingSpliceCandidates(av, bv, spacing, radius, checkpoint, options.allowPortSplice)) {
            if (alternatives.length >= 8 || audits >= stateLimit) break
            const candidate = prepare(compact(raw))
            if (safe(candidate, a, b)) { patterns.set(candidate, combineHeatingPatterns([patterns.get(av), patterns.get(bv)])); alternatives.push(candidate) }
          }
          if (alternatives.length) continue
          const x = raster(av), y = raster(bv)
          if (!x || !y) continue
          for (const cells of heatingSpliceCandidates(x, y, grid, divisions, radius / step, checkpoint)) {
            if (alternatives.length >= 8 || audits >= stateLimit) break
            const candidate = prepare(compact(cells.map(point)))
            if (safe(candidate, a, b)) { patterns.set(candidate, combineHeatingPatterns([patterns.get(av), patterns.get(bv)])); alternatives.push(candidate) }
          }
        }
        if (alternatives.length) {
          if (pending.length > 2 && backtracks.length < 24) backtracks.push({ pending: pending.map((variants) => [...variants]), blocked: new Set([...blocked, key]) })
          pending[a] = alternatives.flatMap((points) => orientations(points, patterns.get(points)!)); pending.splice(b, 1); blocked = new Set(); joined = true
        }
      }
      if (joined) continue
      const choices: { a: number; b: number; x: Point[]; y: Point[]; distance: number }[] = []
      for (let a = 0; a < pending.length; a++) for (let b = 0; b < pending.length; b++) if (a !== b) {
        for (const x of pending[a]) for (const y of pending[b]) choices.push({ a, b, x, y, distance: Math.hypot(x.at(-1)!.x - y[0].x, x.at(-1)!.y - y[0].y) })
      }
      choices.sort((a, b) => a.distance - b.distance)
      for (const { a, b, x, y } of choices) {
        checkpoint()
        if (blocked.has(`${a}:${b}`)) continue
        if (audits >= stateLimit) break
        const p = x.at(-1)!, before = x.at(-2)!, q = y[0], after = y[1]
        const ul = Math.hypot(p.x - before.x, p.y - before.y), vl = Math.hypot(after.x - q.x, after.y - q.y)
        const u = { x: (p.x - before.x) / ul, y: (p.y - before.y) / ul }, v = { x: (after.x - q.x) / vl, y: (after.y - q.y) / vl }
        const along = (q.x - p.x) * u.x + (q.y - p.y) * u.y, dot = u.x * v.x + u.y * v.y
        const bridges: Point[][] = []
        if (dot > .99 && along > 0) {
          for (const fraction of [.25, 1 / 3]) bridges.push([p, { x: p.x + u.x * along * fraction, y: p.y + u.y * along * fraction },
            { x: q.x - v.x * along * fraction, y: q.y - v.y * along * fraction }, q])
        } else if (Math.abs(dot) < .01) {
          const turn = u.x ? { x: q.x, y: p.y } : { x: p.x, y: q.y }
          if ((turn.x - p.x) * u.x + (turn.y - p.y) * u.y >= 0 && (q.x - turn.x) * v.x + (q.y - turn.y) * v.y >= 0) bridges.push([p, turn, q])
        }
        for (const bridge of bridges) {
          if (bridge.some((p) => p.x < bounds.x || p.y < bounds.y || p.x > bounds.x + bounds.width || p.y > bounds.y + bounds.height)) continue
          const candidate = prepare(compact([...x, ...bridge.slice(1, -1), ...y]))
          const previous = pending.length > 2 ? pending.map((variants) => [...variants]) : undefined
          if (accept(candidate, a, b, combineHeatingPatterns([patterns.get(x), patterns.get(y)]))) {
            if (previous && backtracks.length < 24) backtracks.push({ pending: previous, blocked: new Set([...blocked, `${a}:${b}`]) })
            blocked = new Set(); joined = true; break
          }
        }
        if (joined) break
      }
      if (!joined) {
        const previous = backtracks.pop()
        if (!previous) return null
        pending.splice(0, pending.length, ...previous.pending); blocked = previous.blocked
      }
    }
    return pending.length === 1 ? { points: pending[0][0], pattern: patterns.get(pending[0][0])! } : null
  } catch (error) {
    if (error === stop) return null
    throw error
  }
}
