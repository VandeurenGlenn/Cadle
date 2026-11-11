import { describeHeatingPlan, HeatingPlanningFailure, type HeatingPlanningDiagnostic } from './heating-diagnostics.js'
import type { Point, RectShape, Shape } from './model/types.js'
import { drawingLengthMetres, drawingUnitsForMetres, type DrawingScale } from './layout/drawing-scale.js'
import { createHeatingPipe, createHeatingScheduleTables, heatingDefaults, heatingManifoldSize, heatingSchedule, heatingRoomScope, combineHeatingPatterns, sanitizeHeatingCircuitSpacing, heatingTableSize, HEATING_TABLE_ROW_HEIGHT, type HeatingScheduleRow } from './heating-plan.js'
import { buildHeatingGrid, heatingCurveWallConflict, heatingSourceRoom, heatingWallAllowed, routeHeating, simplifyHeatingPath, heatingRouteCorridor, heatingSharedDoors, segmentDistance, type HeatingGrid } from './heating-routing.js'
import { shapeBounds } from './model/model.js'
import { heatingDesignLimits, sanitizeHeatingDesign, MAX_HEATING_CIRCUITS, DEFAULT_HEATING_CAPACITY, type HeatingDesignInputs } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import type { HeatingPlanningProgress } from './heating-planner-protocol.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingRoomKey, measureHeatingCoverage, heatingCoverageSignature } from './heating-coverage.js'
import { reserveHeatingAccess, shareSmallHeatingRooms } from './heating-zones.js'
import { heatingConnectionZone } from './heating-connection-zone.js'
import { allocateHeatingCircuits } from './heating-allocation.js'
import { routeHeatingBundle, heatingAccessCapacity } from './heating-bundle.js'
import { heatingSpliceCandidates, heatingReopenCandidates } from './heating-splice.js'
import { heatingFeedLanes } from './heating-feed-lanes.js'
import { pruneRedundantHeatingFields, deferHeatingFeedRemnants } from './heating-field-pruning.js'
import { orientHeatingFields } from './heating-field-orientation.js'
import { heatingFallbackPassage } from './heating-wall-policy.js'
import { heatingAccessDistances } from './heating-access-distances.js'
import { heatingObstacleBounds } from './heating-openings.js'

import { buildHeatingSpiralFields, heatingRectangleVariants, openHeatingTurns, type HeatingSpiralField } from './heating-spiral.js'
export { openHeatingTurns } from './heating-spiral.js'

/** Replace a short square sideways step with a gradual transition, where the floor is free. */
export const softenHeatingJogs = (points: Point[], radius: number, free: (p: Point) => boolean, step: number): Point[] => {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1], d = points[i + 2]
    if (a && c && d) {
      const before = Math.hypot(b.x - a.x, b.y - a.y), gap = Math.hypot(c.x - b.x, c.y - b.y), after = Math.hypot(d.x - c.x, d.y - c.y)
      const reach = Math.min(2 * radius, before / 3, after / 3)
      const tangent = radius * Math.tan(Math.atan2(gap, 2 * reach) / 2)
      const ux = (b.x - a.x) / before, uy = (b.y - a.y) / before
      if (gap > 0 && gap < 2 * radius && reach >= tangent && Math.hypot(2 * reach, gap) >= 2 * tangent && (d.x - c.x) * ux + (d.y - c.y) * uy > 0 &&
        Math.abs((c.x - b.x) * ux + (c.y - b.y) * uy) < 1e-7) {
        const from = { x: b.x - ux * reach, y: b.y - uy * reach }, to = { x: c.x + ux * reach, y: c.y + uy * reach }
        const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (step / 2))
        if (Array.from({ length: n + 1 }, (_, j) => ({ x: from.x + (to.x - from.x) * j / n, y: from.y + (to.y - from.y) * j / n })).every(free)) {
          result.push(from, to); i++; continue
        }
      }
    }
    result.push(points[i])
  }
  return result
}

export type AutomaticHeatingSettings = { connectionMode?: 'ports' | 'zone'; diameterMm: number; spacingMm: number; edgeMm?: number; capacity?: number; circuitSpacingMm?: Record<string, number>; shareSmallRooms?: boolean; heatSourceRoom?: boolean; manifoldSide?: 'auto' | 'top' | 'bottom'; excludedRoomKeys?: string[]; design?: HeatingDesignInputs }
type RoomProposal = { jobs: CircuitJob[]; initialFields: number; finished: boolean; score: number[] }
type HeatingWorkBudget = { nativeRoom?: Int32Array; nativeRoomAreas?: ReadonlyMap<number, number>; leadAllowances?: Record<string, number>; leadAllowanceM?: number; lengthRetries?: Map<string, number>; requiredGroups?: ReadonlySet<number>; leadDistances?: Int32Array; wallPassage?: ReturnType<typeof heatingFallbackPassage>; wallFallbackTried?: boolean; forbiddenGroups?: ReadonlySet<number>; patternFallbackRooms?: Set<string>; accessTargets?: Point[]; onConnectionCandidate?: (parts: RectShape[], coils: RectShape[], jobs?: CircuitJob[]) => void; connectionZone?: ReturnType<typeof heatingConnectionZone>; roomTargets?: Map<string, number>; suggestedMaxM?: number; targetCount?: number; reflowCircuit?: RectShape[]; focusCells?: Set<number>; lastRouteFailure?: { reason: string; point: Point; detail?: string }; onRouteFailure?: (reason: string, point: Point, detail?: string) => void; diagnostics?: HeatingPlanningDiagnostic; roomCandidates?: Map<string, RoomProposal[]>; reserveAccess?: boolean; lastSplitVariant?: string; loopFactors?: Record<string, number>; preserved?: RectShape[]; existingManifold?: RectShape; onlyRoom?: string; routes: number; sourceScene?: readonly Shape[]; grid?: HeatingGrid; deadline?: number; roomTimeMs?: number; roomDeadline?: number; onProgress?: (value: HeatingPlanningProgress) => void }
const checkHeatingDeadline = (budget: HeatingWorkBudget) => {
  if (budget.deadline !== undefined && Date.now() >= budget.deadline) throw new Error('De planner heeft binnen de rekentijd geen geldige indeling gevonden. Het bestaande plan is behouden.')
}
type CircuitJob = HeatingSpiralField
type HeatingSearch = { layouts: Set<string>; lastFailure?: string }
export const MAX_HEATING_LAYOUTS = 8
// Keep tube clearance between neighbouring supply/return pairs.
const automaticManifoldSize = heatingManifoldSize
export const heatingPlanScore = (result: AutomaticHeatingResult): number[] => {
  const owner = result.shapes.find((shape) => shape.heating?.kind === 'manifold')?.heating
  const connections = result.rows.reduce((sum, row) => sum + row.supplyM + row.returnM, 0)
  const mean = result.rows.reduce((sum, row) => sum + row.totalM, 0) / Math.max(1, result.rows.length)
  const spread = result.rows.reduce((sum, row) => sum + (row.totalM - mean) ** 2, 0)
  const gaps = owner?.coverage?.rooms.reduce((sum, room) => sum + room.gapM2, 0) ?? 0
  const area = owner?.coverage?.rooms.reduce((sum, room) => sum + room.eligibleM2, 0) ?? 1
  return [owner?.audit?.errors ?? 0, gaps / Math.max(.01, area) > .05 ? 1 : 0, connections, result.wallCrossings, spread, gaps]
}
const isBetterPlan = (a: AutomaticHeatingResult, b: AutomaticHeatingResult) => {
  const first = heatingPlanScore(a), second = heatingPlanScore(b)
  for (let i = 0; i < first.length; i++) {
    if (i === 2) {
      const rank = (result: AutomaticHeatingResult) => { const pattern = result.shapes.find((s) => s.heating?.kind === 'manifold')?.heating?.pattern; return pattern === 'meander' ? 2 : pattern === 'mixed' ? 1 : 0 }
      if (rank(a) !== rank(b)) return rank(a) < rank(b)
    }
    if (Math.abs(first[i] - second[i]) > 1e-6) return first[i] < second[i]
  }
  return false
}

// Collinear grid cells are implied by their endpoints. This exact key avoids
// retaining large raster paths and never relies on a possibly colliding hash.
const layoutKey = (jobs: CircuitJob[]) => jobs.map(({ cells, points }) => {
  if (points) { const forward = JSON.stringify(points), reverse = JSON.stringify([...points].reverse()); return `p:${forward < reverse ? forward : reverse}` }
  const vertices = cells.filter((cell, i) => !i || i === cells.length - 1 || cell - cells[i - 1] !== cells[i + 1] - cell)
  const forward = vertices.join(','), reverse = [...vertices].reverse().join(',')
  return forward < reverse ? forward : reverse
}).join(';')

/** Keep a room's circuits together. Distance controls planning order, while angular
 * order still controls manifold ports to avoid crossing the connection bundle. */
