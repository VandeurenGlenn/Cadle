import type { Point, RectShape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingAreaSettings } from './heating-area-kernel.js'
import type { HeatingCoverage } from './heating-coverage.js'
import { heatingCoverageRadius, heatingRoomKey, heatingWallDistances, measureHeatingCoverage } from './heating-coverage.js'
import { generateHeatingAreaLoop, rectangularHeatingArea } from './heating-area-kernel.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { createHeatingPipe } from './heating-pipe.js'
import { heatingDesignLimits } from './heating-design.js'
import { combineHeatingPatterns } from './heating-pattern.js'
import { heatingPointClearance } from './heating-clearance.js'
import { heatingSpliceWindows } from './heating-paired-splice.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingCurveWallConflict, heatingPathPoints, routeHeating, simplifyHeatingPath } from './heating-routing.js'
import { segmentDistance } from './heating-distance.js'

type Box = { x: number; y: number; width: number; height: number }
export type HeatingCoveragePatch = { circuitId: string; roomKey: string; bounds: Box; gapReductionM2: number; addedM: number }
export type HeatingCoverageRepairOptions = {
  /** Locked circuits remain immutable even when present in this set. */
  mutableCircuitIds?: ReadonlySet<string>
  obstacles?: Box[]
  checkpoint?: () => void
  maxCandidates?: number
  maxAccepted?: number
  /** Search only; the initial whole-floor measurement is always completed. */
  searchMs?: number
  /** Must have been measured from these exact pipes and this native grid. */
  baselineCoverage?: HeatingCoverage
  /** A durable checkpoint can store completed patches before a later pause. */
  onAccepted?: (pipes: readonly RectShape[], coverage: HeatingCoverage, patch: HeatingCoveragePatch) => void
}
export type HeatingCoverageRepairResult = {
  pipes: RectShape[]; coverage: HeatingCoverage; changedCircuitIds: string[]; acceptedPatches: HeatingCoveragePatch[]
  attempts: number; bounded: boolean; uncoveredCells: number; rejected: Record<string, number>
}
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const gapM2 = (coverage: HeatingCoverage) => coverage.rooms.reduce((sum, room) => sum + room.gapM2, 0)
const samePorts = (a: readonly Point[], b: readonly Point[]) => {
  if (a.length < 2 || b.length < 2) return false
  for (const end of [false, true]) {
    const p = end ? a.at(-1)! : a[0], q = end ? b.at(-1)! : b[0]
    const u = end ? a.at(-2)! : a[1], v = end ? b.at(-2)! : b[1]
    if (length(p, q) > 1e-7 || !length(p, u) || !length(q, v) ||
      Math.abs((u.x - p.x) / length(p, u) - (v.x - q.x) / length(q, v)) > 1e-7 ||
      Math.abs((u.y - p.y) / length(p, u) - (v.y - q.y) / length(q, v)) > 1e-7) return false
  }
  return true
}

/** Unlike the editor overlay this mask contains EVERY uncovered eligible cell.
 * Eligibility and reach use the production coverage rule, without reclassifying
 * narrow strips or dropping later rooms after the overlay's 2,000 point cap. */
