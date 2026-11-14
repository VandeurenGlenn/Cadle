import type { Point, RectShape } from './model/types.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingLaneShift } from './heating-s-curve.js'
import { heatingCurveWallConflict, heatingPathPoints, heatingWallAllowed, routeHeating, simplifyHeatingPath,
  type HeatingGrid, type HeatingRoutingOptions } from './heating-routing.js'

type Vertex = Point & { bendRadiusMm?: number }
type Box = { x: number; y: number; width: number; height: number }
const unit = (a: Point, b: Point) => {
  const n = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (b.x - a.x) / n, y: (b.y - a.y) / n }
}
const add = (p: Point, u: Point, distance: number): Point => ({ x: p.x + u.x * distance, y: p.y + u.y * distance })

/** Exact parallel control polygon: each circular fillet keeps its centre,
 * with a smaller inside radius and a larger outside radius. */
export const offsetHeatingRoute = (points: readonly Vertex[], offset: number, defaultRadiusMm: number, scale: number): Vertex[] =>
  points.length < 2 ? points.map((p) => ({ ...p })) : points.map((p, i) => {
    const u = i ? unit(points[i - 1], p) : unit(p, points[1])
    const v = i + 1 < points.length ? unit(p, points[i + 1]) : u
    const dot = u.x * v.x + u.y * v.y, cross = u.x * v.y - u.y * v.x
    const denominator = 1 + dot
    if (denominator < 1e-7) return { x: NaN, y: NaN }
    return { x: p.x + (-u.y - v.y) * offset / denominator,
      y: p.y + (u.x + v.x) * offset / denominator,
      ...(i && i + 1 < points.length && Math.abs(cross) > 1e-7
        ? { bendRadiusMm: (p.bendRadiusMm ?? defaultRadiusMm) - Math.sign(cross) * offset * scale / 8 } : {}) }
  })

/** Separate shortest paths can wrap opposite sides of another field and seal
 * its approach. Keep a supply/return pair in one corridor outside the loose
 * source fan, where its open ends may spread freely. */
export const heatingFeedPairCoherent = (pair: readonly RectShape[], spacingMm: number, scale: number,
  source?: Point, sourceRadiusMm = 1500) => {
  if (pair.length !== 2) return false
  const sourceRadius = sourceRadiusMm * 8 / scale, step = spacingMm * 8 / scale
  return pair.every((pipe, i) => {
    const other = pair[1 - i], outside = heatingPointClearance([other], Math.max(0, spacingMm * 4 - other.heating!.diameterMm), scale)
    for (const piece of heatingPipeGeometry(pipe).pieces) {
      const count = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / step))
      for (let n = 0; n <= count; n++) {
        const p = { x: piece.a.x + (piece.b.x - piece.a.x) * n / count, y: piece.a.y + (piece.b.y - piece.a.y) * n / count }
        if (source && Math.hypot(p.x - source.x, p.y - source.y) <= sourceRadius) continue
        if (outside(p)) return false
      }
    }
    return true
  })
}

/** Route a supply/return ribbon, rather than letting the first tube seal the
 * second. A local nested turn can precede the fan-in in a shallow entry apron. */