const roomsFarthestFirst = (grid: HeatingGrid, jobs: CircuitJob[], position: Point) => {
  const rooms = new Map<number, { jobs: CircuitJob[]; minX: number; maxX: number; minY: number; maxY: number }>()
  for (const job of jobs) {
    const id = grid.room[job.cells[0]], room = rooms.get(id) ?? { jobs: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    room.jobs.push(job)
    for (const cell of job.cells) {
      const p = grid.point(cell)
      room.minX = Math.min(room.minX, p.x); room.maxX = Math.max(room.maxX, p.x)
      room.minY = Math.min(room.minY, p.y); room.maxY = Math.max(room.maxY, p.y)
    }
    rooms.set(id, room)
  }
  const distance = (room: { minX: number; maxX: number; minY: number; maxY: number }) =>
    Math.abs((room.minX + room.maxX) / 2 - position.x) + Math.abs((room.minY + room.maxY) / 2 - position.y)
  return [...rooms.values()].sort((a, b) => distance(b) - distance(a)).map((room) => room.jobs)
}


/** Join adjacent leg fields in series before assigning manifold ports. This preserves
 * obstacle-free strips without turning every strip into a separate hydraulic circuit. */
export const mergeHeatingJobs = (grid: HeatingGrid, jobs: CircuitJob[], occupied: Set<number>, settings: AutomaticHeatingSettings, scale: DrawingScale, position: Point, budgetFactor: number, variant: number, budget: HeatingWorkBudget) => {
  // Smaller trial fields do not change the actual per-circuit length limit.
  budgetFactor = 1
  const sharedZone = jobs.some((job) => (job.roomMembers?.length ?? 0) > 1)
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
  const roomTimeout = new Error('Room merge budget exhausted')
  let lastProgress = 0, nextCoil = 0, geometryChecks = 6000
  const roomEnd = budget.roomDeadline ?? Date.now() + 2500
  const checkpoint = () => {
    checkHeatingDeadline(budget)
    const now = Date.now()
    if (now >= roomEnd) throw roomTimeout
    if (now - lastProgress >= 100) { budget.onProgress?.({ phase: 'circuits' }); lastProgress = now }
  }
  const worldPaths = new WeakMap<number[], Point[]>()
  const shape = (cells: number[]) => {
    const id = ++nextCoil
    return createHeatingPipe(`merge-${id}`, openHeatingTurns(worldPaths.get(cells) ?? simplifyHeatingPath(cells.map(grid.point)), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
      { ...heatingDefaults('pipe', scale), ...settings, automatic: true, circuitId: `VV${id}`, pipeRole: 'loop' })
  }
  const geometries = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (coil: RectShape) => {
    let value = geometries.get(coil)
    if (!value) { value = heatingPipeGeometry(coil); geometries.set(coil, value) }
    return value
  }
  const cached = new WeakMap<CircuitJob, RectShape>()
  const coilFor = (job: CircuitJob) => {
    let value = cached.get(job)
    if (!value) { if (job.points) worldPaths.set(job.cells, job.points); value = shape(job.cells); cached.set(job, value) }
    return value
  }
  const manifoldSize = automaticManifoldSize(settings.capacity ?? MAX_HEATING_CIRCUITS, scale, grid.step)
  const leadMinimumM = (p: Point) => {
    if (budget.leadDistances) {
      const cell = grid.index(p), distance = cell >= 0 ? budget.leadDistances[cell] : -1
      return distance < 0 ? Infinity : drawingLengthMetres(distance * grid.step, scale) + limits.minBendRadiusMm / 1000 + (budget.leadAllowanceM ?? 0) / 2
    }
    if (budget.connectionZone) {
      const b = budget.connectionZone.bounds
      return drawingLengthMetres(Math.max(0, b.x - p.x, p.x - b.x - b.width) + Math.max(0, b.y - p.y, p.y - b.y - b.height), scale)
    }
    const x = Math.max(0, position.x - grid.step - p.x, p.x - position.x - manifoldSize.width - grid.step)
    const y = settings.shareSmallRooms ? Math.abs(p.y - position.y - (settings.manifoldSide === 'top' ? 0 : manifoldSize.height)) : Math.max(0, position.y - grid.step - p.y, p.y - position.y - manifoldSize.height - grid.step)
    return drawingLengthMetres(settings.shareSmallRooms ? x + y : Math.hypot(x, y), scale)
  }
  const exitCache = new WeakMap<RectShape, RectShape[]>()
  const exitsFor = (coil: RectShape) => {
    let value = exitCache.get(coil)
    if (value) return value
    const points = geometryFor(coil).localPoints
    const escape = Math.ceil(radius / grid.step) * grid.step
    value = [0, 1].map((end) => {
      const p = end ? points.at(-1)! : points[0], near = end ? points.at(-2)! : points[1], length = Math.hypot(p.x - near.x, p.y - near.y)
      const dx = (p.x - near.x) / length, dy = (p.y - near.y) / length, room = grid.room[grid.index(p)]
      let reach = escape
      // A merge must leave both remaining ends connected to the room boundary.
      // A short R80 stub can miss a joining U-turn just beyond it that seals the
      // two ends behind the coil. Validate the entire approach before merging.
      for (let n = 1; n <= Math.max(grid.width, grid.height); n++) {
        const cell = grid.index({ x: p.x + dx * n * grid.step, y: p.y + dy * n * grid.step })
        if (cell < 0 || grid.room[cell] !== room || grid.wall[cell]) { reach = Math.max(escape, n * grid.step); break }
      }
      return createHeatingPipe(`exit-${coil.id}-${end}`, [p, { x: p.x + dx * reach, y: p.y + dy * reach }],
        { ...coil.heating!, pipeRole: end ? 'return' : 'supply' })
    })
    exitCache.set(coil, value); return value
  }
  const entryCache = new WeakMap<CircuitJob, number[][]>()
  const maxMerges = jobs.length - 1
  const rasterCache = new WeakMap<RectShape, Set<number>>()
  const physicalCells = (coil: RectShape) => {
    const cached = rasterCache.get(coil)
    if (cached) return cached
    const cells = new Set<number>(), clearance = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
    for (const piece of geometryFor(coil).pieces) {
      const minX = Math.max(0, Math.floor((Math.min(piece.a.x, piece.b.x) - clearance - grid.origin.x) / grid.step)), maxX = Math.min(grid.width - 1, Math.ceil((Math.max(piece.a.x, piece.b.x) + clearance - grid.origin.x) / grid.step))
      const minY = Math.max(0, Math.floor((Math.min(piece.a.y, piece.b.y) - clearance - grid.origin.y) / grid.step)), maxY = Math.min(grid.height - 1, Math.ceil((Math.max(piece.a.y, piece.b.y) + clearance - grid.origin.y) / grid.step))
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const cell = y * grid.width + x
        if (segmentDistance(grid.point(cell), piece.a, piece.b) < clearance - 1e-6) cells.add(cell)
      }
    }
    rasterCache.set(coil, cells); return cells
  }
  const visited = new Uint32Array(grid.wall.length), queue = new Int32Array(grid.wall.length)
  let generation = 0
  const mergeWallOptions = { allowWalls: true, permittedWallCells: budget.wallPassage?.cells ?? new Set<number>() }
  const sourceTargets = settings.connectionMode === 'zone' && budget.connectionZone ? new Set(budget.connectionZone.stubs.map((stub) => stub.at(-1)!)) : undefined
  const steps = new Uint16Array(grid.wall.length)
  type SourceAccess = { reachable: boolean[]; totalM: number; capacity: number }
  let previousAccess: Map<CircuitJob, SourceAccess> | undefined
  const sourceAccess = (coils: RectShape[]): SourceAccess[] => {
    const blocked = new Set<number>()
    for (const coil of coils) for (const cell of physicalCells(coil)) blocked.add(cell)
    const paths = coils.map((coil) => {
      const points = geometryFor(coil).points
      return [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]].map(([p, q]) => {
        const length = Math.hypot(p.x - q.x, p.y - q.y), path: number[] = []
        for (let n = 0; n <= Math.ceil(radius / grid.step); n++) path.push(grid.index({ x: p.x + (p.x - q.x) / length * n * grid.step, y: p.y + (p.y - q.y) / length * n * grid.step }))
        return path
      })
    })
    const valid = paths.map((pair) => pair.map((path) => path.every((cell, i) => cell >= 0 && (sourceTargets?.has(cell) || !grid.obstacle[cell]) && heatingWallAllowed(grid, cell, mergeWallOptions) && (!i || !blocked.has(cell)))))
    for (const pair of paths) for (const path of pair) for (const cell of path.slice(0, -1)) if (cell >= 0) blocked.add(cell)
    const stamp = ++generation
    let read = 0, write = 0
    for (const cell of sourceTargets ?? []) if (!blocked.has(cell) && visited[cell] !== stamp) { visited[cell] = stamp; steps[cell] = 0; queue[write++] = cell }
    while (read < write) {
      if (read % 2048 === 0) checkpoint()
      const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next < 0 || visited[next] === stamp || grid.obstacle[next] || !heatingWallAllowed(grid, next, mergeWallOptions) || blocked.has(next)) continue
        visited[next] = stamp; steps[next] = steps[cell] + 1; queue[write++] = next
      }
    }
    const escape = Math.ceil(radius / grid.step) * grid.step
    return coils.map((coil, index) => {
      const roots = paths[index].map((path) => path.at(-1)!)
      const reachable = roots.map((root, end) => valid[index][end] && root >= 0 && visited[root] === stamp)
      const capacity = reachable.every(Boolean) && sourceTargets ? heatingAccessCapacity(grid, [...sourceTargets], roots, blocked, { ...mergeWallOptions, allowSourceObstacles: true, checkpoint }) : 0
      return { reachable, capacity, totalM: reachable.every(Boolean) ? drawingLengthMetres(geometryFor(coil).length + 2 * escape + roots.reduce((sum, root) => sum + steps[root] * grid.step, 0), scale) + limits.allowanceM : Infinity }
    })
  }
  const canReachBoundary = (candidate: RectShape, removed: CircuitJob[]) => {
    const blocked = new Set(physicalCells(candidate))
    for (const job of jobs) if (!removed.includes(job)) for (const cell of physicalCells(coilFor(job))) blocked.add(cell)
    if (sourceTargets) {
      if (!previousAccess) {
        const snapshot = sourceAccess(jobs.map(coilFor))
        previousAccess = new Map(jobs.map((job, index) => [job, snapshot[index]]))
      }
      const remaining = jobs.filter((job) => !removed.includes(job)), access = sourceAccess([candidate, ...remaining.map(coilFor)])
      if (!access[0].reachable.every(Boolean) || access[0].capacity < 2 || access[0].totalM > limits.maxCircuitLengthM) return false
      // An unfinished field is allowed to be repaired by a later join. Preserve
      // every approach that was already usable instead of requiring all raw
      // fields to be solved before the first merge can succeed.
      return remaining.every((job, index) => {
        const before = previousAccess!.get(job)!, after = access[index + 1]
        return after.capacity >= before.capacity && before.reachable.every((required, end) => !required || after.reachable[end]) &&
          (before.totalM > limits.maxCircuitLengthM || after.totalM <= limits.maxCircuitLengthM)
      })
    }
    const points = geometryFor(candidate).points, escape = Math.ceil(radius / grid.step) * grid.step
    let leadM = 0
    for (const [p, near] of [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]]) {
      const length = Math.hypot(p.x - near.x, p.y - near.y), root = grid.index({ x: p.x + (p.x - near.x) / length * escape, y: p.y + (p.y - near.y) / length * escape })
      if (root < 0 || grid.obstacle[root] && !sourceTargets?.has(root) || blocked.has(root)) return false
      const room = grid.room[grid.index(p)]
      if (!sourceTargets && grid.room[root] !== room) continue
      if (sourceTargets?.has(root)) { leadM += drawingLengthMetres(escape, scale); continue }
      let read = 0, write = 1, accessible = false
      queue[0] = root; visited[root] = ++generation; steps[root] = 0
      while (read < write) {
        if (read % 2048 === 0) checkpoint()
        const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
        for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
          if (next < 0 || blocked.has(next)) continue
          if (sourceTargets?.has(next)) { leadM += drawingLengthMetres(escape + (steps[cell] + 1) * grid.step, scale); accessible = true; break }
          if (grid.obstacle[next] || !heatingWallAllowed(grid, next, mergeWallOptions)) continue
          if (!sourceTargets && (grid.room[next] !== room || grid.wall[next])) { accessible = true; break }
          if (visited[next] !== generation) { visited[next] = generation; steps[next] = steps[cell] + 1; queue[write++] = next }
        }
        if (accessible) break
      }
      if (!accessible) return false
    }
    return drawingLengthMetres(geometryFor(candidate).length, scale) + leadM + limits.allowanceM <= limits.maxCircuitLengthM * budgetFactor
  }
  const groupAllowed = (mask: number) => ![...budget.requiredGroups ?? []].some((group) => (mask & group) !== 0 && (mask & group) !== group && (mask & ~group) !== 0)
  const acceptJoin = (cells: number[], ai: number, bi: number, interior = false, points?: Point[]) => {
    if (points) worldPaths.set(cells, points)
    const sourceMask = (jobs[ai].sourceMask ?? 0) | (jobs[bi].sourceMask ?? 0)
    if (!groupAllowed(sourceMask) || sourceMask && budget.forbiddenGroups?.has(sourceMask)) return false
    const candidate = shape(cells), flexible = settings.connectionMode === 'zone' || sharedZone || interior
    const p = grid.point(cells[0]), q = grid.point(cells.at(-1)!), leadM = leadMinimumM(p) + leadMinimumM(q)
    if (drawingLengthMetres(geometryFor(candidate).length, scale) + leadM + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) return false
    const geometry = geometryFor(candidate)
    if (geometry.pieces.some((piece) => {
      const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / grid.step))
      return Array.from({ length: n + 1 }, (_, j) => grid.index({ x: piece.a.x + (piece.b.x - piece.a.x) * j / n, y: piece.a.y + (piece.b.y - piece.a.y) * j / n }))
        .some((i) => i < 0 || grid.wall[i] || grid.obstacle[i] || grid.feedCorridor?.[i] || grid.room[i] !== grid.room[jobs[ai].cells[0]])
    })) return false
    const others = jobs.flatMap((job, i) => i === ai || i === bi || grid.room[job.cells[0]] !== grid.room[jobs[ai].cells[0]] ? [] : [coilFor(job)])
    const shortExit = (exit: RectShape) => {
      const [p, end] = geometryFor(exit).points, length = Math.hypot(end.x - p.x, end.y - p.y)
      let reach = Math.min(length, Math.ceil(radius / grid.step) * grid.step)
      const native = budget.nativeRoom?.[grid.index(p)], area = native === undefined ? Infinity : budget.nativeRoomAreas?.get(native) ?? Infinity
      if (native !== undefined && area <= 12) for (let n = 1; n <= Math.max(grid.width, grid.height); n++) {
        const point = { x: p.x + (end.x - p.x) / length * n * grid.step, y: p.y + (end.y - p.y) / length * n * grid.step }, cell = grid.index(point)
        if (cell < 0 || budget.nativeRoom![cell] !== native) {
          // A shared-zone join must not curl around the other inlet just past
          // its short tangent. Keep a small room's actual doorway approach open.
          if (cell >= 0 && grid.door[cell]) reach = Math.max(reach, n * grid.step + radius)
          break
        }
      }
      return createHeatingPipe(exit.id, [p, { x: p.x + (end.x - p.x) / length * reach, y: p.y + (end.y - p.y) / length * reach }], exit.heating!)
    }
    const candidateExits = flexible ? exitsFor(candidate).map(shortExit) : exitsFor(candidate)
    const exits = [...candidateExits, ...others.flatMap((coil) => flexible ? exitsFor(coil).map(shortExit) : exitsFor(coil))]
    // Only the new coil and its escape tails changed. Keep their self-checks
    // and comparisons with every other coil; do not re-check unchanged pairs.
    if (--geometryChecks < 0) throw roomTimeout
    const audit = checkHeatingPlan([candidate, ...others, ...exits], [], settings.design, [], {
      focusPipeIds: new Set([candidate.id, ...candidateExits.map((exit) => exit.id)]), checkpoint, geometryFor, stopOnConflict: true
    })
    const conflict = audit.issues.find((issue) => issue.severity === 'error' && (issue.code === 'collision' || issue.code === 'bend'))
    if (conflict) return false
    if (flexible && !canReachBoundary(candidate, [jobs[ai], jobs[bi]])) return false
    jobs[ai] = { ...jobs[ai], rectangular: false, cells, points: worldPaths.get(cells), sourceMask, pattern: combineHeatingPatterns([jobs[ai].pattern, jobs[bi].pattern]), areaM2: jobs[ai].areaM2 + jobs[bi].areaM2, spacingMinMm: Math.min(jobs[ai].spacingMinMm, jobs[bi].spacingMinMm), spacingMaxMm: Math.max(jobs[ai].spacingMaxMm, jobs[bi].spacingMaxMm) }
    jobs.splice(bi, 1)
    previousAccess = undefined
    for (const cell of cells) occupied.add(cell)
    return true
  }
  try {
    for (let pass = 0; pass < maxMerges; pass++) {
      checkpoint()
      if (budget.targetCount && jobs.length <= budget.targetCount) break
      const physicalOccupied = new Set<number>()
      for (const job of jobs) for (const cell of physicalCells(coilFor(job))) physicalOccupied.add(cell)
      const choices: { a: number; b: number; reverseA: boolean; reverseB: boolean; distance: number }[] = []
      for (let a = 0; a < jobs.length; a++) for (let b = a + 1; b < jobs.length; b++) {
        checkpoint()
        if (!groupAllowed((jobs[a].sourceMask ?? 0) | (jobs[b].sourceMask ?? 0))) continue
        if (jobs[a].roomName !== jobs[b].roomName || grid.room[jobs[a].cells[0]] !== grid.room[jobs[b].cells[0]]) continue
        const loopM = drawingLengthMetres(geometryFor(coilFor(jobs[a])).length + geometryFor(coilFor(jobs[b])).length, scale)
        for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
          const from = grid.point(reverseA ? jobs[a].cells[0] : jobs[a].cells.at(-1)!), to = grid.point(reverseB ? jobs[b].cells.at(-1)! : jobs[b].cells[0])
          const inlet = grid.point(reverseA ? jobs[a].cells.at(-1)! : jobs[a].cells[0]), outlet = grid.point(reverseB ? jobs[b].cells[0] : jobs[b].cells.at(-1)!)
          // Bound each orientation using its actual exposed ends, rather than
          // assuming that both manifold leads end at the first point of field A.
          // Allow the fillets to shorten the two new corners by at most 4 radii.
          const connectorM = Math.max(0, drawingLengthMetres(Math.hypot(from.x - to.x, from.y - to.y) - 4 * radius, scale))
          if (loopM + connectorM + leadMinimumM(inlet) + leadMinimumM(outlet) + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) continue
          choices.push({ a, b, reverseA, reverseB, distance: Math.abs(from.x - to.x) + Math.abs(from.y - to.y) })
        }
      }
      choices.sort((a, b) => variant === 1 ? b.distance - a.distance : a.distance - b.distance)
      const lengths = jobs.map((job) => drawingLengthMetres(geometryFor(coilFor(job)).length, scale))
      if (variant === 2) choices.sort((a, b) => lengths[b.a] + lengths[b.b] - lengths[a.a] - lengths[a.b] || a.distance - b.distance)
      if (variant === 3) choices.sort((a, b) => Math.max(lengths[b.a], lengths[b.b]) - Math.max(lengths[a.a], lengths[a.b]) || lengths[b.a] + lengths[b.b] - lengths[a.a] - lengths[a.b] || a.distance - b.distance)
      let merged = false
      if (settings.shareSmallRooms && budget.routes > 0) {
        const pitch = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
        const pairs = jobs.flatMap((_, ai) => jobs.flatMap((_, bi) => ai !== bi && groupAllowed((jobs[ai].sourceMask ?? 0) | (jobs[bi].sourceMask ?? 0)) && !jobs[ai].points && !jobs[bi].points && grid.room[jobs[ai].cells[0]] === grid.room[jobs[bi].cells[0]] ? [{ ai, bi }] : []))
        if (variant >= 2) pairs.sort((a, b) => lengths[b.ai] + lengths[b.bi] - lengths[a.ai] - lengths[a.bi])
        spliceSearch: for (const { ai, bi } of pairs) {
          const length = drawingLengthMetres(geometryFor(coilFor(jobs[ai])).length + geometryFor(coilFor(jobs[bi])).length, scale)
          const lead = leadMinimumM(grid.point(jobs[ai].cells[0])) + leadMinimumM(grid.point(jobs[ai].cells.at(-1)!))
          if (length + lead + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor + 1) continue
          for (const cells of heatingSpliceCandidates(jobs[ai].cells, jobs[bi].cells, grid, pitch, radius / grid.step, checkpoint, Math.ceil(drawingUnitsForMetres(3, scale) / grid.step), jobs[bi].rectangular === true)) {
            checkpoint()
            if (acceptJoin(cells, ai, bi, true)) { merged = true; break spliceSearch }
          }
        }
      }
      if (merged) continue
      for (const choice of choices) {
        const a = choice.reverseA ? [...jobs[choice.a].cells].reverse() : jobs[choice.a].cells,
          b = choice.reverseB ? [...jobs[choice.b].cells].reverse() : jobs[choice.b].cells
        const mergeBlocked = new Set(sharedZone || settings.connectionMode === 'zone' ? physicalOccupied : occupied), reach = Math.ceil(radius / grid.step)
        for (const [j, job] of jobs.entries()) for (const endpoint of [0, 1]) {
          if ((j === choice.a && endpoint === (choice.reverseA ? 0 : 1)) || (j === choice.b && endpoint === (choice.reverseB ? 1 : 0))) continue
          const cells = job.cells, root = endpoint ? cells.at(-1)! : cells[0], direction = endpoint ? root - cells.at(-2)! : root - cells[1]
          for (let n = 1; n <= reach; n++) mergeBlocked.add(root + direction * n)
        }
        if (settings.connectionMode === 'zone') {
          const aPoints = jobs[choice.a].points ?? simplifyHeatingPath(jobs[choice.a].cells.map(grid.point))
          const bPoints = jobs[choice.b].points ?? simplifyHeatingPath(jobs[choice.b].cells.map(grid.point))
          const left = choice.reverseA ? [...aPoints].reverse() : aPoints, right = choice.reverseB ? [...bPoints].reverse() : bPoints
          const trimPairs = [[0, 0], [radius / 2, 0], [0, radius / 2], [radius / 2, radius / 2], [radius, 0], [0, radius], [radius, radius], [2 * radius, 0], [0, 2 * radius], [2 * radius, 2 * radius]]
          for (const [trimA, trimB] of trimPairs) {
            checkpoint()
            const p0 = left.at(-1)!, before = left.at(-2)!, q0 = right[0], after = right[1]
            const uLength = Math.hypot(p0.x - before.x, p0.y - before.y), vLength = Math.hypot(after.x - q0.x, after.y - q0.y)
            if (uLength - trimA < radius || vLength - trimB < radius) continue
            const u = { x: (p0.x - before.x) / uLength, y: (p0.y - before.y) / uLength }, v = { x: (after.x - q0.x) / vLength, y: (after.y - q0.y) / vLength }
            const p = { x: p0.x - u.x * trimA, y: p0.y - u.y * trimA }, q = { x: q0.x + v.x * trimB, y: q0.y + v.y * trimB }
            const along = (q.x - p.x) * u.x + (q.y - p.y) * u.y, dot = u.x * v.x + u.y * v.y, bridges: Point[][] = []
            if (dot > .999 && along > 0) for (const fraction of [.25, 1 / 3]) bridges.push([p, { x: p.x + u.x * along * fraction, y: p.y + u.y * along * fraction }, { x: q.x - v.x * along * fraction, y: q.y - v.y * along * fraction }, q])
            else if (dot < -.999) for (const extra of [radius, 2 * radius, 3 * radius]) {
              const reach = Math.max(0, along) + extra
              bridges.push([p, { x: p.x + u.x * reach, y: p.y + u.y * reach }, { x: q.x - v.x * (reach - along), y: q.y - v.y * (reach - along) }, q])
            }
            else if (Math.abs(dot) < .001) {
              const corner = Math.abs(u.x) > .5 ? { x: q.x, y: p.y } : { x: p.x, y: q.y }
              if ((corner.x - p.x) * u.x + (corner.y - p.y) * u.y >= 0 && (q.x - corner.x) * v.x + (q.y - corner.y) * v.y >= 0) bridges.push([p, corner, q])
            }
            for (const bridge of bridges) {
              const points = [...left.slice(0, -1), ...bridge, ...right.slice(1)].filter((point, i, all) => !i || i === all.length - 1 || Math.abs((point.x - all[i - 1].x) * (all[i + 1].y - point.y) - (point.y - all[i - 1].y) * (all[i + 1].x - point.x)) > 1e-7)
              const cells = [grid.index(points[0])]
              for (let i = 1; i < points.length; i++) {
                const p = points[i - 1], q = points[i], count = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (grid.step / 2)))
                for (let n = 1; n <= count; n++) {
                  const end = grid.index({ x: p.x + (q.x - p.x) * n / count, y: p.y + (q.y - p.y) * n / count })
                  if (end < 0) break
                  let cell = cells.at(-1)!
                  while (cell % grid.width !== end % grid.width) { cell += Math.sign(end % grid.width - cell % grid.width); cells.push(cell) }
                  while (cell !== end) { cell += Math.sign(end - cell) * grid.width; cells.push(cell) }
                }
              }
              const continuous = jobs[choice.a].points || jobs[choice.b].points || points.some((point, i) => {
                const snapped = grid.point(grid.index(point))
                return Math.hypot(snapped.x - point.x, snapped.y - point.y) > 1e-6 || i > 0 && Math.abs(point.x - points[i - 1].x) > 1e-6 && Math.abs(point.y - points[i - 1].y) > 1e-6
              })
              if (acceptJoin(cells, choice.a, choice.b, true, continuous ? points : undefined)) { merged = true; break }
            }
            if (merged) break
          }
          if (merged) break
        }
        const bridges = function* () {
          const start = grid.point(a.at(-1)!), end = grid.point(b[0])
          for (const corner of sharedZone ? [{ x: end.x, y: start.y }, { x: start.x, y: end.y }] : []) {
            const vertices = [a.at(-1)!, grid.index(corner), b[0]], path = [vertices[0]]
            let valid = true
            for (const target of vertices.slice(1)) {
              const root = path.at(-1)!
              if (target === root) continue
              const step = root % grid.width === target % grid.width ? Math.sign(target - root) * grid.width : Math.sign(target - root)
              const count = (target - root) / step
              if (!Number.isInteger(count) || count < 0 || count > grid.wall.length) { valid = false; break }
              for (let n = 1; n <= count; n++) {
                const cell = root + step * n
                if (grid.room[cell] !== grid.room[a[0]] || grid.wall[cell] || grid.obstacle[cell] || (cell !== b[0] && mergeBlocked.has(cell))) { valid = false; break }
                path.push(cell)
              }
              if (!valid) break
            }
            if (valid) yield path
          }
          checkpoint()
          if (budget.routes <= 0) return
          budget.routes--
          const path = routeHeating(grid, a.at(-1)!, b[0], { roomId: grid.room[a[0]], occupied: mergeBlocked, radiusCells: Math.ceil(2 * radius / grid.step),
            startDirection: a.at(-1)! - a.at(-2)!, endDirection: b[1] - b[0], checkpoint })
          if (path) yield path
        }
        for (const connection of bridges()) {
          const cells = [...a, ...connection.slice(1), ...b.slice(1)]
          const points = jobs[choice.a].points || jobs[choice.b].points ? [
            ...(choice.reverseA ? [...(jobs[choice.a].points ?? simplifyHeatingPath(jobs[choice.a].cells.map(grid.point)))].reverse() : jobs[choice.a].points ?? simplifyHeatingPath(jobs[choice.a].cells.map(grid.point))).slice(0, -1),
            ...simplifyHeatingPath(connection.map(grid.point)),
            ...(choice.reverseB ? [...(jobs[choice.b].points ?? simplifyHeatingPath(jobs[choice.b].cells.map(grid.point)))].reverse() : jobs[choice.b].points ?? simplifyHeatingPath(jobs[choice.b].cells.map(grid.point))).slice(1)
          ] : undefined
          if (!acceptJoin(cells, choice.a, choice.b, false, points)) continue
          merged = true; break
        }
        if (merged) break
      }
      if (merged) continue
      // A fixed inlet can face away from the neighbouring field. Open a window
      // on the facing outer run before attempting a series connection; moving
      // it only after all merging was finished made viable joins unreachable.
      if ((sharedZone || settings.connectionMode === 'zone') && variant >= 2 && budget.routes > 0) {
        const pitch = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
        const pairs: { a: number; b: number; distance: number }[] = []
        const centre = (job: CircuitJob) => {
          const points = geometryFor(coilFor(job)).points
          return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length }
        }
        for (let a = 0; a < jobs.length; a++) for (let b = a + 1; b < jobs.length; b++) {
          if (!groupAllowed((jobs[a].sourceMask ?? 0) | (jobs[b].sourceMask ?? 0))) continue
          if (jobs[a].points || jobs[b].points || grid.room[jobs[a].cells[0]] !== grid.room[jobs[b].cells[0]]) continue
          const minimum = drawingLengthMetres(geometryFor(coilFor(jobs[a])).length + geometryFor(coilFor(jobs[b])).length, scale)
          const leastLead = (index: number) => Math.min(...geometryFor(coilFor(jobs[index])).points.map(leadMinimumM))
          if (minimum + leastLead(a) + leastLead(b) + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) continue
          const p = centre(jobs[a]), q = centre(jobs[b])
          pairs.push({ a, b, distance: Math.abs(p.x - q.x) + Math.abs(p.y - q.y) })
        }
        pairs.sort((a, b) => a.distance - b.distance)
        relocated: for (const pair of pairs.slice(0, 6)) {
          const variants = (index: number, toward: Point) => {
            const job = jobs[index]
            let rectangles = entryCache.get(job)
            if (!rectangles) { rectangles = heatingRectangleVariants(job, grid, settings, scale, checkpoint); entryCache.set(job, rectangles) }
            return [job.cells, ...rectangles, ...Array.from(heatingReopenCandidates(job.cells, grid, pitch, radius / grid.step, toward)).slice(0, 2)]
              .flatMap((cells) => [cells, [...cells].reverse()])
          }
          const as = variants(pair.a, centre(jobs[pair.b])), bs = variants(pair.b, centre(jobs[pair.a]))
          const options = as.flatMap((a) => bs.map((b) => ({ a, b, distance: Math.abs(grid.point(a.at(-1)!).x - grid.point(b[0]).x) + Math.abs(grid.point(a.at(-1)!).y - grid.point(b[0]).y) })))
            .sort((a, b) => a.distance - b.distance)
          for (const { a, b, distance } of options.slice(0, 24)) {
            checkpoint()
            const lengths = drawingLengthMetres(geometryFor(shape(a)).length + geometryFor(shape(b)).length + Math.max(0, distance - 4 * radius), scale)
            if (lengths + leadMinimumM(grid.point(a[0])) + leadMinimumM(grid.point(b.at(-1)!)) + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) continue
            const blocked = new Set<number>()
            for (let index = 0; index < jobs.length; index++) if (index !== pair.a && index !== pair.b) for (const cell of physicalCells(coilFor(jobs[index]))) blocked.add(cell)
            for (const cells of [a, b]) for (const cell of physicalCells(shape(cells))) blocked.add(cell)
            if (--budget.routes < 0) break relocated
            const bridge = routeHeating(grid, a.at(-1)!, b[0], { roomId: grid.room[a[0]], occupied: blocked,
              radiusCells: Math.ceil(2 * radius / grid.step), startDirection: a.at(-1)! - a.at(-2)!, endDirection: b[1] - b[0], checkpoint })
            if (!bridge) continue
            if (acceptJoin([...a, ...bridge.slice(1, -1), ...b], pair.a, pair.b, true)) { merged = true; break relocated }
          }
        }
      }
      if (merged) continue
      if (!merged) break
    }
    return true
  } catch (error) {
    if (error === roomTimeout) return false
    throw error
  }
}