export const heatingCoverageRepairGaps = (grid: HeatingGrid, pipes: readonly RectShape[], scale: number, spacingMm: number,
  edgeMm: number, minimum: number, checkpoint: () => void, roomKeys?: ReadonlySet<string>, turnMinimum = 0) => {
  const maxRadius = heatingCoverageRadius(Math.max(spacingMm, ...pipes.map((p) => p.heating?.spacingMm ?? spacingMm)), scale, grid.step)
  const bucket = Math.max(maxRadius * 2, grid.step), wallDistance = heatingWallDistances(grid)
  type Reach = { a: Point; b: Point; radius: number }
  const buckets = new Map<string, Reach[]>()
  for (const pipe of pipes) {
    checkpoint()
    if (pipe.hidden || pipe.heating?.kind !== 'pipe' || !pipe.heating.circuitId) continue
    const radius = heatingCoverageRadius(pipe.heating.spacingMm, scale, grid.step)
    for (const { a, b } of heatingPipeGeometry(pipe).pieces) {
      const value = { a, b, radius }
      for (let y = Math.floor((Math.min(a.y, b.y) - maxRadius) / bucket); y <= Math.floor((Math.max(a.y, b.y) + maxRadius) / bucket); y++)
        for (let x = Math.floor((Math.min(a.x, b.x) - maxRadius) / bucket); x <= Math.floor((Math.max(a.x, b.x) + maxRadius) / bucket); x++) {
          const key = `${x},${y}`, entries = buckets.get(key) ?? []; entries.push(value); buckets.set(key, entries)
        }
    }
  }
  const mask = new Uint8Array(grid.wall.length), clearance = edgeMm * 8 / scale / grid.step
  let uncovered = 0, visited = 0
  for (const room of grid.rooms) for (const cell of room.cells) {
    if (++visited % 2048 === 0) checkpoint()
    if (grid.obstacle[cell] || wallDistance[cell] < clearance) continue
    const p = grid.point(cell), entries = buckets.get(`${Math.floor(p.x / bucket)},${Math.floor(p.y / bucket)}`) ?? []
    if (!entries.some((piece) => segmentDistance(p, piece.a, piece.b) <= piece.radius)) { mask[cell] = 1; uncovered++ }
  }
  type Rectangle = Box & { roomKey: string; cells: number }
  const rectangles: Rectangle[] = [], queue: number[] = [], heights = new Int32Array(grid.width)
  // Flood all components before extracting bounded rectangle proposals. The
  // histogram finds broad interiors even when rounded corners alter each row.
  for (const room of grid.rooms) for (const root of room.cells) {
    if ((roomKeys && !roomKeys.has(heatingRoomKey(room))) || mask[root] !== 1) continue
    queue.length = 0; queue.push(root); mask[root] = 2
    let minX = grid.width, maxX = 0, minY = grid.height, maxY = 0
    for (let read = 0; read < queue.length; read++) {
      if (read % 2048 === 0) checkpoint()
      const cell = queue[read], x = cell % grid.width, y = Math.floor(cell / grid.width)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next >= 0 && mask[next] === 1 && grid.room[next] === room.id) { mask[next] = 2; queue.push(next) }
      }
    }
    const component = new Set(queue), byKind: Rectangle[][] = [[], []]
    heights.fill(0, minX, maxX + 1)
    for (let y = minY; y <= maxY; y++) {
      checkpoint()
      const stack: { x: number; height: number }[] = []
      for (let x = minX; x <= maxX + 1; x++) {
        const height = x > maxX ? 0 : heights[x] = component.has(y * grid.width + x) ? heights[x] + 1 : 0
        let start = x
        while (stack.length && stack.at(-1)!.height > height) {
          const entry = stack.pop()!, width = (x - entry.x) * grid.step, h = entry.height * grid.step
          start = entry.x
          // The proposal is inside uncovered cells, with a half-cell safety
          // trim. It must fit an actual R turn, not just a visual line stroke.
          if (Math.min(width, h) - grid.step < minimum) continue
          const topLeft = grid.point((y - entry.height + 1) * grid.width + entry.x)
          const rect = { x: topLeft.x, y: topLeft.y, width: width - grid.step, height: h - grid.step,
            roomKey: heatingRoomKey(room), cells: (x - entry.x) * entry.height }
          const best = byKind[Math.min(rect.width, rect.height) < turnMinimum ? 1 : 0]
          if (best.some((other) => rect.x >= other.x && rect.y >= other.y && rect.x + rect.width <= other.x + other.width && rect.y + rect.height <= other.y + other.height)) continue
          // A taller histogram row supersedes its own shorter prefixes. Keep
          // distinct gaps instead of spending the budget on six nested copies.
          for (let i = best.length - 1; i >= 0; i--) {
            const other = best[i]
            if (other.x >= rect.x && other.y >= rect.y && other.x + other.width <= rect.x + rect.width && other.y + other.height <= rect.y + rect.height) best.splice(i, 1)
          }
          best.push(rect); best.sort((a, b) => b.cells - a.cells); best.length = Math.min(best.length, 6)
        }
        if (height && (!stack.length || stack.at(-1)!.height < height)) stack.push({ x: start, height })
      }
    }
    rectangles.push(...byKind.flat())
  }
  // A long edge strip must not displace every broad patch or every smaller
  // room before any exact connector search gets a chance to inspect them.
  const groups = new Map<string, Rectangle[]>()
  for (const rectangle of rectangles.sort((a, b) => b.cells - a.cells)) {
    const key = `${rectangle.roomKey}:${Math.min(rectangle.width, rectangle.height) < turnMinimum ? 1 : 0}`
    const group = groups.get(key) ?? []; group.push(rectangle); groups.set(key, group)
  }
  const ordered = [...groups.values()].sort((a, b) =>
    Number(Math.min(a[0].width, a[0].height) < turnMinimum) - Number(Math.min(b[0].width, b[0].height) < turnMinimum))
  const selected: Rectangle[] = []
  for (let round = 0; selected.length < 24; round++) {
    let found = false
    for (const group of ordered) if (group[round]) {
      selected.push(group[round]); found = true
      if (selected.length === 24) break
    }
    if (!found) break
  }
  return { uncovered, rectangles: selected }
}