export const routePairedHeatingFeeds = (grid: HeatingGrid, coil: RectShape, coils: readonly RectShape[], fixed: readonly RectShape[],
  settings: { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }, scale: number,
  options: { source: Point; target?: Point; targetRadiusMm?: number; sourceRadiusMm: number; permittedWallCells: ReadonlySet<number>; nativeFloor?: HeatingGrid;
    nativeWallCells?: ReadonlySet<number>; obstacles?: readonly Box[]; routeOptions?: Pick<HeatingRoutingOptions, 'wallEntryPenalty' | 'preferredDoors' | 'manifoldAccess'>;
    guideCells?: readonly number[][]; fieldMask?: Uint32Array; ownField?: number; fast?: boolean; searchBudget?: { remaining: number }; checkpoint: () => void; rejectedSearches?: string[]; onSearch?: () => void }): [Vertex[], Vertex[]] | null => {
  const vertices = heatingPipeGeometry(coil).points, originalHeads = [vertices[0], vertices.at(-1)!]
  const u = unit(vertices[1], originalHeads[0]), other = unit(vertices.at(-2)!, originalHeads[1])
  if (!Number.isFinite(u.x) || u.x * other.x + u.y * other.y < .999) return null
  // Clipped/irregular spirals can end at different longitudinal stations.
  // Keep both real joints and extend only the shorter launch straight until
  // the two tubes can fan in together. The complete launch is audited below.
  const station = Math.max(...originalHeads.map((head) => head.x * u.x + head.y * u.y))
  const heads = originalHeads.map((head) => add(head, u, station - head.x * u.x - head.y * u.y))
  const aligned = originalHeads.map((head, i) => Math.hypot(head.x - heads[i].x, head.y - heads[i].y) > 1e-7 ? [head, heads[i]] : [head])
  const normal = { x: -u.y, y: u.x }, middle = { x: (heads[0].x + heads[1].x) / 2, y: (heads[0].y + heads[1].y) / 2 }
  const originalOffset = heads.map((p) => (p.x - middle.x) * normal.x + (p.y - middle.y) * normal.y)
  const gap = Math.abs(originalOffset[1] - originalOffset[0])
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), radius = limits.minBendRadiusMm * 8 / scale
  const separationMm = Math.max(settings.diameterMm * 1.25, grid.step * scale / 8 * 2)
  const half = separationMm * 4 / scale, centreRadiusMm = limits.minBendRadiusMm + separationMm / 2
  const centreRadius = centreRadiusMm * 8 / scale
  if (gap < half * 2 - 1e-6 || gap > settings.spacingMm * 16 / scale + grid.step * 2) return null
  const floor = options.nativeFloor ?? grid, wallOptions = { allowWalls: true, permittedWallCells: options.nativeWallCells ?? options.permittedWallCells }
  const all = [...coils, ...fixed], coilJoints = new Map([[coil.id, originalHeads]])
  const make = (id: string, points: Vertex[]) => createHeatingPipe(id, simplifyHeatingPath(points),
    { ...coil.heating!, automatic: true, pipeRole: 'supply', bendRadiusMm: limits.minBendRadiusMm })
  const valid = (pipes: RectShape[]) => !pipes.some((p) => heatingCurveWallConflict(floor, heatingPipeGeometry(p).pieces, wallOptions)) &&
    !checkHeatingPlan([...all, ...pipes], [], settings.design, [...options.obstacles ?? []],
      { focusPipeIds: new Set(pipes.map((p) => p.id)), stopOnConflict: true, checkpoint: options.checkpoint }).errors
  const sourceRoom = grid.room[grid.index(options.source)]
  const nativeSourceRoom = floor.room[floor.index(options.source)]
  const launches: { points: Vertex[][]; centre: Point; heading: Point; score: number }[] = []
  for (const turn of [0, -1, 1]) {
    options.checkpoint()
    let start = middle, heading = u
    let prefixes: Vertex[][] = aligned.map((points) => [...points])
    if (turn) {
      heading = { x: normal.x * turn, y: normal.y * turn }
      const leading = heads[0].x * heading.x + heads[0].y * heading.y > heads[1].x * heading.x + heads[1].y * heading.y ? 0 : 1
      // Narrow during the turn, with staggered centres. R80/R100 takes
      // 100 mm of outward space; an R80/R180 concentric pair needs 180 mm.
      prefixes = heads.map((head, i) => {
        const r = radius + (i === leading ? 0 : half * 2), corner = add(head, u, r), end = add(corner, heading, r)
        return [...aligned[i], { ...corner, bendRadiusMm: r * scale / 8 }, end]
      })
      const station = Math.max(...prefixes.map((p) => p.at(-1)!.x * heading.x + p.at(-1)!.y * heading.y))
      for (const prefix of prefixes) {
        const end = prefix.at(-1)!, advance = station - end.x * heading.x - end.y * heading.y
        if (advance > 1e-7) prefix.push(add(end, heading, advance))
      }
      start = { x: (prefixes[0].at(-1)!.x + prefixes[1].at(-1)!.x) / 2,
        y: (prefixes[0].at(-1)!.y + prefixes[1].at(-1)!.y) / 2 }
    }
    const v = { x: -heading.y, y: heading.x }
    const narrowed = prefixes.map((p) => {
      const from = p.at(-1)!, signed = (from.x - start.x) * v.x + (from.y - start.y) * v.y
      const target = Math.sign(signed) * half, lateral = Math.abs(signed - target)
      if (lateral < 1e-6) return { points: p, advance: 0, offset: target }
      const shift = heatingLaneShift(radius / grid.step, lateral / grid.step)
      if (!shift) return null
      const advance = shift.run * grid.step, end = add(add(start, heading, advance), v, target)
      return { points: [...p, { ...add(from, heading, shift.cut * grid.step), bendRadiusMm: limits.minBendRadiusMm },
        { ...add(end, heading, -shift.cut * grid.step), bendRadiusMm: limits.minBendRadiusMm }, end], advance, offset: target }
    })
    if (narrowed.some((p) => !p)) continue
    const [a, b] = narrowed as NonNullable<typeof narrowed[number]>[]
    if (Math.abs(a.advance - b.advance) > 1e-6) continue
    // Opposite consecutive turns can need a short straight after the fan-in;
    // same-direction nested turns may fit without it in a shallow apron.
    for (const straight of [0, settings.diameterMm * 8 / scale]) {
      const points = [a.points, b.points].map((path) => straight ? [...path, add(path.at(-1)!, heading, straight)] : path)
      if (points.some((p) => p.some((q) => !Number.isFinite(q.x + q.y)))) continue
      const pipes = points.map((p, i) => make(`paired-launch-${i}`, p))
      if (!valid(pipes)) continue
      const centre = add(start, heading, a.advance + straight)
      launches.push({ points, centre, heading, score: pipes.reduce((sum, pipe) => sum + heatingPipeGeometry(pipe).length, 0) / 2 +
        Math.hypot(centre.x - options.source.x, centre.y - options.source.y) })
    }
  }
  launches.sort((a, b) => a.score - b.score)
  let cellPenalty: Float32Array | undefined
  if (options.guideCells?.some((path) => path.length)) {
    const size = grid.wall.length, distance = new Uint16Array(size).fill(65535), queue = new Int32Array(size)
    let read = 0, write = 0
    for (const path of options.guideCells) for (const cell of path) if (cell >= 0 && cell < size && distance[cell]) {
      distance[cell] = 0; queue[write++] = cell
    }
    while (read < write) {
      if (read % 4096 === 0) options.checkpoint()
      const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next < 0 || distance[next] !== 65535) continue
        distance[next] = Math.min(65534, distance[cell] + 1); queue[write++] = next
      }
    }
    // Keep the topological flow's lane order. A broad yes/no corridor lets
    // every pair hug the same wall and seals the outer bend for later pairs.
    cellPenalty = Float32Array.from(distance, (n) => Math.min(n, centreRadius / grid.step * 4) * .5)
  }
  for (const [launchIndex, launch] of launches.entries()) {
    options.checkpoint()
    const root = grid.index(launch.centre), snapped = grid.point(root), dx = launch.centre.x - snapped.x, dy = launch.centre.y - snapped.y
    const phase: HeatingGrid = { ...grid, origin: { x: grid.origin.x + dx, y: grid.origin.y + dy },
      point: (cell) => { const p = grid.point(cell); return { x: p.x + dx, y: p.y + dy } },
      index: (p) => grid.index({ x: p.x - dx, y: p.y - dy }) }
    const prefixes = launch.points.map((p, i) => make(`paired-launch-${i}`, p))
    const joints = new Map(coilJoints)
    for (const p of prefixes) joints.set(p.id, [heatingPipeGeometry(p).points.at(-1)!])
    const free = heatingPointClearance([...all, ...prefixes], settings.diameterMm + separationMm, scale, { joints })
    const clearance = new Uint8Array(grid.wall.length)
    let restrictFields = Boolean(options.fieldMask)
    const at = (p: Point) => {
      if (!free(p)) return false
      // The wall raster already includes the tube radius. Add the half
      // distance between centres, not the tube radius a second time.
      for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.7071, .7071], [-.7071, .7071], [.7071, -.7071], [-.7071, -.7071]]) {
        const cell = floor.index({ x: p.x + x * half, y: p.y + y * half })
        if (cell < 0 || floor.obstacle[cell] || !heatingWallAllowed(floor, cell, wallOptions)) return false
      }
      return true
    }
    const pointFree = (p: Point) => {
      const cell = phase.index(p)
      if (cell < 0) return false
      const physicalCell = grid.index(p)
      if (physicalCell < 0 || restrictFields && options.fieldMask && (options.fieldMask[physicalCell] & ~(options.ownField ?? 0))) return false
      const q = phase.point(cell)
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) > 1e-7) return at(p)
      if (!clearance[cell]) clearance[cell] = at(p) ? 1 : 2
      return clearance[cell] === 1
    }
    const target = options.target ?? options.source
    for (const radiusMm of options.targetRadiusMm ? [options.targetRadiusMm] : [...new Set([Math.min(500, options.sourceRadiusMm), options.sourceRadiusMm])].sort((a, b) => a - b)) {
      options.checkpoint()
      const searchKey = `${launchIndex}:${radiusMm}`
      if (options.rejectedSearches?.includes(searchKey)) continue
      const sourceRadius = drawingUnitsForMetres(radiusMm / 1000, scale) - (options.targetRadiusMm ? 0 : half), hint = phase.index(target), goals = new Set<number>()
      const reach = Math.ceil(sourceRadius / grid.step) + 1, cx = hint % grid.width, cy = Math.floor(hint / grid.width)
      for (let y = Math.max(0, cy - reach); y <= Math.min(grid.height - 1, cy + reach); y++)
        for (let x = Math.max(0, cx - reach); x <= Math.min(grid.width - 1, cx + reach); x++) {
          const cell = y * grid.width + x, p = phase.point(cell)
          const native = floor.index(p)
          if (grid.room[cell] === sourceRoom && native >= 0 && floor.room[native] === nativeSourceRoom &&
            Math.hypot(p.x - target.x, p.y - target.y) <= sourceRadius && pointFree(p)) goals.add(cell)
        }
      if (!goals.size) continue
      const heading = launch.heading.x ? Math.sign(launch.heading.x) : Math.sign(launch.heading.y) * grid.width
      let path: number[] | null = null
      for (const restricted of options.fieldMask ? [true, false] : [false]) {
        restrictFields = restricted
        for (const variableBends of options.fast ? [false] : [false, true]) {
          for (const obstacleHeuristic of variableBends && coils.length >= 4 ? [true, false] : [false]) {
            const attempt = `${searchKey}:${restricted}:${variableBends}:${obstacleHeuristic}`
            if (options.rejectedSearches?.includes(attempt)) continue
            if (options.searchBudget && options.searchBudget.remaining-- <= 0) return null
            options.onSearch?.()
            path = routeHeating(phase, root, hint, { ...options.routeOptions, allowWalls: true, permittedWallCells: options.permittedWallCells,
              goalRegion: goals, goalRadiusCells: Math.ceil(sourceRadius / grid.step), radiusCells: Math.ceil(2 * centreRadius / grid.step),
              startDirection: heading, preferArcs: true, continuousTurns: true, variableBends, obstacleHeuristic, pointFree, cellPenalty, searchWeight: 1.25, checkpoint: options.checkpoint })
            if (path) break
            options.rejectedSearches?.push(attempt)
          }
          if (path) break
        }
        if (path) break
      }
      if (!path) { options.rejectedSearches?.push(searchKey); continue }
      const centre = heatingPathPoints(phase, path)
      const v = { x: -launch.heading.y, y: launch.heading.x }
      const pair = launch.points.map((prefix) => {
        if (centre.length < 2) return prefix
        const end = prefix.at(-1)!, offset = Math.sign((end.x - launch.centre.x) * v.x + (end.y - launch.centre.y) * v.y) * half
        const ribbon = offsetHeatingRoute(centre, offset, centreRadiusMm, scale)
        return [...prefix, ...ribbon.slice(1)]
      })
      if (pair.some((p) => p.some((q) => !Number.isFinite(q.x + q.y)))) continue
      const pipes = pair.map((p, i) => make(`paired-feed-${i}`, p))
      if (valid(pipes)) return pair.map((p) => [...p].reverse()) as [Vertex[], Vertex[]]
      options.rejectedSearches?.push(searchKey)
    }
  }
  return null
}