/** Reserve small connector fields before larger neighbours consume them. Nested
 * reservations preserve a useful join while allowing its next neighbour in. */
const regroupHeatingFields = (grid: HeatingGrid, raw: CircuitJob[], initial: CircuitJob[], settings: AutomaticHeatingSettings,
  scale: DrawingScale, position: Point, factor: number, variant: number, budget: HeatingWorkBudget) => {
  const target = budget.targetCount!
  let best = initial, finished = false
  type Node = { bans: Set<number>; required: Set<number>; count: number; distance: number; size: number; depth: number; kind: number }
  const queue: Node[] = [], seen = new Set<string>()
  const box = (job: CircuitJob) => {
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
    for (const p of job.points ?? job.cells.map(grid.point)) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y) }
    return { x, y, right, bottom }
  }
  const length = (job: CircuitJob) => {
    const points = job.points ?? job.cells.map(grid.point)
    return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)
  }
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const smallLimit = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).maxCircuitLengthM * .35, scale)
  const add = (node: Node) => {
    const signature = `${[...node.required].sort((a, b) => a - b).join(',')};${[...node.bans].sort((a, b) => a - b).join(',')}`
    if (!seen.has(signature)) { seen.add(signature); queue.push(node) }
  }
  const enqueue = (jobs: CircuitJob[], bans: Set<number>, required: Set<number>, depth: number) => {
    const small = jobs.filter((job) => job.sourceMask && length(job) < smallLimit)
    for (const connector of small) {
      const a = box(connector), mask = connector.sourceMask!
      for (const neighbour of raw) {
        const bit = neighbour.sourceMask!
        if (mask & bit) continue
        const group = mask | bit
        // Only disjoint or nested reservations can be fulfilled in a merge tree.
        if ([...required].some((old) => (old & group) && (old & group) !== old && (old & group) !== group)) continue
        const b = box(neighbour), gap = Math.hypot(Math.max(0, a.x - b.right, b.x - a.right), Math.max(0, a.y - b.bottom, b.y - a.bottom))
        const next = new Set(required); next.add(group)
        add({ bans, required: next, count: jobs.length, distance: Math.round(gap / pitch), size: -length(neighbour), depth: depth + 1, kind: 0 })
      }
    }
    const singles = small.map(box)
    for (const job of jobs) {
      const mask = job.sourceMask ?? 0
      if (!mask || !(mask & (mask - 1)) || bans.has(mask) || required.has(mask)) continue
      const next = new Set(bans); next.add(mask)
      const b = box(job), distance = singles.length ? Math.min(...singles.map((a) => Math.max(0, a.x - b.right, b.x - a.right) + Math.max(0, a.y - b.bottom, b.y - a.bottom))) / pitch : 0
      add({ bans: next, required, count: jobs.length, distance, size: 0, depth: depth + 1, kind: 1 })
    }
    queue.sort((a, b) => a.kind - b.kind || a.count - b.count || b.depth - a.depth || a.distance - b.distance || a.size - b.size)
    if (queue.length > 16) queue.length = 16
  }
  enqueue(initial, new Set(), new Set(budget.requiredGroups), 0)
  for (let run = 0; queue.length && run < 10; run++) {
    checkHeatingDeadline(budget)
    if (budget.roomDeadline !== undefined && Date.now() >= budget.roomDeadline) break
    const node = queue.shift()!, jobs = raw.map((job) => ({ ...job })), occupied = new Set(jobs.flatMap((job) => job.cells))
    const child = { ...budget, forbiddenGroups: node.bans, requiredGroups: node.required, routes: 600 }
    const done = mergeHeatingJobs(grid, jobs, occupied, settings, scale, position, factor, variant, child)
    if (jobs.length < best.length) { best = jobs; finished = done }
    if (jobs.length <= target) return { jobs, finished: true }
    enqueue(jobs, node.bans, node.required, node.depth)
  }
  return { jobs: best, finished }
}

/** Plan complete circuits before checking manifold capacity. Temporary leg fields
 * are allowed to exceed that capacity: several can belong to one circuit. */