/** A small phase-aligned routing grid avoids rebuilding the entire plan or
 * allocating a global 10 mm raster for a pair of short patch connectors. */
const localGrid = (native: HeatingGrid, points: Point[], radius: number, pitch: number, checkpoint: () => void): HeatingGrid | undefined => {
  const step = Math.min(native.step, pitch / 10), pad = radius * 4, phase = points[0]
  const origin = { x: phase.x + Math.floor((Math.min(...points.map((p) => p.x)) - pad - phase.x) / step) * step,
    y: phase.y + Math.floor((Math.min(...points.map((p) => p.y)) - pad - phase.y) / step) * step }
  const width = Math.ceil((Math.max(...points.map((p) => p.x)) + pad - origin.x) / step) + 1
  const height = Math.ceil((Math.max(...points.map((p) => p.y)) + pad - origin.y) / step) + 1, size = width * height
  if (size > 160_000) return
  const point = (cell: number) => ({ x: origin.x + cell % width * step, y: origin.y + Math.floor(cell / width) * step })
  const index = (p: Point) => {
    const x = Math.round((p.x - origin.x) / step), y = Math.round((p.y - origin.y) / step)
    return x < 0 || y < 0 || x >= width || y >= height ? -1 : y * width + x
  }
  const wall = new Uint8Array(size), door = new Uint8Array(size), obstacle = new Uint8Array(size), room = new Int32Array(size)
  for (let cell = 0; cell < size; cell++) {
    if (cell % 2048 === 0) checkpoint()
    const n = native.index(point(cell))
    if (n < 0) { wall[cell] = 1; continue }
    wall[cell] = native.wall[n]; door[cell] = native.door[n]; obstacle[cell] = native.obstacle[n]; room[cell] = native.room[n]
  }
  return { origin, step, width, height, wall, door, obstacle, loopObstacle: obstacle, room, rooms: [], point, index, drawingScale: native.drawingScale }
}
const exact = (points: Point[], at: Point, start: boolean) => {
  const path = points.map((p) => ({ ...p })); if (!start) path.reverse()
  if (path.length > 1) {
    if (Math.abs(path[1].x - path[0].x) < 1e-6) path[1].x = at.x
    else if (Math.abs(path[1].y - path[0].y) < 1e-6) path[1].y = at.y
  }
  path[0] = { ...at }
  return start ? path : path.reverse()
}
// New long parallel laying runs keep the host pitch. Short tangent bridges
// and curved returns use the exact tube-envelope and R checks instead.
const patchSpacingFits = (patch: RectShape, others: readonly RectShape[], scale: number, geometryFor = heatingPipeGeometry) => {
  const pitch = patch.heating!.spacingMm * 8 / scale
  const runs = others.flatMap((other) => geometryFor(other).pieces.flatMap((piece) => {
    const bx = piece.b.x - piece.a.x, by = piece.b.y - piece.a.y, bl = Math.hypot(bx, by)
    return bl < pitch * 2 ? [] : [{ ...piece, bx, by, bl, pitch: other.heating!.spacingMm * 8 / scale }]
  }))
  for (const a of geometryFor(patch).pieces) {
    const ax = a.b.x - a.a.x, ay = a.b.y - a.a.y, al = Math.hypot(ax, ay)
    if (al < pitch * 2) continue
    for (const b of runs) {
      if (Math.abs(ax * b.by - ay * b.bx) > al * b.bl * .001) continue
      const u = { x: ax / al, y: ay / al }, from = (b.a.x - a.a.x) * u.x + (b.a.y - a.a.y) * u.y
      const to = (b.b.x - a.a.x) * u.x + (b.b.y - a.a.y) * u.y
      if (Math.min(al, Math.max(from, to)) - Math.max(0, Math.min(from, to)) < pitch / 2) continue
      const separation = Math.abs((b.a.x - a.a.x) * u.y - (b.a.y - a.a.y) * u.x)
      if (separation < Math.max(pitch, b.pitch) - 1e-5) return false
    }
  }
  return true
}

/** Move only the middle of a long run. The original ends, adjacent corners
 * and pipe ports remain fixed; the two shallow S transitions retain R turns. */
function* shiftedRunCandidates(points: readonly Point[], box: Box, radius: number, pitch: number,
  reach: number, isLoop: boolean): Generator<Point[]> {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const runs = points.slice(1).flatMap((b, index) => {
    const a = points[index], span = length(a, b)
    if (span < radius * 6 || Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) return []
    return [{ a, b, index, span, distance: segmentDistance(centre, a, b) }]
  }).sort((a, b) => a.distance - b.distance).slice(0, 3)
  for (const { a, b, index, span, distance } of runs) {
    const ux = (b.x - a.x) / span, uy = (b.y - a.y) / span, nx = -uy, ny = ux
    const signed = (centre.x - a.x) * nx + (centre.y - a.y) * ny
    if (distance > pitch * 2 || Math.abs(signed) <= reach) continue
    const station = (centre.x - a.x) * ux + (centre.y - a.y) * uy
    const projection = Math.abs(ux) * box.width + Math.abs(uy) * box.height
    const desired = Math.sign(signed) * Math.min(pitch, Math.max(0, Math.abs(signed) - reach * .8))
    for (const fraction of [1, .75, .5]) for (const spanFraction of [.75, .5, 1]) {
      const shift = desired * fraction, ramp = Math.max(radius * 2, Math.abs(shift) * 2)
      const half = Math.max(pitch, projection * spanFraction / 2)
      const from = Math.max(radius * 2, station - half - ramp), to = Math.min(span - radius * 2, station + half + ramp)
      if (to - from < ramp * 2 + pitch) continue
      const straightFrom = from + ramp, straightTo = to - ramp
      if (isLoop && points.slice(1).some((d, other) => {
        if (other === index) return false
        const c = points[other], dx = d.x - c.x, dy = d.y - c.y
        if (Math.abs(dx * uy - dy * ux) > 1e-6 || length(c, d) < pitch * 2) return false
        const lo = Math.min((c.x - a.x) * ux + (c.y - a.y) * uy, (d.x - a.x) * ux + (d.y - a.y) * uy)
        const hi = Math.max((c.x - a.x) * ux + (c.y - a.y) * uy, (d.x - a.x) * ux + (d.y - a.y) * uy)
        const separation = (c.x - a.x) * nx + (c.y - a.y) * ny
        // Do not widen a declared laying pitch behind the moved run. Transit
        // bridges without a nearby parallel laying run can still be shifted.
        return Math.min(straightTo, hi) - Math.max(straightFrom, lo) > pitch &&
          Math.abs(separation) <= pitch * 1.05 && Math.abs(separation - shift) > pitch + 1e-5
      })) continue
      const point = (at: number, offset = 0): Point => ({ x: a.x + ux * at + nx * offset, y: a.y + uy * at + ny * offset })
      yield [...points.slice(0, index + 1), point(from), point(straightFrom, shift), point(straightTo, shift), point(to), ...points.slice(index + 1)]
    }
  }
}

/** Bounded repair of broad gaps and narrow transit strips. Every circuit port
 * remains fixed. A broad gap gets an interior loop splice; a narrow gap may
 * instead spread an existing straight bridge or actual feed through free floor. */