export const planHeatingCircuits = (grid: HeatingGrid, settings: AutomaticHeatingSettings, scale: DrawingScale, position: Point,
  { lengthPass = 0, mergeVariant = 0, budget = { routes: 600 } as HeatingWorkBudget, reservedForCoils = [] as readonly number[] } = {}) => {
  if (!grid.rooms.length) return { jobs: [] as CircuitJob[], occupied: new Set<number>(), initialFieldCount: 0, combiningFinished: true }
  const nativeRoom = grid.room, nativeRoomAreas = new Map(grid.rooms.map((room) => [room.id, room.cells.filter((c) => !grid.obstacle[c]).length * (grid.step * scale / 8000) ** 2]))
  let fieldGrid = reservedForCoils.length ? { ...grid, obstacle: grid.obstacle.slice() } : grid
  const sourceRoom = heatingSourceRoom(grid, position)
  const unheated = new Set(settings.heatSourceRoom === false ? sourceRoom?.cells ?? [] : [])
  if (budget.focusCells) for (const room of grid.rooms) for (const cell of room.cells) if (!budget.focusCells.has(cell)) unheated.add(cell)
  if (unheated.size) {
    fieldGrid = { ...fieldGrid, loopObstacle: fieldGrid.loopObstacle.slice() }
    for (const cell of unheated) fieldGrid.loopObstacle[cell] = 1
  }
  for (const cell of reservedForCoils) fieldGrid.obstacle[cell] = 1
  const nativeFloor = { ...grid, rooms: grid.rooms.map((room) => ({ ...room, cells: room.cells.filter((cell) => !unheated.has(cell)) })) }
  const preferMeanderRoomKeys = mergeVariant >= 4 ? [...budget.patternFallbackRooms ?? []] : []
  const attempt = lengthPass * 8 + mergeVariant + 1
  budget.onProgress?.({ phase: 'circuits', attempt })
  if (settings.shareSmallRooms && budget.sourceScene) {
    const original = grid
    let shared = shareSmallHeatingRooms(fieldGrid, budget.sourceScene, scale, settings.diameterMm, () => checkHeatingDeadline(budget))
    if (shared.rooms.some((room) => (room.members?.length ?? 0) > 1)) {
      budget.reserveAccess = true
      if (!budget.roomTargets) {
        const fixed = new Set(budget.preserved?.map((p) => p.heating?.circuitId) ?? [])
        const limits = heatingDesignLimits(settings.diameterMm, settings.design)
        const allocation = allocateHeatingCircuits(shared, position, (settings.capacity ?? 12) - fixed.size, settings.spacingMm, settings.edgeMm ?? 100, scale, limits.maxCircuitLengthM, limits.allowanceM, unheated)
        budget.roomTargets = allocation.targets; budget.suggestedMaxM = allocation.suggestedMaxM
      }
    }
    if (budget.reserveAccess) shared = reserveHeatingAccess(shared, grid.obstacle, budget.sourceScene, position, scale, settings.diameterMm, settings.capacity ?? 12, heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm, () => checkHeatingDeadline(budget), {
      original, targets: budget.roomTargets, spacingMm: settings.spacingMm, accessTargets: budget.accessTargets,
      ...(budget.connectionZone ? { origin: grid.point(budget.connectionZone.stubs[Math.floor(budget.connectionZone.stubs.length / 2)].at(-1)!) } : {}) })
    grid = { ...shared, obstacle: grid.obstacle }

    fieldGrid = shared
  }
  const rooms = [...grid.rooms].sort((a, b) => {
    const distance = (r: typeof a) => { const p = grid.point(r.minY * grid.width + r.minX), q = grid.point(r.maxY * grid.width + r.maxX); return Math.abs((p.x + q.x) / 2 - position.x) + Math.abs((p.y + q.y) / 2 - position.y) }
    return distance(b) - distance(a)
  })
  const combined: CircuitJob[] = [], occupied = new Set<number>()
  let initialFieldCount = 0, combiningFinished = true, completedRooms = 0
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
  // Independent rooms need one coherent entrance variant, not independently
  // sorted alternatives that keep reproducing the same obstructed bundle.
  // Shared, irregular zones benefit from the more expensive local packing pool.
  if (!grid.rooms.some((room) => (room.members?.length ?? 0) > 1)) {
    const variant = (mergeVariant % 2 ? 4 : 0) + Math.floor(mergeVariant / 2)
    const fields = buildHeatingSpiralFields(fieldGrid, { ...settings, leadAllowances: budget.leadAllowances, leadDistances: budget.leadDistances, leadStubMm: limits.minBendRadiusMm, entryGroups: budget.roomTargets, connectionBounds: budget.connectionZone?.bounds, preferMeanderRoomKeys, loopBudgetByRoom: budget.loopFactors, reserveAccess: budget.reserveAccess }, scale, position, Math.pow(.75, lengthPass), variant, () => checkHeatingDeadline(budget))
    if (budget.connectionZone) {
      orientHeatingFields(fieldGrid, fields.jobs, budget.connectionZone.stubs.map((stub) => stub.at(-1)!), settings.diameterMm, limits.minBendRadiusMm, scale, () => checkHeatingDeadline(budget), budget.wallPassage?.cells)
      fields.occupied.clear(); for (const field of fields.jobs) for (const cell of field.cells) fields.occupied.add(cell)
    }
    initialFieldCount = fields.jobs.length
    for (const jobs of roomsFarthestFirst(grid, fields.jobs, position)) {
      const routes = Math.min(600, Math.max(80, jobs.length * 32)), roomBudget = { ...budget, routes: budget.routes > 0 ? routes : 0,
        roomDeadline: Date.now() + (budget.roomTimeMs ?? 2500), onProgress: () => budget.onProgress?.({ phase: 'circuits', attempt, rooms: rooms.length, completedRooms, roomName: jobs[0].roomName, remainingFields: jobs.length }) }
      budget.onProgress?.({ phase: 'circuits', attempt, rooms: rooms.length, completedRooms, roomName: jobs[0].roomName })
      const mergeOrder = initialFieldCount > MAX_HEATING_CIRCUITS ? (mergeVariant < 4 ? 0 : 1) : (mergeVariant < 4 ? 1 : 0)
      const finished = roomBudget.routes > 0 ? mergeHeatingJobs(fieldGrid, jobs, fields.occupied, settings, scale, position,
        Math.pow(.85, lengthPass) * (budget.loopFactors?.[jobs[0].roomKey ?? jobs[0].roomName] ?? 1), mergeOrder, roomBudget) : false
      combiningFinished &&= finished
      combined.push(...jobs); completedRooms++
      budget.onProgress?.({ phase: 'circuits', attempt, rooms: rooms.length, completedRooms, roomName: jobs[0].roomName })
    }
    for (const job of combined) for (const cell of job.cells) occupied.add(cell)
    return { jobs: combined, occupied, initialFieldCount, combiningFinished }
  }
  if (!budget.roomTargets) {
    const fixed = new Set(budget.preserved?.map((p) => p.heating?.circuitId) ?? [])
    const allocation = allocateHeatingCircuits(fieldGrid, position, (settings.capacity ?? 12) - fixed.size, settings.spacingMm, settings.edgeMm ?? 100, scale, limits.maxCircuitLengthM, limits.allowanceM, unheated)
    budget.roomTargets = allocation.targets; budget.suggestedMaxM = allocation.suggestedMaxM
  }
  const pool = budget.roomCandidates ??= new Map()
  const compare = (a: RoomProposal, b: RoomProposal) => {
    for (let i = 0; i < a.score.length; i++) if (Math.abs(a.score[i] - b.score[i]) > 1e-7) return a.score[i] - b.score[i]
    return 0
  }
  for (const room of rooms) {
    checkHeatingDeadline(budget)
    const targetCount = budget.roomTargets.get(heatingRoomKey(room))
    const key = `${room.id}:${lengthPass}:${budget.reserveAccess ? 1 : 0}:${budget.loopFactors?.[heatingRoomKey(room)] ?? 1}:${preferMeanderRoomKeys.includes(heatingRoomKey(room)) ? 1 : 0}:${budget.leadAllowances?.[heatingRoomKey(room)] ?? 0}`
    let candidates = pool.get(key)
    const roomStart = Date.now(), duration = budget.roomTimeMs ?? ((room.members?.length ?? 0) > 1 ? 10000 : budget.connectionZone ? 4000 : 2500)
    const report = (fields = 0, remaining = fields, routeAttempts = 0) => budget.onProgress?.({ phase: 'circuits', attempt, fields, circuits: combined.length,
      rooms: rooms.length, completedRooms, roomName: room.name, remainingFields: remaining, routeAttempts })
    report()
    if (!candidates) {
      candidates = []
      for (let alternative = 0; alternative < (duration <= 0 || budget.routes <= 0 ? 1 : 8); alternative++) {
        if (alternative && Date.now() - roomStart >= duration) break
        const roomGrid = { ...fieldGrid, rooms: [room] }
        let result = buildHeatingSpiralFields(roomGrid, { ...settings, leadAllowances: budget.leadAllowances, leadDistances: budget.leadDistances, leadStubMm: limits.minBendRadiusMm, entryGroups: budget.roomTargets, connectionBounds: budget.connectionZone?.bounds, balanceLoads: true, nativeRoom, nativeRoomAreas, preferMeanderRoomKeys, deferCoverage: true, loopBudgetByRoom: budget.loopFactors, reserveAccess: budget.reserveAccess }, scale, position,
          Math.pow(.75, lengthPass) * [1, .75, .5, .35][Math.floor(alternative / 2)], (alternative % 2 ? 4 : 0) + Math.floor(alternative / 2), () => checkHeatingDeadline(budget))
        if (targetCount && result.jobs.length < targetCount) result = buildHeatingSpiralFields(roomGrid,
          { ...settings, leadAllowances: budget.leadAllowances, leadDistances: budget.leadDistances, leadStubMm: limits.minBendRadiusMm, entryGroups: budget.roomTargets, connectionBounds: budget.connectionZone?.bounds, balanceLoads: true, nativeRoom, nativeRoomAreas, preferMeanderRoomKeys, deferCoverage: true, loopBudgetByRoom: budget.loopFactors, reserveAccess: budget.reserveAccess }, scale, position,
          Math.pow(.75, lengthPass) * result.jobs.length / targetCount * .95, (alternative % 2 ? 4 : 0) + Math.floor(alternative / 2), () => checkHeatingDeadline(budget))
        const fields = result.jobs, initialFields = fields.length, routes = Math.min(600, Math.max(80, fields.length * 32))
        if (budget.connectionZone) {
          orientHeatingFields(roomGrid, fields, budget.connectionZone.stubs.map((stub) => stub.at(-1)!), settings.diameterMm, limits.minBendRadiusMm, scale, () => checkHeatingDeadline(budget), budget.wallPassage?.cells)
          result.occupied.clear(); for (const field of fields) for (const cell of field.cells) result.occupied.add(cell)
        }
        const roomBudget: HeatingWorkBudget = { nativeRoom, nativeRoomAreas, leadAllowanceM: budget.leadAllowances?.[heatingRoomKey(room)] ?? 0, leadDistances: budget.leadDistances, wallPassage: budget.wallPassage, connectionZone: budget.connectionZone, targetCount, routes: budget.routes > 0 && duration > 0 ? routes : 0, deadline: budget.deadline,
          roomDeadline: roomStart + Math.max(0, duration),
          onProgress: () => report(initialFields, fields.length, routes - roomBudget.routes) }
        const roomKeys = new Set(room.members?.map((member) => member.key) ?? [heatingRoomKey(room)])
        const floor = { ...nativeFloor, rooms: nativeFloor.rooms.filter((room) => roomKeys.has(heatingRoomKey(room))) }
        pruneRedundantHeatingFields(floor, fields, settings, scale, () => checkHeatingDeadline(budget))
        deferHeatingFeedRemnants(roomGrid, fields, settings.spacingMm, scale, () => checkHeatingDeadline(budget))
        if (fields.length <= 24) fields.forEach((job, i) => { job.sourceMask = 1 << i })
        const packingGroups = new Map<string, number>()
        for (const job of fields) if (job.packingGroup && job.sourceMask) packingGroups.set(job.packingGroup, (packingGroups.get(job.packingGroup) ?? 0) | job.sourceMask)
        roomBudget.requiredGroups = new Set([...packingGroups.values()].filter((mask) => (mask & (mask - 1)) !== 0))
        const originalFields = fields.map((job) => ({ ...job }))
        let finished = roomBudget.routes > 0 ? mergeHeatingJobs(roomGrid, fields, result.occupied, settings, scale, position,
          Math.pow(.85, lengthPass) * (budget.loopFactors?.[heatingRoomKey(room)] ?? 1), alternative % 4, roomBudget) : false
        pruneRedundantHeatingFields(floor, fields, settings, scale, () => checkHeatingDeadline(budget))
        if (targetCount && fields.length <= targetCount) finished = true
        if ((room.members?.length ?? 0) > 1 && targetCount && fields.length > targetCount && fields.length <= 24) {
          const packed = regroupHeatingFields(roomGrid, originalFields, fields, settings, scale, position,
            Math.pow(.85, lengthPass) * (budget.loopFactors?.[heatingRoomKey(room)] ?? 1), alternative % 4, roomBudget)
          if (packed.jobs.length < fields.length) { fields.splice(0, fields.length, ...packed.jobs); finished = packed.finished }
        }
        pruneRedundantHeatingFields(floor, fields, settings, scale, () => checkHeatingDeadline(budget))
        const pipes = fields.map((field, i) => createHeatingPipe(`room-${room.id}-${i}`, openHeatingTurns(field.points ?? simplifyHeatingPath(field.cells.map(grid.point)), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
          { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: `field-${i}` }))
        const coverage = measureHeatingCoverage({ ...roomGrid, rooms: [{ ...room, cells: room.cells.filter((cell) => !unheated.has(cell) && !roomGrid.loopObstacle[cell]) }] }, pipes, scale, settings.spacingMm, settings.edgeMm, () => checkHeatingDeadline(budget), false).coverage.rooms[0]
        const lengths = pipes.map((pipe) => drawingLengthMetres(heatingPipeGeometry(pipe).length, scale))
        const body = automaticManifoldSize(settings.capacity ?? 12, scale, grid.step)
        const region = budget.connectionZone?.bounds
        const lead = (p: Point) => budget.leadDistances ? (() => {
          const cell = grid.index(p), distance = cell >= 0 ? budget.leadDistances[cell] : -1
          return distance < 0 ? Infinity : drawingLengthMetres(distance * grid.step, scale) + limits.minBendRadiusMm / 1000 + (roomBudget.leadAllowanceM ?? 0) / 2
        })() : drawingLengthMetres(region
          ? Math.max(0, region.x - p.x, p.x - region.x - region.width) + Math.max(0, region.y - p.y, p.y - region.y - region.height)
          : Math.abs(p.y - position.y - (settings.manifoldSide === 'top' ? 0 : body.height)) + Math.max(0, position.x - p.x, p.x - position.x - body.width), scale)
        const totals = pipes.map((pipe, i) => { const p = heatingPipeGeometry(pipe).points; return lengths[i] + lead(p[0]) + lead(p.at(-1)!) + limits.allowanceM })
        const mean = totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length)
        const proposal: RoomProposal = { jobs: fields.map((field) => ({ ...field })), initialFields, finished,
          score: [targetCount ? Math.abs(fields.length - targetCount) * 100 + (fields.length < targetCount ? 1000 : 0) : fields.length || (coverage.eligibleM2 > .1 ? 1000 : 0), coverage.eligibleM2 && coverage.gapM2 / coverage.eligibleM2 > .05 ? 1 + coverage.gapM2 : 0, Math.max(0, ...totals), totals.reduce((sum, n) => sum + (n - mean) ** 2, 0), coverage.gapM2, lengths.reduce((a, b) => a + b, 0)] }
        if (!candidates.some((candidate) => layoutKey(candidate.jobs) === layoutKey(proposal.jobs))) candidates.push(proposal)
        candidates.sort(compare)
        if (candidates.length > 3) candidates.length = 3
        const target = Math.max(1, Math.ceil(coverage.eligibleM2 / (settings.spacingMm / 1000) / Math.max(10, limits.maxCircuitLengthM - limits.allowanceM - 5)))
        if (fields.length <= target && Math.max(0, ...totals) <= limits.maxCircuitLengthM - 3 && coverage.gapM2 <= Math.max(.05, coverage.eligibleM2 * .02)) break
      }
      pool.set(key, candidates)
    }
    const selected = candidates[Math.min(Math.floor(mergeVariant / 3), candidates.length - 1)]
    combined.push(...selected.jobs.map((job) => ({ ...job })))
    initialFieldCount += selected.initialFields
    combiningFinished &&= selected.finished
    for (const job of selected.jobs) for (const cell of job.cells) occupied.add(cell)
    completedRooms++; report(selected.initialFields, selected.jobs.length)
  }
  return { jobs: combined, occupied, initialFieldCount, combiningFinished }
}

export type AutomaticHeatingResult = { shapes: RectShape[]; rows: HeatingScheduleRow[]; tableOnSeparatePage: boolean; wallCrossings: number }
type HeatingRetry = { lengthPass: number; mergeVariant: number }

const generateHeatingAttempt = (scene: readonly Shape[], position: Point, settings: AutomaticHeatingSettings,
  scale: DrawingScale, nextId: () => string, pageArea: { x: number; y: number; width: number; height: number },
  lengthPass = 0, mergeVariant = 0, budget: HeatingWorkBudget = { routes: 600 }, search?: HeatingSearch): AutomaticHeatingResult | { retry: HeatingRetry } => {
  if (!Number.isFinite(settings.diameterMm) || settings.diameterMm < 6 || settings.diameterMm > 50 ||
    !Number.isFinite(settings.spacingMm) || settings.spacingMm < 50 || settings.spacingMm > 500) throw new Error('Controleer de buisdiameter en legafstand.')
  settings = { ...settings, edgeMm: settings.edgeMm ?? 100, capacity: settings.capacity ?? DEFAULT_HEATING_CAPACITY, circuitSpacingMm: sanitizeHeatingCircuitSpacing(settings.circuitSpacingMm), design: sanitizeHeatingDesign(settings.design) }
  if (!Number.isInteger(settings.capacity) || settings.capacity < 1 || settings.capacity > MAX_HEATING_CIRCUITS || !Number.isFinite(settings.edgeMm) || settings.edgeMm < 0 || settings.edgeMm > 1000) throw new Error('Controleer randafstand en verdelercapaciteit.')
  const defaultSpacingMm = settings.spacingMm
  const reflowId = budget.reflowCircuit?.[0]?.heating?.circuitId
  if (reflowId) settings = { ...settings, spacingMm: settings.circuitSpacingMm?.[reflowId] ?? defaultSpacingMm }
  // Each compared candidate owns its metadata; coverage measurements must not
  // mutate the input or an earlier valid proposal's retained circuits.
  let preserved = (budget.preserved ?? []).map((pipe) => ({ ...pipe, heating: { ...pipe.heating! } }))
  const fixedIds = new Set(preserved.map((pipe) => pipe.heating?.circuitId).filter(Boolean))
  if (preserved.some((pipe) => [pipe.heating?.roomKey, ...pipe.heating?.roomMembers?.map((r) => r.key) ?? []].some((key) => key && settings.excludedRoomKeys?.includes(key)))) throw new Error('Maak de vaste kringen in een uitgesloten ruimte eerst los.')
  const freePorts = Array.from({ length: settings.capacity }, (_, i) => i).filter((i) => !fixedIds.has(`VV${String(i + 1).padStart(2, '0')}`) && (!reflowId || i === Number(reflowId.slice(2)) - 1))
  if ([...fixedIds].some((id) => !/^VV\d+$/.test(id) || Number(id.slice(2)) > settings.capacity)) throw new Error('Een vaste kring valt buiten de ingestelde verdelercapaciteit. Maak die kring eerst los of vergroot de capaciteit.')
  if (preserved.length && budget.existingManifold?.heating?.capacity && settings.capacity !== budget.existingManifold.heating.capacity) throw new Error('Maak vaste kringen eerst los voordat je de verdelercapaciteit wijzigt.')
  if (preserved.length && settings.manifoldSide && settings.manifoldSide !== 'auto' && settings.manifoldSide !== (budget.existingManifold?.heating?.manifoldSide ?? 'bottom')) throw new Error('Maak vaste kringen eerst los voordat je de aansluitzijde van de verdeler wijzigt.')
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  // Inputs remain fixed throughout this search; only strip direction/phase and splitting
  // vary. Reuse room rasterisation while isolating each attempt's temporary obstacles.
  checkHeatingDeadline(budget)
  if (!budget.grid) budget.onProgress?.({ phase: 'rooms' })
  const template = budget.grid ??= buildHeatingGrid(scene, scale, settings.spacingMm, position, {
    pipeDiameterMm: settings.diameterMm, minBendRadiusMm: limits.minBendRadiusMm
  })
  const isConnectionZone = settings.connectionMode === 'zone'
  const zone = isConnectionZone ? budget.connectionZone ??= heatingConnectionZone(template, scene, position, settings.capacity, settings.diameterMm, limits.minBendRadiusMm, scale) : undefined
  const sourceRegion = heatingSourceRoom(template, position)
  if (settings.manifoldSide === 'auto') {
    const size = automaticManifoldSize(settings.capacity, scale, template.step), centre = { x: position.x + size.width / 2, y: position.y + size.height / 2 }
    const doors = sourceRegion?.cells.filter((cell) => template.door[cell]) ?? []
    const nearest = doors.sort((a, b) => { const p = template.point(a), q = template.point(b); return Math.hypot(p.x - centre.x, p.y - centre.y) - Math.hypot(q.x - centre.x, q.y - centre.y) })[0]
    settings.manifoldSide = preserved.length ? budget.existingManifold?.heating?.manifoldSide ?? 'bottom' : nearest !== undefined && template.point(nearest).y < centre.y - template.step ? 'top' : 'bottom'
  }
  const outward = settings.manifoldSide === 'top' ? -1 : 1
  const included = template.rooms.filter((room) => !settings.excludedRoomKeys?.includes(heatingRoomKey(room)))
  const fixedRoomById = new Map<string, string>()
  for (const pipe of preserved) if (pipe.heating?.pipeRole === 'loop') {
    const anchor = heatingPipeGeometry(pipe).points[0]
    const room = anchor && template.rooms.find((r) => r.id === template.room[template.index(anchor)])
    if (room) fixedRoomById.set(pipe.heating.circuitId!, heatingRoomKey(room))
  }
  preserved = preserved.map((pipe) => !pipe.heating!.roomKey && fixedRoomById.has(pipe.heating!.circuitId!)
    ? { ...pipe, heating: { ...pipe.heating!, roomKey: fixedRoomById.get(pipe.heating!.circuitId!) } } : pipe)
  if (preserved.some((pipe) => [pipe.heating.roomKey, ...pipe.heating.roomMembers?.map((r) => r.key) ?? []].some((key) => key && settings.excludedRoomKeys?.includes(key)))) throw new Error('Maak de vaste kringen in een uitgesloten ruimte eerst los.')
  const sourceRoomId = sourceRegion?.id ?? template.room[template.index(position)]
  const coverageGrid = { ...template, rooms: included.filter((room) => settings.heatSourceRoom !== false || room.id !== sourceRoomId) }
  const fixedRooms = new Set(included.filter((room) => {
    const rows = budget.existingManifold?.heating?.rows?.filter((row) => row.roomKey === heatingRoomKey(room) || row.roomMembers?.some((r) => r.key === heatingRoomKey(room)) || fixedRoomById.get(row.id) === heatingRoomKey(room)) ?? []
    return rows.length > 0 && rows.every((row) => fixedIds.has(row.id))
  }).map(heatingRoomKey))
  const scope = budget.onlyRoom ? heatingRoomScope(budget.existingManifold?.heating?.rows ?? [], budget.onlyRoom) : undefined
  const grid = { ...template, rooms: included.filter((room) => !fixedRooms.has(heatingRoomKey(room)) && (!scope || scope.has(heatingRoomKey(room)))),
    obstacle: template.obstacle.slice(), loopObstacle: template.loopObstacle.slice() }
  // A manifold inside the building must not send feeds out through the facade
  // and around the house to bypass coils. A source in an open corridor remains
  // supported for drawings made from separate room outlines.
  if (sourceRoomId > 0) for (let cell = 0; cell < grid.obstacle.length; cell++) if (grid.room[cell] < 0) grid.obstacle[cell] = 1
  for (const pipe of preserved) for (const piece of heatingPipeGeometry(pipe).pieces) {
    const reach = drawingUnitsForMetres((settings.spacingMm + pipe.heating!.spacingMm) / 2000, scale)
    const minX = Math.max(0, Math.floor((Math.min(piece.a.x, piece.b.x) - reach - grid.origin.x) / grid.step)), maxX = Math.min(grid.width - 1, Math.ceil((Math.max(piece.a.x, piece.b.x) + reach - grid.origin.x) / grid.step))
    const minY = Math.max(0, Math.floor((Math.min(piece.a.y, piece.b.y) - reach - grid.origin.y) / grid.step)), maxY = Math.min(grid.height - 1, Math.ceil((Math.max(piece.a.y, piece.b.y) + reach - grid.origin.y) / grid.step))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const cell = y * grid.width + x
      if (segmentDistance(grid.point(cell), piece.a, piece.b) < reach) grid.loopObstacle[cell] = 1
    }
  }
  if (reflowId && !budget.focusCells) {
    const ownership = measureHeatingCoverage(coverageGrid, [...preserved, ...budget.reflowCircuit!], scale, defaultSpacingMm, settings.edgeMm, () => checkHeatingDeadline(budget), false, true)
    budget.focusCells = new Set(ownership.cellsByCircuit.get(reflowId) ?? [])
    if (!budget.focusCells.size) throw new Error(`Geen bestaand legvlak gevonden voor kring ${reflowId}. Bereken het volledige legplan opnieuw.`)
  }
  if (grid.obstacle[grid.index(position)]) throw new Error('De verdeler staat op een symbool. Kies een vrije positie.')
  const { width: reservedWidth, height: manifoldHeight } = automaticManifoldSize(settings.capacity ?? MAX_HEATING_CIRCUITS, scale, grid.step)
  const heatOnly: number[] = []
  for (let i = 0; i < grid.obstacle.length; i++) {
    const p = grid.point(i)
    if (!isConnectionZone && p.x >= position.x - grid.step && p.x <= position.x + reservedWidth && (outward > 0 ? p.y >= position.y - grid.step && p.y < position.y + manifoldHeight - grid.step : p.y > position.y + grid.step && p.y <= position.y + manifoldHeight + grid.step)) grid.obstacle[i] = 1
    const away = outward * (p.y - position.y - (outward > 0 ? manifoldHeight : 0))
    if (!isConnectionZone && !grid.obstacle[i] && p.x >= position.x - grid.step && p.x <= position.x + reservedWidth && away >= -grid.step && away <= 4 * grid.step) heatOnly.push(i)
  }
  if (zone) heatOnly.push(...zone.reserved)
  if (budget.wallPassage) heatOnly.push(...budget.wallPassage.clearance)
  coverageGrid.obstacle = grid.obstacle.slice()
  budget.sourceScene = scene
  if (zone && !budget.leadDistances) budget.leadDistances = heatingAccessDistances(grid, zone.stubs.map((stub) => stub.at(-1)!), budget.wallPassage?.cells ?? new Set(), sourceRoomId > 0, () => checkHeatingDeadline(budget))
  const { jobs, occupied, combiningFinished } = planHeatingCircuits(grid, settings, scale, position,
    { lengthPass, mergeVariant, budget, reservedForCoils: heatOnly })
  const diagnostic = describeHeatingPlan(coverageGrid, settings, scale, position, jobs.map((job, i) => ({ ...job,
    loopM: drawingLengthMetres(heatingPipeGeometry(createHeatingPipe(`diagnostic-${i}`, openHeatingTurns(job.points ?? simplifyHeatingPath(job.cells.map(grid.point)), drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), drawingUnitsForMetres(settings.diameterMm / 1000, scale)), { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop' })).length, scale) })))
  if (!budget.diagnostics || diagnostic.candidateCircuits < budget.diagnostics.candidateCircuits) budget.diagnostics = diagnostic
  if (jobs.length > freePorts.length) {
    if (mergeVariant >= 3 && budget.roomTargets) {
      const counts = new Map<string, number>()
      for (const job of jobs) { const key = job.roomKey ?? job.roomName; counts.set(key, (counts.get(key) ?? 0) + 1) }
      for (const [key, count] of counts) if (count > (budget.roomTargets.get(key) ?? count)) budget.patternFallbackRooms?.add(key)
    }
    // Dense feeder bundles heat part of the same floor. Reserve their corridor
    // before concluding that separately filled laying fields need extra ports.
    // Previously capacity failure returned before this strategy was ever tried.
    if (mergeVariant >= 7 && !budget.reserveAccess && settings.shareSmallRooms) {
      budget.accessTargets = jobs.map((job) => grid.point(job.cells[0]))
      budget.reserveAccess = true
      return { retry: { lengthPass, mergeVariant: 0 } }
    }
    if (!combiningFinished) {
      if (mergeVariant < 7 && budget.routes > 0) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
      throw new Error('De planner kon de deelvlakken nog niet volledig tot kringen samenvoegen. Er is nog geen definitief aantal kringen bepaald.')
    }
    if (mergeVariant < 7 && budget.routes > 0) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
    const report = budget.diagnostics!
    if (report.candidateCircuits <= settings.capacity) throw new Error(search?.lastFailure ?? 'Een indeling binnen de verdelercapaciteit is gevonden, maar nog geen volledig geldig aansluittraject. Het aantal groepen is hier niet de blokkering.')
    report.code = 'capacity'
    report.issues = [{ message: 'Dit aantal is een gevonden indeling, geen bewezen minimum. De leidingraming bevat nog geen aansluitleidingen of snijreserve.' }]
    throw new HeatingPlanningFailure(`Voorlopige indeling: ${report.candidateCircuits} deelkringen voor ${report.areaM2.toFixed(1)} m². De verdeler heeft ${settings.capacity} aansluitingen, waarvan ${fixedIds.size} vastgezet zijn. Rekengrens: ${limits.maxCircuitLengthM} m per kring inclusief aansluitingen. Bekijk de ruimteberekening.`, report)
  }
  // Order ports by the room's access, rather than its centre behind the walls.
  // Centre angles interleave front and back rows of rooms, forcing their shared
  // approach bundle to cross even though each doorway has a clear route.
  const accesses = new Map<number, Point>()
  for (const room of grid.rooms) {
    let nearest = -1, best = Infinity
    for (const cell of room.cells) if (grid.door[cell]) {
      const p = grid.point(cell), distance = Math.abs(p.x - position.x) + Math.abs(p.y - position.y)
      if (distance < best) { best = distance; nearest = cell }
    }
    if (nearest >= 0) {
      const opening = [...heatingSharedDoors(grid, [nearest])].map(grid.point)
      accesses.set(room.id, { x: opening.reduce((sum, p) => sum + p.x, 0) / opening.length, y: opening.reduce((sum, p) => sum + p.y, 0) / opening.length })
    }
  }
  const centreAngle = (job: CircuitJob) => {
    const points = job.cells.map(grid.point), x = (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
      y = (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2
    return Math.atan2(y - position.y, x - position.x)
  }
  const accessAngle = (job: CircuitJob) => {
    const point = accesses.get(grid.room[job.cells[0]])
    return point ? Math.atan2(point.y - position.y, point.x - position.x) : centreAngle(job)
  }
  // Mirroring the manifold exit also mirrors the order of its fan. Keeping the
  // bottom-exit port order at a top exit forces supply/return pairs to cross.
  jobs.sort((a, b) => outward * (accessAngle(b) - accessAngle(a) || centreAngle(b) - centreAngle(a)))

  if (!jobs.length && !preserved.length) throw new Error('Geen verwarmingsruimte geselecteerd. Controleer de ruimtekeuze en verboden zones.')
  const feedWallOptions = { allowWalls: true, permittedWallCells: budget.wallPassage?.cells ?? new Set<number>() }
  const naturalSize = automaticManifoldSize(settings.capacity, scale, grid.step)
  const oldWidth = budget.existingManifold ? Math.abs(budget.existingManifold.end.x - budget.existingManifold.start.x) : naturalSize.width
  const width = preserved.length && budget.existingManifold ? Math.max(oldWidth, naturalSize.width) : naturalSize.width
  const height = preserved.length && budget.existingManifold ? Math.abs(budget.existingManifold.end.y - budget.existingManifold.start.y) : naturalSize.height
  for (const b of isConnectionZone ? [] : heatingObstacleBounds(scene, shapeBounds)) {
    if (position.x < b.x + b.width && position.x + width > b.x && position.y < b.y + b.height && position.y + height > b.y) {
      throw new Error('De verdeler overlapt een symbool. Kies een vrije positie voor de verdeler.')
    }
  }
  const bottom = preserved.length && budget.existingManifold ? position.y + height : grid.point(grid.index({ x: position.x, y: position.y + height })).y
  const portY = outward > 0 ? bottom : grid.point(grid.index(position)).y
  const manifold: RectShape = { id: nextId(), kind: 'rect', start: position,
    end: isConnectionZone ? { x: position.x + drawingUnitsForMetres(.15, scale), y: position.y + drawingUnitsForMetres(.15, scale) } : { x: position.x + width, y: bottom }, strokeWidth: 2,
    heating: { ...heatingDefaults('manifold', scale), ...settings, ...(zone ? { connectionZoneRadiusMm: zone.radiusMm } : {}), spacingMm: defaultSpacingMm, ...(sourceRegion ? { sourceRoomKey: heatingRoomKey(sourceRegion) } : {}), pattern: combineHeatingPatterns([...jobs.map((job) => job.pattern), ...preserved.filter((pipe) => pipe.heating?.pipeRole === 'loop').map((pipe) => pipe.heating!.pattern)]), automatic: true, circuits: jobs.length + fixedIds.size, name: 'Verdeler', planningRooms: template.rooms.map((room) => ({ key: heatingRoomKey(room), name: room.name })), points: [] } }
  const shapes: RectShape[] = [manifold, ...preserved], baseOccupied = new Set(occupied)
  for (const pipe of preserved) for (const piece of heatingPipeGeometry(pipe).pieces) {
    const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (grid.step / 2)))
    for (let i = 0; i <= n; i++) baseOccupied.add(grid.index({ x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n }))
  }
  const centreX = grid.point(grid.index({ x: position.x + grid.step * 2, y: bottom })).x
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), radiusCells = Math.ceil(2 * radius / grid.step)
  const stemLength = Math.max(4, radiusCells + 1)
  // Neighbouring pipes need tube clearance, not another full bend diameter of
  // vertical stagger. The latter made a 12-circuit fan extend over four metres.
  const stemStagger = Math.max(1, Math.ceil(drawingUnitsForMetres(settings.diameterMm * 1.1 / 1000, scale) / grid.step))
  const routingWidth = automaticManifoldSize(jobs.length + fixedIds.size, scale, grid.step).width
  const fanDirection = jobs.reduce((sum, job) => sum + grid.point(job.cells[0]).x - position.x - width / 2, 0) >= 0 ? 1 : -1
  const fanExitX = grid.point(grid.index({ x: fanDirection > 0 ? position.x + routingWidth + (radiusCells + 2) * grid.step
    : position.x - (radiusCells + 2) * grid.step, y: bottom })).x
  const legacyStems = Array.from({ length: jobs.length }, (_, i) => [centreX + freePorts[i] * grid.step * 3, centreX + (freePorts[i] * 3 + 1) * grid.step]
    .map((defaultX, offset) => {
      const old = preserved.length ? budget.existingManifold?.heating?.points?.[freePorts[i] * 2 + offset] : undefined
      // Preserve the physical ports while giving a reflow on a coarser raster
      // distinct search roots. Independent nearest rounding can collapse two
      // 20 mm ports onto one 25 mm cell.
      const originalX = old ? position.x + old.x * oldWidth : defaultX
      const x = old ? grid.origin.x + (offset ? Math.ceil : Math.floor)((originalX - grid.origin.x) / grid.step) * grid.step : originalX
      const port = i * 2 + offset, stagger = fanDirection > 0 ? jobs.length * 2 - 1 - port : port
      const cells = Array.from({ length: stemLength + stagger * stemStagger }, (_, j) => grid.index({ x, y: portY + outward * j * grid.step }))
      const y = portY + outward * (cells.length - 1) * grid.step
      for (let next = x + fanDirection * grid.step; fanDirection * (fanExitX - next) >= -1e-6; next += fanDirection * grid.step) cells.push(grid.index({ x: next, y }))
      return cells
    }))
  const availableTails = zone?.stubs.filter((stub) => stub.every((cell) => cell >= 0 && !grid.obstacle[cell] && !occupied.has(cell) && heatingWallAllowed(grid, cell, feedWallOptions))) ?? []
  const stems = zone ? jobs.map((job) => [job.cells[0], job.cells.at(-1)!].map((target) => {
    const p = grid.point(target)
    let best = 0, distance = Infinity
    for (let i = 0; i < availableTails.length; i++) {
      const q = grid.point(availableTails[i].at(-1)!), cost = Math.abs(p.x - q.x) + Math.abs(p.y - q.y)
      if (cost < distance) { distance = cost; best = i }
    }
    return availableTails.splice(best, 1)[0] ?? []
  })) : legacyStems
  if (stems.some((pair) => pair.some((stem) => !stem.length || stem[0] < 0 || grid.obstacle[stem[0]]))) {
    throw new Error('Er is onvoldoende vrije ruimte voor de aansluitingen aan de verdeler.')
  }
  for (const pair of stems) for (const stem of pair) for (const cell of stem) baseOccupied.add(cell)
  const apronGrid = { ...grid, obstacle: grid.obstacle.slice() }
  const apronBottom = stems.length ? Math.max(...stems.flat().map((stem) => grid.point(stem.at(-1)!).y)) + grid.step : bottom
  const apronTop = stems.length ? Math.min(...stems.flat().map((stem) => grid.point(stem.at(-1)!).y)) - grid.step : position.y
  for (let cell = 0; cell < apronGrid.obstacle.length; cell++) {
    const p = grid.point(cell)
    if (p.x > Math.min(position.x - radius, fanExitX) + 1e-6 && p.x < Math.max(position.x + routingWidth + radius, fanExitX) - 1e-6 && (outward > 0 ? p.y >= position.y - grid.step && p.y < apronBottom : p.y > apronTop && p.y <= bottom + grid.step)) apronGrid.obstacle[cell] = 1
  }
  if (search) {
    const key = layoutKey(jobs) + `:${isConnectionZone ? 'zone' : fanDirection}:${budget.wallPassage?.point.x ?? 'doors'}:${budget.wallPassage?.point.y ?? ''}`
    if (search.layouts.has(key)) {
      if (mergeVariant < 7) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
      if (lengthPass < 3) return { retry: { lengthPass: lengthPass + 1, mergeVariant: 0 } }
      throw new Error(search.lastFailure ?? 'Geen passende legindeling gevonden. Dezelfde indeling wordt niet opnieuw doorgerekend.')
    }
    if (search.layouts.size >= MAX_HEATING_LAYOUTS) throw new Error(search.lastFailure ?? `Geen volledig legplan gevonden na ${MAX_HEATING_LAYOUTS} verschillende indelingen.`)
    search.layouts.add(key)
  }
  // The fan is a reservation for future ports, not a mandatory route. The
  // route search now starts at the actual manifold ports and prices every wall.
  for (let i = 0; i < settings.capacity; i++) for (const offset of [0, 1]) {
    const old = preserved.length ? budget.existingManifold?.heating?.points?.[i * 2 + offset] : undefined
    manifold.heating!.points![i * 2 + offset] = old ? oldWidth === width ? old : { x: old.x * oldWidth / width, y: old.y }
      : { x: (centreX + (i * 3 + offset) * grid.step - position.x) / width, y: outward > 0 ? 1 : 0 }
  }

  const physicalPort = (index: number, offset: number, root?: number): Point => {
    const snapped = grid.point(root ?? stems[index][offset][0])
    if (!preserved.length || !budget.existingManifold?.heating?.points) return snapped
    const candidates = (root === undefined ? [freePorts[index] * 2 + offset] : freePorts.flatMap((port) => [port * 2, port * 2 + 1])).flatMap((port) => {
      const p = budget.existingManifold!.heating!.points?.[port]
      return p ? [{ x: position.x + p.x * oldWidth, y: position.y + p.y * height }] : []
    })
    return candidates.sort((a, b) => Math.hypot(a.x - snapped.x, a.y - snapped.y) - Math.hypot(b.x - snapped.x, b.y - snapped.y))[0] ?? snapped
  }
  const exactConnectionEnd = (points: Point[], point: Point, atStart: boolean) => {
    if (!points.length) return points
    const path = atStart ? points.map((p) => ({ ...p })) : points.map((p) => ({ ...p })).reverse()
    if (path.length > 1) {
      if (Math.abs(path[1].x - path[0].x) < 1e-7) path[1].x = point.x
      else if (Math.abs(path[1].y - path[0].y) < 1e-7) path[1].y = point.y
    }
    path[0] = point
    return atStart ? path : path.reverse()
  }
  const routePoints = (cells: number[]) => cells.length === 1 ? [grid.point(cells[0]), grid.point(cells[0])] : simplifyHeatingPath(cells.map(grid.point))
  const stemCells = new Set(stems.flat(2))
  const escapes = jobs.map((job, index) => {
    const cells = job.cells, first = cells[0], last = cells.at(-1)!
    return [[stems[index][0].at(-1)!, zone ? stems[index][0].at(-1)! - stems[index][0].at(-2)! : fanDirection], [stems[index][1].at(-1)!, zone ? stems[index][1].at(-1)! - stems[index][1].at(-2)! : fanDirection],
      [first, first - cells[1]], [last, last - cells.at(-2)!]].map(([root, direction]) =>
        Array.from({ length: Math.ceil(radiusCells / 2) }, (_, n) => root + direction * (n + 1)))
  })
  for (const escape of escapes.flat()) for (const cell of escape) baseOccupied.add(cell)
  const ids = jobs.map(() => [nextId(), nextId(), nextId()])
  const common = jobs.map((job, index) => ({ ...heatingDefaults('pipe', scale), ...settings, pattern: job.pattern ?? 'spiral', automatic: true,
    circuitId: `VV${String(freePorts[index] + 1).padStart(2, '0')}`, roomName: job.roomName, ...(job.roomKey ? { roomKey: job.roomKey } : {}), ...(job.roomMembers ? { roomMembers: job.roomMembers } : {}), spacingMinMm: job.spacingMinMm, spacingMaxMm: job.spacingMaxMm }))
  const coils = jobs.map((job, index) => {
    for (const offset of [0, 1]) { const p = physicalPort(index, offset); manifold.heating!.points![2 * freePorts[index] + offset] = { x: (p.x - position.x) / width, y: (p.y - position.y) / (bottom - position.y) } }
    return createHeatingPipe(ids[index][0], openHeatingTurns(job.points ?? routePoints(job.cells), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
      { ...common[index], name: common[index].circuitId, pipeRole: 'loop', servedAreaM2: job.areaM2 })
  })
  manifold.heating!.activeCircuitIds = [...fixedIds, ...common.map((data) => data.circuitId)]
  const geometries = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (pipe: RectShape) => {
    let value = geometries.get(pipe)
    if (!value) { value = heatingPipeGeometry(pipe); geometries.set(pipe, value) }
    return value
  }
  const checkpoint = () => checkHeatingDeadline(budget)
  // Route around the rendered tube envelope, including the widened R80 centre
  // returns. Reserving only the original orthogonal waypoints misses those arcs.
  if (isConnectionZone) occupied.clear()
  for (const pipe of [...coils, ...preserved]) for (const piece of geometryFor(pipe).pieces) {
    checkpoint()
    const clearance = drawingUnitsForMetres((settings.diameterMm + pipe.heating!.diameterMm) / 2000, scale)
    const minX = Math.max(0, Math.floor((Math.min(piece.a.x, piece.b.x) - clearance - grid.origin.x) / grid.step)), maxX = Math.min(grid.width - 1, Math.ceil((Math.max(piece.a.x, piece.b.x) + clearance - grid.origin.x) / grid.step))
    const minY = Math.max(0, Math.floor((Math.min(piece.a.y, piece.b.y) - clearance - grid.origin.y) / grid.step)), maxY = Math.min(grid.height - 1, Math.ceil((Math.max(piece.a.y, piece.b.y) + clearance - grid.origin.y) / grid.step))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const cell = y * grid.width + x
      if (segmentDistance(grid.point(cell), piece.a, piece.b) < clearance - 1e-6) { occupied.add(cell); baseOccupied.add(cell) }
    }
  }
  const obstructedEntry = jobs.findIndex((_, index) => escapes[index].slice(2).some((path) => path.some((cell) => cell < 0 || grid.obstacle[cell] || occupied.has(cell))))
  if (obstructedEntry >= 0) {
    const message = `${jobs[obstructedEntry].roomName}: te weinig vrije tangentruimte voor een aansluiting met R${limits.minBendRadiusMm}.`
    if (search) search.lastFailure = message
    if (!budget.reserveAccess) { budget.reserveAccess = true; return { retry: { lengthPass, mergeVariant } } }
    if (mergeVariant < 7) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
    throw new Error(message)
  }
  const obstacles = heatingObstacleBounds(scene, shapeBounds)
  const lanes = budget.reserveAccess && jobs.some((job) => (job.roomMembers?.length ?? 0) > 1) ? heatingFeedLanes(grid, position, settings.spacingMm, settings.diameterMm, scale) : undefined
  const wallAccess = {
    ...feedWallOptions,
    ...(lanes ? { lanePitchCells: lanes.pitchCells, lanePenalty: lanes.penalty } : {}),
    wallEntryPenalty: drawingUnitsForMetres(2, scale) / grid.step,
    manifoldAccess: { point: { x: position.x + width / 2, y: portY }, radius: drawingUnitsForMetres(1, scale),
      entryPenalty: drawingUnitsForMetres(.25, scale) / grid.step }
  }
  const prefixes = new WeakMap<number[], number[] | null>()
  const prefixFor = (stem: number[]) => {
    if (prefixes.has(stem)) return prefixes.get(stem)!
    const blocked = new Set(baseOccupied)
    for (const cell of stem) if (!occupied.has(cell)) blocked.delete(cell)
    const routed = routeHeating(grid, stem[0], stem.at(-1)!, { ...wallAccess, radiusCells,
      startDirection: outward * grid.width, endDirection: fanDirection, occupied: blocked, checkpoint })
    const candidates = [routed, stem].filter((path): path is number[] => Boolean(path) && path.every((cell) => cell >= 0 && !grid.obstacle[cell] && heatingWallAllowed(grid, cell, wallAccess) && (cell === path[0] || cell === path.at(-1) || !blocked.has(cell))))
      .filter((path) => {
        const pipe = createHeatingPipe('prefix-check', routePoints(path), { ...heatingDefaults('pipe', scale), ...settings, automatic: true })
        const geometry = heatingPipeGeometry(pipe)
        return geometry.bends.every((bend) => bend.radiusMm + .1 >= limits.minBendRadiusMm) && !heatingCurveWallConflict(grid, geometry.pieces, wallAccess)
      })
    const rank = (path: number[]) => {
      let penetrations = 0, turns = 0
      for (let i = 1; i < path.length; i++) {
        if (grid.wall[path[i]] && !grid.door[path[i]] && (!grid.wall[path[i - 1]] || grid.door[path[i - 1]])) penetrations++
        if (i > 1 && path[i] - path[i - 1] !== path[i - 1] - path[i - 2]) turns++
      }
      return [penetrations, turns, path.length]
    }
    candidates.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
    const path = candidates[0] ?? null
    prefixes.set(stem, path); return path
  }
  const tooLongRooms = new Set<string>(), tooLongCircuits = new Set<number>(), bundleOverruns = new Map<string, { excess: number; loopM: number }>()
  type Connection = { index: number; parts: RectShape[]; paths: number[][]; reserved: number[] }
  const accessTail = (root: number, direction: number) => {
    const path = [root], room = grid.room[root], tangent = Math.ceil(radiusCells / 2)
    let outside = 0
    for (let n = 1; n <= Math.max(grid.width, grid.height); n++) {
      const cell = root + direction * n, previous = path.at(-1)!
      if (cell < 0 || cell >= grid.wall.length || Math.abs(cell % grid.width - previous % grid.width) + Math.abs(Math.floor(cell / grid.width) - Math.floor(previous / grid.width)) !== 1 || grid.obstacle[cell] || !heatingWallAllowed(grid, cell, wallAccess) || occupied.has(cell)) return null
      path.push(cell)
      if (grid.room[cell] !== room) outside++; else outside = 0
      if (outside >= tangent && !grid.wall[cell]) return path
    }
    return null
  }
  const accessTails = jobs.map((job) => [accessTail(job.cells[0], job.cells[0] - job.cells[1]), accessTail(job.cells.at(-1)!, job.cells.at(-1)! - job.cells.at(-2)!)])
  const pairingReach = Math.ceil(drawingUnitsForMetres((2 * limits.minBendRadiusMm + settings.spacingMm) / 1000, scale) / grid.step)
  const roomBands = new Map<string, Set<number>>()
  const roomBand = (index: number) => {
    const job = jobs[index], keys = new Set(job.roomMembers?.map((room) => room.key) ?? [job.roomKey ?? job.roomName])
    const key = [...keys].sort().join('|')
    const cached = roomBands.get(key)
    if (cached) return cached
    // A joined coil can start in a doorway (native room id 0), and can serve
    // several rooms. Its corridor belongs to that complete zone, not a lookup
    // of the first endpoint in the original, unmerged room raster.
    const queue = [...new Set([...grid.rooms.filter((room) => keys.has(heatingRoomKey(room))).flatMap((room) => room.cells), ...job.cells])], band = new Set(queue)
    let read = 0, end = queue.length
    for (let n = 0; n < pairingReach; n++) {
      while (read < end) {
        if (read % 4096 === 0) checkpoint()
        const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
        for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) if (next >= 0 && !band.has(next)) { band.add(next); queue.push(next) }
      }
      end = queue.length
    }
    roomBands.set(key, band); return band
  }
  const pair = (index: number, reverse: boolean, returnFirst: boolean, blocked: Set<number>, completed: Connection[], guided = true, viaAccess = false): Connection | null => {
    if (isConnectionZone && guided) return null
    const cells = reverse ? [...jobs[index].cells].reverse() : jobs[index].cells, first = cells[0], last = cells.at(-1)!
    const [aStem, bStem] = stems[index], firstDirection = cells[1] - first, lastDirection = last - cells.at(-2)!
    const inlet = viaAccess ? accessTails[index][reverse ? 1 : 0] : [first], outlet = viaAccess ? accessTails[index][reverse ? 0 : 1] : [last]
    if (!inlet || !outlet) { budget.onRouteFailure?.('portal', grid.point(first)); return null }
    const inletAccess = inlet.at(-1)!, outletAccess = outlet.at(-1)!
    const aPrefix = guided ? prefixFor(aStem) : [aStem[0]], bPrefix = guided ? prefixFor(bStem) : [bStem[0]]
    if (!aPrefix || !bPrefix) { budget.onRouteFailure?.('fan', grid.point(aStem[0])); return null }
    const departure = guided ? fanDirection : aStem[1] - aStem[0]
    const returnDeparture = guided ? fanDirection : bStem[1] - bStem[0]
    const routingGrid = guided ? apronGrid : grid
    const used = new Set(occupied)
    for (const connection of completed) for (const cell of connection.reserved) used.add(cell)
    const localBlocked = guided ? new Set(blocked) : new Set(used)
    if (viaAccess) for (let i = 0; i < jobs.length; i++) if (i !== index) for (const tail of accessTails[i]) if (tail) for (const cell of tail) localBlocked.add(cell)
    if (!guided) for (let i = 0; i < jobs.length; i++) if (i !== index) {
      for (const path of [...escapes[i].slice(2), ...stems[i].map((stem) => stem.slice(0, Math.ceil(radiusCells / 2) + 1))]) for (const cell of path) localBlocked.add(cell)
    }
    for (const stem of [aStem, bStem]) for (const cell of stem) if (!used.has(cell)) localBlocked.delete(cell)
    for (const escape of escapes[index]) for (const cell of escape) if (!used.has(cell) && !stemCells.has(cell)) localBlocked.delete(cell)
    for (const tail of [inlet, outlet]) for (const cell of tail) if (!used.has(cell) && !stemCells.has(cell)) localBlocked.delete(cell)
    if (guided) for (const path of [aPrefix, bPrefix]) for (const cell of path) localBlocked.add(cell)
    const aBlocked = new Set(localBlocked)
    const coilStartEscape = escapes[index][reverse ? 3 : 2], coilEndEscape = escapes[index][reverse ? 2 : 3]
    for (const cell of returnFirst ? [...escapes[index][0], ...coilStartEscape] : [...escapes[index][1], ...coilEndEscape]) aBlocked.add(cell)
    for (const cell of returnFirst ? inlet : outlet) aBlocked.add(cell)
    const aOptions = { ...wallAccess, radiusCells, occupied: aBlocked, checkpoint,
      startDirection: returnFirst ? lastDirection : departure, endDirection: returnFirst ? -returnDeparture : firstDirection }
    checkHeatingDeadline(budget)
    if (--budget.routes < 0) return null
    const a = returnFirst ? routeHeating(routingGrid, outletAccess, bPrefix.at(-1)!, aOptions) : routeHeating(routingGrid, aPrefix.at(-1)!, inletAccess, aOptions)
    if (!a) { budget.onRouteFailure?.('first-route', grid.point(returnFirst ? last : first)); return null }
    const pairedCorridor = heatingRouteCorridor(grid, a, pairingReach)
    const bOptions = { ...wallAccess, radiusCells, occupied: new Set([...localBlocked, ...a]), checkpoint,
      requiredCorridor: pairedCorridor,
      preferredDoors: heatingSharedDoors(grid, [...a, ...inlet, ...outlet]),
      preferredCorridor: heatingRouteCorridor(grid, a, Math.max(2, Math.ceil(drawingUnitsForMetres(settings.diameterMm * .002, scale) / grid.step))),
      startDirection: returnFirst ? departure : lastDirection, endDirection: returnFirst ? firstDirection : -returnDeparture }
    for (const cell of returnFirst ? outlet : inlet) bOptions.occupied.add(cell)
    const secondStart = returnFirst ? aPrefix.at(-1)! : outletAccess, secondEnd = returnFirst ? inletAccess : bPrefix.at(-1)!
    const makeConnection = (b: number[]): Connection | null => {
      const supply = [...aPrefix.slice(0, -1), ...(returnFirst ? b : a), ...inlet.slice(0, -1).reverse()], returning = [...outlet.slice(0, -1), ...(returnFirst ? a : b), ...bPrefix.slice(0, -1).reverse()]
      const loop = reverse ? createHeatingPipe(ids[index][0], openHeatingTurns(jobs[index].points ? [...jobs[index].points!].reverse() : routePoints(cells), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)), coils[index].heating!) : coils[index]
      const parts = [loop, createHeatingPipe(ids[index][1], exactConnectionEnd(routePoints(supply), physicalPort(index, 0), true), { ...common[index], name: `${common[index].circuitId} aanvoer`, pipeRole: 'supply' }),
        createHeatingPipe(ids[index][2], exactConnectionEnd(routePoints(returning), physicalPort(index, 1), false), { ...common[index], name: `${common[index].circuitId} retour`, pipeRole: 'return' })]
      for (const part of parts) {
        const conflict = heatingCurveWallConflict(grid, geometryFor(part).pieces, wallAccess)
        if (conflict) { budget.onRouteFailure?.('wall', conflict, 'Afgeronde leiding raakt een muur buiten de deur of toegestane doorvoer.'); return null }
      }
      if (parts.reduce((sum, part) => sum + drawingLengthMetres(geometryFor(part).length, scale), 0) + limits.allowanceM > limits.maxCircuitLengthM + .05) { budget.onRouteFailure?.('length', grid.point(first)); tooLongRooms.add(jobs[index].roomKey ?? jobs[index].roomName); return null }
      const geometry = checkHeatingPlan([...preserved, ...coils.filter((_, i) => i !== index && !completed.some((c) => c.index === i)), ...completed.flatMap((c) => c.parts), ...parts], [], settings.design, obstacles,
        { focusPipeIds: new Set(parts.map((part) => part.id)), checkpoint, geometryFor, stopOnConflict: true })
      const conflict = geometry.issues.find((issue) => issue.severity === 'error' && ['collision', 'bend', 'obstacle'].includes(issue.code))
      if (conflict) { budget.onRouteFailure?.(conflict.code, conflict.point ?? grid.point(first), conflict.message); return null }
      const reserved = new Set([...supply, ...returning])
      for (const pipe of parts.slice(1)) for (const piece of geometryFor(pipe).pieces) {
        const clearance = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
        const minX = Math.max(0, Math.floor((Math.min(piece.a.x, piece.b.x) - clearance - grid.origin.x) / grid.step)), maxX = Math.min(grid.width - 1, Math.ceil((Math.max(piece.a.x, piece.b.x) + clearance - grid.origin.x) / grid.step))
        const minY = Math.max(0, Math.floor((Math.min(piece.a.y, piece.b.y) - clearance - grid.origin.y) / grid.step)), maxY = Math.min(grid.height - 1, Math.ceil((Math.max(piece.a.y, piece.b.y) + clearance - grid.origin.y) / grid.step))
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const cell = y * grid.width + x
          if (segmentDistance(grid.point(cell), piece.a, piece.b) < clearance - 1e-6) reserved.add(cell)
        }
      }
      tooLongRooms.delete(jobs[index].roomKey ?? jobs[index].roomName)
      return { index, parts, paths: [supply, returning], reserved: [...reserved] }
    }
    for (const mode of ['paired', 'room'] as const) {
      if (mode === 'room') {
        for (const cell of roomBand(index)) pairedCorridor.add(cell)
      }
      if (budget.routes <= 0) return null
      budget.routes--
      const b = routeHeating(routingGrid, secondStart, secondEnd, bOptions)
      if (b) {
        const connection = makeConnection(b)
        if (connection) return connection
      } else budget.onRouteFailure?.('second-route', grid.point(secondStart))
    }
    return null
  }

  let bundleTried = false
  const bundleConnections = (): Connection[] | null => {
    bundleTried = true
    budget.onConnectionCandidate?.([], coils, jobs)
    const reach = Math.ceil(radiusCells / 2)
    const sourceStubs = (zone?.stubs ?? stems.flat().map((stem) => Array.from({ length: reach + 1 }, (_, n) => stem[0] + outward * n * grid.width)))
      .filter((stub) => stub.every((cell, i) => cell >= 0 && !grid.obstacle[cell] && heatingWallAllowed(grid, cell, wallAccess) && ((!isConnectionZone && !i) || !occupied.has(cell))))
    if (sourceStubs.length < jobs.length * 2) { budget.onRouteFailure?.('bundle-sources', position, `${sourceStubs.length} vrije uiteinden voor ${jobs.length * 2} leidingen`); return null }
    const targetStubs = jobs.flatMap((job, index) => [[job.cells[0], ...escapes[index][2]], [job.cells.at(-1)!, ...escapes[index][3]]])
    const blocked = grid.obstacle.slice(), immutable = new Set<number>()
    if (zone) for (const cell of zone.interior) blocked[cell] = 1
    for (const cell of occupied) if (cell >= 0) blocked[cell] = 1
    for (const stub of [...sourceStubs, ...targetStubs]) {
      if (stub.some((cell, i) => cell < 0 || grid.obstacle[cell] || !heatingWallAllowed(grid, cell, wallAccess) || i > 0 && occupied.has(cell))) { budget.onRouteFailure?.('bundle-tangent', grid.point(stub[0]), 'Een rechte aansluiting is geblokkeerd.'); return null }
      for (const cell of stub.slice(0, -1)) { blocked[cell] = 1; immutable.add(cell) }
    }
    const sources = sourceStubs.map((stub) => stub.at(-1)!), goals = targetStubs.map((stub) => stub.at(-1)!)
    for (const cell of [...sources, ...goals]) if (blocked[cell]) { budget.onRouteFailure?.('bundle-overlap', grid.point(cell), 'Rechte aansluitingen overlappen elkaar.'); return null }
    for (let trial = 0; trial < 3; trial++) {
      checkpoint()
      if (budget.routes < goals.length) return null
      budget.routes -= goals.length
      const paths = routeHeatingBundle(grid, sources, goals, blocked, { ...wallAccess, checkpoint, onBlocked: (targets) => targets.forEach((target) => { const index = Math.floor(target / 2); budget.patternFallbackRooms?.add(jobs[index].roomKey ?? jobs[index].roomName); budget.onRouteFailure?.('bundle-entry', grid.point(goals[target]), `${common[index].circuitId}: ${target % 2 ? 'retour' : 'aanvoer'} niet bereikbaar`) }) }, (done) =>
        budget.onProgress?.({ phase: 'connections', circuits: jobs.length, completedCircuits: Math.floor(done / 2), attempt: lengthPass * 8 + mergeVariant + 1 }))
      if (!paths) return null
      const fullPaths = paths.map((path, goal) => [...sourceStubs[path.source].slice(0, -1), ...path.cells, ...targetStubs[goal].slice(0, -1).reverse()])
      // Flow establishes a complete non-crossing bundle, but its individual
      // square steps have no bend-radius constraint. Re-route each tube with
      // direction-aware rays while retaining every other tube's corridor.
      for (let goal = 0; goal < fullPaths.length && budget.routes > 0; goal++) {
        checkpoint(); budget.routes--
        const path = fullPaths[goal], others = new Set(occupied)
        for (let other = 0; other < fullPaths.length; other++) if (other !== goal) for (const cell of fullPaths[other]) others.add(cell)
        const source = sourceStubs[paths[goal].source], target = targetStubs[goal]
        const refined = routeHeating(grid, path[0], path.at(-1)!, { ...wallAccess, radiusCells, occupied: others, checkpoint,
          startDirection: source.length > 1 ? source[1] - source[0] : path[1] - path[0], endDirection: target[0] - target[1] })
        if (refined) fullPaths[goal] = refined
      }
      const connections: Connection[] = []
      for (let index = 0; index < jobs.length; index++) {
        const routes = fullPaths.slice(index * 2, index * 2 + 2), parts = [coils[index]]
        for (let role = 0; role < 2; role++) {
          const cells = role ? [...routes[role]].reverse() : routes[role], own = new Set(cells)
          // All feeds are rounded together below. Their unrounded square
          // corners are not physical obstacles; the final curve audit rejects
          // any actual crossing after both neighbouring paths are smoothed.
          const free = (p: Point) => { const cell = grid.index(p); return cell >= 0 && !grid.obstacle[cell] && (!occupied.has(cell) || own.has(cell)) }
          const points = openHeatingTurns(softenHeatingJogs(routePoints(cells), radius, free, grid.step), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale))
          parts.push(createHeatingPipe(ids[index][role + 1], exactConnectionEnd(points, physicalPort(index, role, routes[role][0]), !role), { ...common[index], name: `${common[index].circuitId} ${role ? 'retour' : 'aanvoer'}`, pipeRole: role ? 'return' : 'supply' }))
        }
        budget.onConnectionCandidate?.(parts, coils)
        const length = parts.reduce((sum, part) => sum + drawingLengthMetres(geometryFor(part).length, scale), 0) + limits.allowanceM
        if (length > limits.maxCircuitLengthM + .05) {
          const key = jobs[index].roomKey ?? jobs[index].roomName, excess = length - limits.maxCircuitLengthM
          tooLongCircuits.add(index); tooLongRooms.add(key)
          if (excess > (bundleOverruns.get(key)?.excess ?? 0)) bundleOverruns.set(key, { excess, loopM: drawingLengthMetres(geometryFor(coils[index]).length, scale) })
          budget.onRouteFailure?.('length', grid.point(jobs[index].cells[0]), `${common[index].circuitId}: ${length.toFixed(1)} m, grens ${limits.maxCircuitLengthM} m`)
        }
        connections.push({ index, parts, paths: [routes[0], [...routes[1]].reverse()], reserved: [...routes[0], ...routes[1]] })
      }
      if (bundleOverruns.size) return null
      const newParts = connections.flatMap((c) => c.parts.slice(1))
      const audit = checkHeatingPlan([...preserved, ...coils, ...newParts], [], settings.design, obstacles, { focusPipeIds: new Set(newParts.map((p) => p.id)), checkpoint, geometryFor })
      const errors = audit.issues.filter((issue) => issue.severity === 'error' && ['collision', 'bend', 'obstacle'].includes(issue.code))
      for (const part of [...coils, ...newParts]) {
        const point = heatingCurveWallConflict(grid, geometryFor(part).pieces, wallAccess)
        if (point) errors.push({ code: 'wall', severity: 'error', circuits: [part.heating!.circuitId!], point, message: 'Afgeronde leiding kruist een muur buiten de toegestane opening.' })
      }
      if (!errors.length) {
        if (!isConnectionZone) connections.forEach((connection) => { for (const offset of [0, 1]) {
          const source = sourceStubs[paths[connection.index * 2 + offset].source][0], p = physicalPort(connection.index, offset, source)
          manifold.heating!.points![freePorts[connection.index] * 2 + offset] = { x: (p.x - position.x) / width, y: (p.y - position.y) / (bottom - position.y) }
        } })
        return connections
      }
      let changed = false
      for (const issue of errors) {
        if (!issue.point) continue
        budget.onRouteFailure?.(issue.code, issue.point)
        let nearest = -1, distance = Infinity
        for (const path of fullPaths) for (const cell of path) {
          if (immutable.has(cell) || sources.includes(cell) || goals.includes(cell) || blocked[cell]) continue
          const p = grid.point(cell), d = Math.hypot(p.x - issue.point.x, p.y - issue.point.y)
          if (d < distance) { distance = d; nearest = cell }
        }
        if (nearest >= 0) { blocked[nearest] = 1; changed = true }
      }
      if (!changed) return null
    }
    return null
  }

  // Backtrack whole pairs when a greedy connection blocks the next circuit.
  // Validation checks the rendered curves, not just orthogonal grid centre lines.
  budget.onProgress?.({ phase: 'connections', circuits: jobs.length, completedCircuits: 0, attempt: lengthPass * 8 + mergeVariant + 1 })
  let attempts = 0, furthestConnection = 0
  const failed = new Set<string>()
  const byDistance = jobs.map((job, index) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const cell of job.cells) {
      const point = grid.point(cell)
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
    }
    return { index, distance: Math.hypot(Math.max(0, minX - position.x, position.x - maxX), Math.max(0, minY - position.y, position.y - maxY)) }
  }).sort((a, b) => b.distance - a.distance || a.index - b.index).map(({ index }) => index)
  const ascending = jobs.map((_, index) => index)
  const byLength = [...ascending].sort((a, b) => Number(tooLongCircuits.has(b)) - Number(tooLongCircuits.has(a)) || geometryFor(coils[b]).length - geometryFor(coils[a]).length)
  const sharedBundle = isConnectionZone && jobs.some((job) => (job.roomMembers?.length ?? 0) > 1)
  let connections: Connection[] | null = !jobs.length ? [] : sharedBundle ? bundleConnections() : null
  if (!connections && bundleOverruns.size) {
    const retries = budget.lengthRetries ??= new Map(), allowances = budget.leadAllowances ??= {}
    let changed = false
    for (const [room, { excess }] of bundleOverruns) {
      const count = retries.get(room) ?? 0
      if (count >= 2) continue
      // Transfer the measured routing excess to a neighbouring field. Changing
      // only an area factor left the same balanced cut unchanged, or created
      // extra circuits. The complete-length cost must include this allowance.
      allowances[room] = (allowances[room] ?? 0) + excess + .5
      retries.set(room, count + 1); changed = true
    }
    if (changed) return { retry: { lengthPass, mergeVariant } }
  }
  const remainingLayouts = Math.max(1, MAX_HEATING_LAYOUTS - (search?.layouts.size ?? 1) + 1)
  const layoutQuota = Math.max(jobs.length * 8, Math.floor(budget.routes / remainingLayouts))
  const layoutFloor = Math.max(0, budget.routes - layoutQuota)
  let routeFloor = layoutFloor
  byLength.sort((a, b) => Number(tooLongCircuits.has(b)) - Number(tooLongCircuits.has(a)))
  const pairCache = new Map<string, Connection | null>()
  for (const order of connections ? [] : [byLength, byDistance, ascending, [...ascending].reverse()]) {
    // A promising prefix needs enough work to finish every room. Dividing the
    // layout quota into thirds stopped a valid sequence after four circuits,
    // then discarded it before even trying the next room.
    routeFloor = layoutFloor
    // Retry only the current and preceding room. Do not revisit all the completed
    // rooms whenever one new connection fails: that search grows exponentially.
    let roomNumber = -1, previousRoom = -1, furthestRoom = 0
    const roomNumbers = order.map((index) => {
      const room = grid.room[jobs[index].cells[0]]
      if (room !== previousRoom) { roomNumber++; previousRoom = room }
      return roomNumber
    })
    const search = (offset: number, blocked: Set<number>, completed: Connection[], decisions: string): Connection[] | null => {
      checkHeatingDeadline(budget)
      if (completed.length > furthestConnection) {
        furthestConnection = completed.length
        budget.onProgress?.({ phase: 'connections', circuits: jobs.length, completedCircuits: completed.length,
          roomName: jobs[order[Math.min(offset, order.length - 1)]].roomName, attempt: lengthPass * 8 + mergeVariant + 1 })
      }
      if (offset === order.length) return [...completed]
      furthestRoom = Math.max(furthestRoom, roomNumbers[offset])
      if (failed.has(decisions) || budget.routes <= routeFloor || (tooLongRooms.size && attempts >= Math.max(12, jobs.length * 2))) return null
      const index = order[offset]
      for (const reverse of [true, false]) for (const returnFirst of [false, true]) {
        if (roomNumbers[offset] < furthestRoom - 1 || ++attempts > 240) return null
        const decision = `${decisions}/${index}:${+reverse}${+returnFirst}`
        let connection: Connection | null
        if (pairCache.has(decision)) connection = pairCache.get(decision)!
        else {
          connection = pair(index, reverse, returnFirst, blocked, completed, true, true) ?? pair(index, reverse, returnFirst, blocked, completed, false, true) ??
            pair(index, reverse, returnFirst, blocked, completed) ?? pair(index, reverse, returnFirst, blocked, completed, false)
          pairCache.set(decision, connection)
          if (pairCache.size > 128) pairCache.delete(pairCache.keys().next().value!)
        }
        if (!connection) continue
        // Mutate and undo the occupied mask instead of retaining a full copy of
        // every completed route at each level of the search tree.
        const added: number[] = []
        for (const cell of connection.reserved) if (!blocked.has(cell)) { blocked.add(cell); added.push(cell) }
        completed.push(connection)
        const result = search(offset + 1, blocked, completed, decision)
        completed.pop()
        for (const cell of added) blocked.delete(cell)
        if (result) return result
      }
      failed.add(decisions)
      return null
    }
    attempts = 0
    // A decision prefix uniquely determines deterministic routes; storing all
    // their cell coordinates in a fingerprint wastes memory without adding state.
    failed.clear()
    connections = search(0, baseOccupied, [], '')
    if (connections) break
  }
  if (!connections && !bundleTried && jobs.length >= 2 && budget.routes >= jobs.length * 2) connections = bundleConnections()
  if (!connections && search) {
    let failedJob = jobs[byDistance[Math.min(furthestConnection, byDistance.length - 1)]]
    const point = budget.lastRouteFailure?.point
    if (point) {
      let nearest = Infinity
      for (const job of jobs) for (const cell of job.cells) {
        const p = grid.point(cell), distance = Math.abs(p.x - point.x) + Math.abs(p.y - point.y)
        if (distance < nearest) { nearest = distance; failedJob = job }
      }
    }
    budget.patternFallbackRooms?.add(failedJob.roomKey ?? failedJob.roomName)
    for (const room of tooLongRooms) budget.patternFallbackRooms?.add(room)
    const failedRoom = failedJob.roomName
    search.lastFailure = `${failedRoom}: geen kruisingsvrije aansluiting gevonden met R${limits.minBendRadiusMm}. Controleer de vrije ruimte bij de verdeler en de doorgang naar deze ruimte.`
  }
  if (!connections && mergeVariant >= 3 && !budget.wallFallbackTried) {
    budget.wallFallbackTried = true
    const target = budget.lastRouteFailure?.point
    if (target) {
      const passage = heatingFallbackPassage(template, position, target, scale)
      if (passage) {
        budget.wallPassage = passage; budget.leadDistances = undefined; budget.roomCandidates?.clear()
        return { retry: { lengthPass, mergeVariant: 0 } }
      }
    }
  }
  if (!connections && budget.routes <= 0) throw new Error(search?.lastFailure ?? 'Geen passende aansluiting gevonden binnen deze indeling. Kies een vrijere verdelerpositie of verdeel het grondplan over meerdere verdelers.')
  if (!connections && !budget.reserveAccess && budget.routes > 40) {
    budget.accessTargets = jobs.map((job) => grid.point(job.cells[0]))
    budget.reserveAccess = true
    return { retry: { lengthPass, mergeVariant } }
  }
  if (!connections && budget.loopFactors && budget.lastSplitVariant !== `${lengthPass}:${mergeVariant}`) {
    for (const room of tooLongRooms) {
      const previous = budget.loopFactors[room] ?? 1
      if (previous > .55) { budget.loopFactors[room] = previous * .8; budget.lastSplitVariant = `${lengthPass}:${mergeVariant}`; return { retry: { lengthPass, mergeVariant } } }
    }
  }
  if (!connections && mergeVariant < 7) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
  if (!connections && lengthPass < 3) return { retry: { lengthPass: lengthPass + 1, mergeVariant: 0 } }
  if (!connections) throw new Error('Geen kruisingsvrije aansluitingen met deze buigradius gevonden. Kies een vrijere verdelerpositie of verdeel het plan over meer verdelers.')
  let wallCrossings = 0
  const markedPassages = new Set<string>()
  const markCrossings = (circuitId: string, paths: number[][]) => {
    for (const path of paths) {
      let insideWall = false
      for (const cell of path) {
        const crossing = Boolean(grid.wall[cell] && !grid.door[cell])
        if (crossing && !insideWall) {
          const p = budget.wallPassage?.cells.has(cell) ? budget.wallPassage.point : grid.point(cell)
          const key = `${p.x}:${p.y}`
          if (markedPassages.has(key)) { insideWall = true; continue }
          markedPassages.add(key)
          shapes.push({ id: nextId(), kind: 'rect', start: { x: p.x - 4, y: p.y - 4 }, end: { x: p.x + 4, y: p.y + 4 }, variant: 'circle',
            fill: 'white', stroke: '#b42318', strokeWidth: 1, generationKey: `heating-penetration:${circuitId}:${wallCrossings++}` })
        }
        insideWall = crossing
      }
    }
  }
  for (const connection of connections) {
    shapes.push(...connection.parts)
    markCrossings(common[connection.index].circuitId, connection.paths)
  }
  // Locked trajectories are retained, including their physical wall crossings.
  // Rebuild these annotations from the curves rather than losing them on a
  // room-only recalculation or retaining markers for deleted trajectories.
  for (const pipe of preserved) if (pipe.heating!.pipeRole !== 'loop') {
    const cells: number[] = []
    for (const piece of geometryFor(pipe).pieces) {
      const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / grid.step))
      for (let i = 0; i <= n; i++) cells.push(grid.index({ x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n }))
    }
    markCrossings(pipe.heating!.circuitId!, [cells])
  }
  if (isConnectionZone) {
    const endpoints = connections.flatMap((connection) => connection.parts.filter((part) => part.heating!.pipeRole !== 'loop').map((part) => {
      const points = geometryFor(part).points
      return part.heating!.pipeRole === 'supply' ? points[0] : points.at(-1)!
    }))
    manifold.heating!.connectionZoneRadiusMm = Math.max(zone!.radiusMm, budget.existingManifold?.heating?.connectionZoneRadiusMm ?? 0,
      ...endpoints.map((p) => Math.ceil(drawingLengthMetres(Math.hypot(p.x - position.x, p.y - position.y), scale) * 1000 / 50) * 50))
    delete manifold.heating!.points
  }
  const measured = measureHeatingCoverage(coverageGrid, shapes.filter((shape) => shape.heating?.kind === 'pipe'), scale, settings.spacingMm, settings.edgeMm, checkpoint)
  manifold.heating!.coverage = measured.coverage
  manifold.heating!.wallPassages = wallCrossings
  manifold.heating!.coverage.signature = heatingCoverageSignature([...scene, ...shapes])
  for (const pipe of shapes) if (pipe.heating?.kind === 'pipe') {
    const areas = measured.areaByRoomCircuit.get(pipe.heating.circuitId!)
    const controlledRooms = new Set(pipe.heating.roomMembers?.map((r) => r.key) ?? (pipe.heating.roomKey ? [pipe.heating.roomKey] : []))
    const members = coverageGrid.rooms.flatMap((room) => controlledRooms.has(heatingRoomKey(room)) && (areas?.get(heatingRoomKey(room)) ?? 0) > .001 ? [{ key: heatingRoomKey(room), name: room.name, areaM2: areas!.get(heatingRoomKey(room))! }] : [])
    if (members.length) pipe.heating = { ...pipe.heating, roomMembers: members, roomKey: members[0].key, roomName: members.map((r) => r.name).join(' / ') }
    if (pipe.heating.pipeRole !== 'loop') continue
    const spacing = measured.spacingByCircuit.get(pipe.heating.circuitId!)
    pipe.heating = { ...pipe.heating, servedAreaM2: members.length ? members.reduce((sum, member) => sum + member.areaM2, 0) : measured.areaByCircuit.get(pipe.heating.circuitId!) ?? 0,
      ...(spacing ? { spacingMinMm: spacing.min, spacingMaxMm: spacing.max } : {}) }
  }
  let rows = heatingSchedule(shapes)
  if (lengthPass < 3 && rows.some((row) => (row.cutM ?? row.totalM) > limits.maxCircuitLengthM + .05)) {
    return { retry: { lengthPass: lengthPass + 1, mergeVariant: 0 } }
  }
  budget.onProgress?.({ phase: 'checks', circuits: rows.length })
  const audit = checkHeatingPlan([...scene, ...shapes], rows, settings.design,
    heatingObstacleBounds(scene, shapeBounds), { checkpoint, geometryFor })
  for (const shape of shapes) if (shape.heating?.kind === 'pipe' && !preserved.some((pipe) => pipe.id === shape.id)) {
    const point = heatingCurveWallConflict(grid, geometryFor(shape).pieces, wallAccess)
    if (point) throw new Error(`Geen geldig aansluittraject: ${shape.heating.circuitId} raakt een muur buiten een deur of toegestane doorvoer.`)
  }
  const invalidGeometry = audit.issues.find((issue) => issue.severity === 'error' && ['collision', 'bend', 'obstacle', 'continuity', 'length', 'capacity'].includes(issue.code))
  if (invalidGeometry) throw new Error(`Geen geometrisch geldig legplan: ${invalidGeometry.message}`)
  rows = rows.map((row) => ({ ...row, checkMessages: audit.issues.filter((issue) => issue.circuits.includes(row.id)).map((issue) => issue.message) }))
  manifold.heating!.audit = audit; manifold.heating!.rows = rows
  for (const shape of shapes) if (shape.heating?.pipeRole === 'loop') shape.heating.checks = audit.issues.filter((issue) => issue.circuits.includes(shape.heating!.circuitId!))
  const maxRows = Math.max(1, Math.floor((1384 - heatingTableSize(0).height) / HEATING_TABLE_ROW_HEIGHT))
  const tableSize = heatingTableSize(rows.length)
  const collisions = [...scene.filter((shape) => !shape.hidden && shape.kind !== 'image'), ...shapes].map(shapeBounds)
  const candidates = [
    { x: pageArea.x + pageArea.width - tableSize.width, y: pageArea.y + pageArea.height - tableSize.height },
    { x: pageArea.x, y: pageArea.y + pageArea.height - tableSize.height },
    { x: pageArea.x + pageArea.width - tableSize.width, y: pageArea.y },
    { x: pageArea.x, y: pageArea.y }
  ]
  const fits = rows.length <= maxRows && candidates.find((p) => p.x >= pageArea.x && p.y >= pageArea.y && p.x + tableSize.width <= pageArea.x + pageArea.width &&
    p.y + tableSize.height <= pageArea.y + pageArea.height && !collisions.some((b) => p.x < b.x + b.width + 24 && p.x + tableSize.width > b.x - 24 &&
      p.y < b.y + b.height + 24 && p.y + tableSize.height > b.y - 24))
  const tablePosition = fits || { x: 80, y: 80 }
  shapes.push(...createHeatingScheduleTables(rows, { ...heatingDefaults('table', scale), ...settings, pattern: manifold.heating!.pattern, name: 'Kringentabel', audit }, nextId, tablePosition))
  return { shapes, rows, tableOnSeparatePage: !fits, wallCrossings }
}