export const repairHeatingCoverageLoops = (native: HeatingGrid, input: readonly RectShape[], settings: HeatingAreaSettings,
  scale: number, options: HeatingCoverageRepairOptions = {}): HeatingCoverageRepairResult => {
  const external = options.checkpoint ?? (() => {}), result: HeatingCoverageRepairResult = {
    pipes: [...input], coverage: options.baselineCoverage ?? measureHeatingCoverage(native, input, scale, settings.spacingMm, settings.edgeMm ?? 100, external, false).coverage,
    changedCircuitIds: [], acceptedPatches: [], attempts: 0, bounded: false, uncoveredCells: 0, rejected: {} }
  const stop = Symbol('coverage-repair-work-limit'), deadline = Date.now() + Math.max(0, options.searchMs ?? 2500)
  const checkpoint = () => { external(); if (Date.now() >= deadline) throw stop }
  const maxCandidates = Math.max(0, Math.floor(options.maxCandidates ?? 24)), maxAccepted = Math.max(0, Math.floor(options.maxAccepted ?? 2))
  const reject = (reason: string) => { result.rejected[reason] = (result.rejected[reason] ?? 0) + 1 }
  result.uncoveredCells = Math.round(gapM2(result.coverage) / (native.step * scale / 8000) ** 2)
  const lockedCircuits = new Set(input.filter((p) => p.locked || p.heating?.circuitLocked).map((p) => p.heating?.circuitId))
  const geometryCache = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (pipe: RectShape) => { let geometry = geometryCache.get(pipe); if (!geometry) { geometry = heatingPipeGeometry(pipe); geometryCache.set(pipe, geometry) }; return geometry }
  const pipe = (host: RectShape, points: Point[], id = host.id) => {
    const generated = createHeatingPipe(id, points, host.heating!)
    return { ...host, id, start: generated.start, end: generated.end, heating: generated.heating }
  }
  const totalsFit = (pipes: RectShape[]) => {
    const totals = new Map<string, number>()
    for (const p of pipes) if (p.heating?.kind === 'pipe' && p.heating.circuitId)
      totals.set(p.heating.circuitId, (totals.get(p.heating.circuitId) ?? 0) + geometryFor(p).length * scale / 8000)
    return pipes.every((p) => {
      if (!p.heating?.circuitId) return true
      const limits = heatingDesignLimits(p.heating.diameterMm, p.heating.design ?? settings.design)
      return totals.get(p.heating.circuitId)! + limits.allowanceM <= limits.maxCircuitLengthM + 1e-7
    })
  }
  try {
    while (result.acceptedPatches.length < maxAccepted && result.attempts < maxCandidates) {
      checkpoint()
      const loops = result.pipes.filter((p) => p.heating?.kind === 'pipe' && p.heating.pipeRole === 'loop' && p.heating.circuitId &&
        !p.hidden && !lockedCircuits.has(p.heating.circuitId) && (!options.mutableCircuitIds || options.mutableCircuitIds.has(p.heating.circuitId)) &&
        !(p.rotation || p.flipX || p.flipY))
      if (!loops.length) break
      const minimum = Math.min(...loops.map((p) => {
        const data = p.heating!, limits = heatingDesignLimits(data.diameterMm, data.design ?? settings.design)
        return (limits.minBendRadiusMm * 2 + data.diameterMm) * 8 / scale
      }))
      const reviewRooms = new Set(result.coverage.rooms.filter((room) => room.gapM2 > Math.max(.05, room.eligibleM2 * .02)).map((room) => room.key))
      const gaps = heatingCoverageRepairGaps(native, result.pipes, scale, settings.spacingMm, settings.edgeMm ?? 100, 0, checkpoint,
        reviewRooms.size ? reviewRooms : undefined, minimum)
      result.uncoveredCells = gaps.uncovered
      let accepted = false
      // Narrow strips often need one existing transit run moved a few
      // centimetres, rather than a separate U patch that cannot physically fit.
      // Actual passing feeds may contribute heat, but both ends stay fixed.
      runProposals: for (const box of gaps.rectangles.filter((box) => Math.min(box.width, box.height) < minimum)) {
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const hosts = result.pipes.filter((host) => host.heating?.kind === 'pipe' && host.heating.circuitId && !host.hidden &&
          !lockedCircuits.has(host.heating.circuitId) && (!options.mutableCircuitIds || options.mutableCircuitIds.has(host.heating.circuitId)) &&
          !(host.rotation || host.flipX || host.flipY)).map((host) => ({ host, distance: Math.min(...geometryFor(host).pieces.map((piece) =>
            segmentDistance(centre, piece.a, piece.b))) })).sort((a, b) => a.distance - b.distance).slice(0, 6)
        for (const { host } of hosts) {
          const data = host.heating!, limits = heatingDesignLimits(data.diameterMm, data.design ?? settings.design)
          const radius = limits.minBendRadiusMm * 8 / scale, pitch = data.spacingMm * 8 / scale
          const original = geometryFor(host), reach = heatingCoverageRadius(data.spacingMm, scale, native.step)
          const allowedWalls = new Set<number>()
          for (const piece of original.pieces) {
            const n = Math.max(1, Math.ceil(length(piece.a, piece.b) / (native.step / 2)))
            for (let i = 0; i <= n; i++) {
              const cell = native.index({ x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n })
              if (cell >= 0 && native.wall[cell] && !native.door[cell]) allowedWalls.add(cell)
            }
          }
          for (const points of shiftedRunCandidates(original.points, box, radius, pitch, reach, data.pipeRole === 'loop')) {
            checkpoint()
            if (result.attempts >= maxCandidates) { result.bounded = true; break runProposals }
            result.attempts++
            const candidate = pipe(host, points), geometry = geometryFor(candidate)
            if (!samePorts(original.points, geometry.points)) { reject('run-ports'); continue }
            if (heatingCurveWallConflict(native, geometry.pieces, { allowWalls: true, permittedWallCells: allowedWalls })) { reject('run-wall'); continue }
            const updated = result.pipes.map((p) => p === host ? candidate : p)
            if (!totalsFit(updated)) { reject('length-budget'); continue }
            const audit = checkHeatingPlan(updated, [], undefined, options.obstacles, { focusPipeIds: new Set([host.id]), geometryFor,
              stopOnConflict: true, checkpoint })
            if (audit.errors) { reject(`run-${audit.issues.find((issue) => issue.severity === 'error')?.code ?? 'unknown'}`); continue }
            const coverage = measureHeatingCoverage(native, updated, scale, settings.spacingMm, settings.edgeMm ?? 100, checkpoint, false).coverage
            const reduction = gapM2(result.coverage) - gapM2(coverage), cellM2 = (native.step * scale / 8000) ** 2
            if (reduction < cellM2 / 2 || coverage.rooms.some((room) => room.gapM2 > (result.coverage.rooms.find((r) => r.key === room.key)?.gapM2 ?? 0) + cellM2 / 2)) { reject('run-coverage'); continue }
            const acceptedPatch = { circuitId: data.circuitId!, roomKey: box.roomKey, bounds: box,
              gapReductionM2: reduction, addedM: (geometry.length - original.length) * scale / 8000 }
            result.pipes = updated; result.coverage = coverage; result.acceptedPatches.push(acceptedPatch)
            result.uncoveredCells = Math.round(gapM2(coverage) / cellM2)
            if (!result.changedCircuitIds.includes(data.circuitId!)) result.changedCircuitIds.push(data.circuitId!)
            options.onAccepted?.(updated, coverage, acceptedPatch); accepted = true; break runProposals
          }
        }
      }
      if (accepted) continue
      if (result.attempts >= maxCandidates) { result.bounded = true; break }
      proposals: for (const box of gaps.rectangles) {
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const hosts = loops.map((host) => {
          const points = geometryFor(host).points, rooms = host.heating!.roomMembers?.map((r) => r.key) ??
            (host.heating!.roomKey ? [host.heating!.roomKey] : native.rooms.filter((room) => points.some((p) => native.room[native.index(p)] === room.id)).map(heatingRoomKey))
          return { host, points, rooms, distance: Math.min(...geometryFor(host).pieces.map((piece) => segmentDistance(centre, piece.a, piece.b))) }
        }).filter((host) => host.rooms.includes(box.roomKey)).sort((a, b) => a.distance - b.distance).slice(0, 3)
        // Give every nearby circuit its first entrance variant before one
        // blocked host spends the entire bounded search on four variants.
        for (let variant = 0; variant < 4; variant++) {
          for (const { host, points: original, rooms } of hosts) {
            const data = host.heating!, limits = heatingDesignLimits(data.diameterMm, data.design ?? settings.design)
            const radius = limits.minBendRadiusMm * 8 / scale, pitch = data.spacingMm * 8 / scale, diameter = data.diameterMm * 8 / scale
            if (Math.min(box.width, box.height) < radius * 2 + diameter) continue
            const others = result.pipes.filter((p) => p !== host), allowedRooms = new Set(native.rooms.filter((r) => rooms.includes(heatingRoomKey(r))).map((r) => r.id))
            const entry = [...original].sort((a, b) => length(a, centre) - length(b, centre))[0]
            const circuitM = result.pipes.filter((p) => p.heating?.circuitId === data.circuitId).reduce((sum, p) => sum + geometryFor(p).length * scale / 8000, 0)
            const remainingM = limits.maxCircuitLengthM - limits.allowanceM - circuitM
            if (remainingM <= 0) { reject('length-budget'); continue }
            checkpoint()
            const trim = Math.max(0, pitch - heatingCoverageRadius(data.spacingMm, scale, native.step))
            const patchBox = { x: box.x + trim, y: box.y + trim, width: box.width - trim * 2, height: box.height - trim * 2 }
            // Propose a small, connected patch when the full component exceeds
            // this host's remaining hydraulic length. Keep room for the two
            // bridges; the final exact total is still checked without slack.
            const areaBudget = remainingM * .7 * data.spacingMm / 1000 * (8000 / scale) ** 2
            if (patchBox.width * patchBox.height > areaBudget) {
              if (patchBox.width >= patchBox.height) {
                const width = areaBudget / patchBox.height
                if (entry.x > patchBox.x + patchBox.width / 2) patchBox.x += patchBox.width - width
                patchBox.width = width
              } else {
                const height = areaBudget / patchBox.width
                if (entry.y > patchBox.y + patchBox.height / 2) patchBox.y += patchBox.height - height
                patchBox.height = height
              }
            }
            if (Math.min(patchBox.width, patchBox.height) < radius * 2 + diameter) continue
            const area = rectangularHeatingArea(patchBox, entry)
            // A gap boundary is not a wall: paired patch inlets must be able
            // to approach through already heated floor. The kernel controls
            // the laying bounds here; exact native walls/fixtures and every
            // retained tube are audited after the two connectors are joined.
            area.clearance = { boundaries: rectangularHeatingArea({ x: patchBox.x - radius * 2, y: patchBox.y - radius * 2,
              width: patchBox.width + radius * 4, height: patchBox.height + radius * 4 }).boundaries,
              edge: 0, bounds: patchBox, coverageStep: native.step }
            const patch = generateHeatingAreaLoop(area, { diameterMm: data.diameterMm,
              spacingMm: data.spacingMm, design: data.design ?? settings.design, edgeMm: 0, entryVariant: variant }, scale, checkpoint)
            if (!patch) { reject('patch'); continue }
            const choices = heatingSpliceWindows(original, patch.points, radius, pitch, diameter).slice(0, 4)
              .flatMap((window) => [patch.points, [...patch.points].reverse()].map((points) => ({ ...window, points })))
            for (const { before, after, points: body } of choices) for (const order of [[0, 1], [1, 0]]) {
              checkpoint()
              if (result.attempts >= maxCandidates) { result.bounded = true; break proposals }
              result.attempts++
              const retained = [pipe(host, before, 'coverage-before'), pipe(host, after, 'coverage-after'), pipe(host, body, 'coverage-patch')]
              if (!patchSpacingFits(retained[2], [...others.filter((p) => p.heating?.pipeRole === 'loop'), ...retained.slice(0, 2)], scale, geometryFor)) { reject('pitch'); continue }
              const grid = localGrid(native, [before.at(-1)!, body[0], body.at(-1)!, after[0]], radius, pitch, checkpoint)
              if (!grid) { reject('local-grid'); continue }
              const heading = (a: Point, b: Point) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y) * grid.width
              const legs = [{ from: before.at(-1)!, to: body[0], start: heading(before.at(-2)!, before.at(-1)!), end: heading(body[0], body[1]) },
                { from: body.at(-1)!, to: after[0], start: heading(body.at(-2)!, body.at(-1)!), end: heading(after[0], after[1]) }]
              const tangent = (head: Point, next: Point, id: string) => pipe(host, [head,
                { x: head.x + (head.x - next.x) / length(head, next) * radius, y: head.y + (head.y - next.y) / length(head, next) * radius }], id)
              const inlets = [tangent(original[0], original[1], 'coverage-inlet-a'), tangent(original.at(-1)!, original.at(-2)!, 'coverage-inlet-b')]
              const joints = new Map(retained.map((p) => [p.id, [geometryFor(p).points[0], geometryFor(p).points.at(-1)!]]))
              const routed: RectShape[] = [], bridges: Point[][] = []
              let valid = true
              for (const n of order) {
                const leg = legs[n], partner = legs[1 - n]
                const ahead = (p: Point, direction: number, sign: number) => Math.abs(direction) === grid.width
                  ? { x: p.x, y: p.y + Math.sign(direction) * radius * sign } : { x: p.x + Math.sign(direction) * radius * sign, y: p.y }
                const pending = routed.length ? [] : [tangent(partner.from, ahead(partner.from, partner.start, -1), 'coverage-pending-a'),
                  tangent(partner.to, ahead(partner.to, partner.end, 1), 'coverage-pending-b')]
                const free = heatingPointClearance([...others, ...retained, ...routed, ...inlets, ...pending], data.diameterMm, scale,
                  { joints, solids: options.obstacles, geometryFor })
                const pointFree = (p: Point) => {
                  const cell = native.index(p)
                  return cell >= 0 && !native.obstacle[cell] && (!native.wall[cell] || Boolean(native.door[cell])) &&
                    (allowedRooms.has(native.room[cell]) || native.room[cell] <= 0 && Boolean(native.door[cell])) && free(p)
                }
                const path = routeHeating(grid, grid.index(leg.from), grid.index(leg.to), { radiusCells: Math.ceil(2 * radius / grid.step),
                  startDirection: leg.start, endDirection: leg.end, preferArcs: true, arcOnly: true, continuousTurns: true,
                  pointFree, permittedWallCells: new Set(), checkpoint })
                if (!path) { valid = false; reject('connector'); break }
                bridges[n] = exact(exact(heatingPathPoints(grid, path), leg.from, true), leg.to, false)
                routed.push(pipe(host, bridges[n], `coverage-bridge-${n}`))
              }
              if (!valid) continue
              const points = simplifyHeatingPath([...before, ...bridges[0].slice(1, -1), ...body, ...bridges[1].slice(1, -1), ...after])
              const candidate = pipe(host, points)
              candidate.heating!.pattern = combineHeatingPatterns([data.pattern, patch.pattern])
              const geometry = geometryFor(candidate)
              if (!samePorts(original, geometry.points)) { reject('ports'); continue }
              if (heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() })) { reject('wall'); continue }
              const updated = result.pipes.map((p) => p === host ? candidate : p)
              if (!totalsFit(updated)) { reject('length'); continue }
              const audit = checkHeatingPlan(updated, [], undefined, options.obstacles, { focusPipeIds: new Set([host.id]), geometryFor,
                stopOnConflict: true, checkpoint })
              if (audit.errors) { reject(`geometry-${audit.issues.find((issue) => issue.severity === 'error')?.code ?? 'unknown'}`); continue }
              const coverage = measureHeatingCoverage(native, updated, scale, settings.spacingMm, settings.edgeMm ?? 100, checkpoint, false).coverage
              const reduction = gapM2(result.coverage) - gapM2(coverage), cellM2 = (native.step * scale / 8000) ** 2
              if (reduction < cellM2 / 2 || coverage.rooms.some((room) => room.gapM2 > (result.coverage.rooms.find((r) => r.key === room.key)?.gapM2 ?? 0) + cellM2 / 2)) { reject('coverage'); continue }
              const acceptedPatch = { circuitId: data.circuitId!, roomKey: box.roomKey, bounds: patchBox,
                gapReductionM2: reduction, addedM: (geometry.length - geometryFor(host).length) * scale / 8000 }
              result.pipes = updated; result.coverage = coverage; result.acceptedPatches.push(acceptedPatch)
              result.uncoveredCells = Math.round(gapM2(coverage) / cellM2)
              if (!result.changedCircuitIds.includes(data.circuitId!)) result.changedCircuitIds.push(data.circuitId!)
              options.onAccepted?.(updated, coverage, acceptedPatch); accepted = true; break proposals
            }
          }
        }
      }
      if (!accepted) break
    }
    if (result.attempts >= maxCandidates && maxCandidates) result.bounded = true
  } catch (error) {
    if (error !== stop) throw error
    result.bounded = true
  }
  return result
}