/** Each unsuccessful layout is released before the next variant starts. Recursive
 * retries would retain its grid overlays, paths and search sets on the call stack. */
export const generateAutomaticHeatingPlan = (scene: readonly Shape[], position: Point, settings: AutomaticHeatingSettings,
  scale: DrawingScale, nextId: () => string, pageArea: { x: number; y: number; width: number; height: number },
  lengthPass = 0, mergeVariant = 0, budget: HeatingWorkBudget = { routes: 600 }): AutomaticHeatingResult => {
  const search: HeatingSearch = { layouts: new Set() }
  const work: HeatingWorkBudget = { ...budget, patternFallbackRooms: new Set(budget.patternFallbackRooms), loopFactors: {}, deadline: budget.deadline ?? Date.now() + 30000,
    onRouteFailure: (reason, point, detail) => { work.lastRouteFailure = { reason, point, detail }; budget.onRouteFailure?.(reason, point, detail) },
    onProgress: (value) => budget.onProgress?.({ ...value, layoutLimit: MAX_HEATING_LAYOUTS,
      attempt: Math.min(MAX_HEATING_LAYOUTS, value.phase === 'circuits' ? search.layouts.size + 1 : Math.max(1, search.layouts.size)) }) }
  let best: AutomaticHeatingResult | undefined, validLayouts = 0
  for (;;) {
    let result: AutomaticHeatingResult | { retry: HeatingRetry }
    try {
      result = generateHeatingAttempt(scene, position, settings, scale, nextId, pageArea, lengthPass, mergeVariant, work, search)
    } catch (error) {
      if (best) return best
      if (!(error instanceof HeatingPlanningFailure) && work.diagnostics) {
        const message = error instanceof Error ? error.message : 'Geen geldig legplan gevonden.'
        const code = /rekentijd|te lang/i.test(message) ? 'timeout' : /verdeler.*symbool|overlapt|vrije positie/i.test(message) ? 'placement' : /vloer|slakkenhuis|legpatroon/i.test(message) ? 'coverage' : 'connection'
        const last = work.lastRouteFailure, reason = last ? ({ wall: 'muur buiten de toegestane opening', collision: 'buisbotsing', bend: 'te kleine bocht', obstacle: 'voorwerp in het traject', length: 'kringlengte overschreden', portal: 'geen vrije uitloop uit het legvlak', fan: 'onvoldoende plaats aan de verdeler', 'first-route': 'geen vrije eerste aansluiting', 'second-route': 'geen vrije tweede aansluiting', 'bundle-entry': 'onvoldoende vrije doorgang naar de lus' }[last.reason] ?? last.reason) : undefined
        throw new HeatingPlanningFailure(message, { ...work.diagnostics, code, issues: [{ message, point: work.diagnostics.point }, ...(last && reason ? [{ message: `Laatste afgewezen aansluittraject: ${reason}.${last.detail ? ` ${last.detail}.` : ''}`, point: last.point }] : [])] })
      }
      throw error
    }
    if (!('retry' in result)) {
      if (result.shapes.find((shape) => shape.heating?.kind === 'manifold')?.heating?.pattern === 'spiral') work.patternFallbackRooms?.clear()
      if (!best) work.deadline = Math.min(work.deadline, Date.now() + 750)
      if (!best || isBetterPlan(result, best)) best = result
      validLayouts++
      // Compare real, complete solutions while keeping a bounded interactive
      // search. Never discard a valid result when a later alternative times out.
      if (validLayouts >= 3 || search.layouts.size >= MAX_HEATING_LAYOUTS || work.routes < 80 || Date.now() + 50 >= work.deadline || mergeVariant >= 7 ||
        (work.preserved?.length && result.shapes.filter((s) => s.heating?.kind === 'pipe').length === work.preserved.length)) return best
      mergeVariant++; work.loopFactors = {}
      continue
    }
    if (lengthPass !== result.retry.lengthPass || mergeVariant !== result.retry.mergeVariant) work.loopFactors = {}
    lengthPass = result.retry.lengthPass
    mergeVariant = result.retry.mergeVariant
  }
}
