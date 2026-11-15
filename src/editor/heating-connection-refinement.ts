import type { Point, RectShape, Shape } from './model/types.js'
import type { DrawingScale } from './layout/drawing-scale.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { createHeatingPipe, heatingPipeData } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { openHeatingTurns } from './heating-pattern-geometry.js'
import { heatingFieldFootprintMask } from './heating-routing-domain.js'
import { routePairedHeatingFeeds, heatingFeedPairCoherent } from './heating-paired-route.js'
import { shiftHeatingApproachLanes } from './heating-approach-lanes.js'
import { bringHeatingSourceEndInside } from './heating-source-ends.js'
import { routeDoorAdaptedHeatingFeeds, type HeatingDoorAdapterWork } from './heating-door-adapter.js'
import { heatingDoorSymbolThreshold, isHeatingDoorSymbol } from './heating-openings.js'
import { heatingFeedGrid } from './heating-feed-grid.js'
import { heatingEntrySealsOtherLaunch } from './heating-entry-enclosure.js'
import { heatingSourceShortcutRooms } from './heating-wall-policy.js'
import { heatingCurveWallConflict, heatingPathPoints, heatingRouteCorridor, heatingSharedDoors, heatingWallAllowed, routeHeating, simplifyHeatingPath, type HeatingRoutingOptions, type HeatingGrid } from './heating-routing.js'

type Settings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }
type Box = { x: number; y: number; width: number; height: number }
type RefinementSnapshot = { paths: number[][]; points: Point[][]; sources: number[]; bendRadiusMm: number[]; refined: number[];
  failures: { goal: number; reason: string; point?: Point; detail?: string }[] }
type PriorityNode = { routes: RefinementSnapshot; edges: [number, number][]; errors: number; cost: number; safeGoals: number; conflict?: [number, number] }
type SeedWork = { strategy?: string; order: number[]; next: number; routes: RefinementSnapshot }
type PriorityWork = { rootDone: number; rootPolicy?: string; root?: RefinementSnapshot; queue: PriorityNode[]; seen: string[]; expanded: number;
  bestSeed?: { routes: RefinementSnapshot; completed: number; blocked: number };
  seedPolicy?: string; seeded?: boolean; pendingSeeds?: SeedWork[]; triedSeeds?: string[]; seed?: SeedWork;
  active?: { node: PriorityNode; branch: number; candidate?: RefinementSnapshot; edges?: [number, number][]; affected?: number[]; next?: number }; solution?: RefinementSnapshot }
type RouteWork = { key: string; tried: string[]; rejectedSearches?: string[]; avoid: Point[]; failure?: RefinementSnapshot['failures'][number];
  result?: { path: number[]; points: Point[]; source: number; radius: number } }
/** Interior coil changes need not invalidate an unchanged pair of entrances.
 * This key only selects a hint; every reused tube is still physically audited
 * against all current coils, walls, obstacles and the native source room. */
export const heatingConnectionEntryKey = (points: readonly Point[]): string => {
  if (points.length < 2) return ''
  const entry = (head: Point, next: Point) => {
    const length = Math.hypot(next.x - head.x, next.y - head.y)
    return length > 1e-8 ? [head.x, head.y, (next.x - head.x) / length, (next.y - head.y) / length]
      .map((value) => Math.round(value * 1e7) / 1e7) : null
  }
  const ends = [entry(points[0], points[1]), entry(points.at(-1)!, points.at(-2)!)]
  return ends.every(Boolean) ? JSON.stringify(ends) : ''
}
export type HeatingConnectionRefinementState = { fineGrid?: HeatingGrid; priority?: PriorityWork; best?: RefinementSnapshot; bendRadiusMm?: number[]; pass?: number; order?: number[]; triedOrders?: string[]; paths?: number[][]; points?: Point[][]; sources?: number[]; refined?: number[];
  warmPairs?: { coilKey: string; points: Point[][]; bendRadiusMm: number[] }[];
  doorAdapters?: { key: string; work: HeatingDoorAdapterWork }[];
  doorEntries?: { key: string; pipes: RectShape[] }[];
  pairedProbes?: { key: string; remaining: number }[];
  pairedWork?: { key: string; rejected: string[] }[]; routeWork?: RouteWork[]; routeAttempts?: number; failures?: { goal: number; reason: string; point?: Point; detail?: string }[] }

/** Refine a complete topological flow against physical tube curves. The square
 * control legs of neighbouring fillets are not additional solid obstacles.
 * Each route uses the coil endpoint's grid phase, preserving its exact R80
 * geometry and leaving its other end open in the distributor zone. */
export const refineHeatingConnectionBundle = (grid: HeatingGrid, flows: readonly { source: number; cells: number[] }[],
  sourceStubs: number[][], targetStubs: number[][], coils: RectShape[], settings: Settings, scale: DrawingScale,
  options: { scene?: readonly Shape[]; nativeFloor?: HeatingGrid; nativeWallCells?: ReadonlySet<number>; fineGrid?: boolean; state?: HeatingConnectionRefinementState; routeOptions?: Pick<HeatingRoutingOptions, 'wallEntryPenalty' | 'manifoldAccess' | 'preferredDoors'>; sourcePosition?: Point; sourceRadiusMm?: number; permittedWallCells: ReadonlySet<number>; obstacles?: readonly Box[]; preserved?: readonly RectShape[];
    checkpoint?: () => void; onProgress?: (completed: number, prepared?: number, routeAttempt?: number) => void;
    /** Inspect a physically proved independent pair before routing later roots.
     * Returning false requests repartitioning from its measured lead lengths. */
    onPreparedPair?: (circuit: number, feeds: readonly RectShape[]) => boolean }): { paths: number[][]; points: Point[][]; sources: number[]; bendRadiusMm: number[]; refined: number[]; failures: NonNullable<HeatingConnectionRefinementState['failures']> } => {
  // Keep thermal allocation on its compact raster, but let closely spaced
  // feeds use a 10 mm search lattice. Physical tube envelopes remain decisive.
  if (!options.fineGrid && coils.length > 1 && grid.step * scale / 8 > 10.01 && grid.wall.length * 4 <= 3600000) {
    const state = options.state ?? {}, width = (grid.width - 1) * 2 + 1
    let fine = state.fineGrid
    if (!fine) state.fineGrid = fine = heatingFeedGrid(grid, scale, options.checkpoint)
    const convert = (cells: readonly number[]) => {
      const result: number[] = []
      for (let i = 0; i < cells.length; i++) {
        const a = grid.point(cells[Math.max(0, i - 1)]), b = grid.point(cells[i])
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / fine!.step))
        for (let n = i ? 1 : 0; n <= count; n++) {
          const cell = fine!.index({ x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count })
          if (cell >= 0 && result.at(-1) !== cell) result.push(cell)
        }
      }
      return result
    }
    const convertMask = (cells: ReadonlySet<number>) => {
      const result = new Set<number>()
      for (const cell of cells) {
        const x = cell % grid.width * 2, y = Math.floor(cell / grid.width) * 2
        for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) if (x + dx >= 0 && y + dy >= 0) result.add((y + dy) * width + x + dx)
      }
      return result
    }
    const permitted = convertMask(options.permittedWallCells), originalOptions = options.routeOptions
    const routeOptions = originalOptions ? { ...originalOptions,
      ...(originalOptions.wallEntryPenalty === undefined ? {} : { wallEntryPenalty: originalOptions.wallEntryPenalty * 2 }),
      ...(originalOptions.manifoldAccess ? { manifoldAccess: { ...originalOptions.manifoldAccess, entryPenalty: originalOptions.manifoldAccess.entryPenalty * 2 } } : {}),
      ...(originalOptions.preferredDoors ? { preferredDoors: convertMask(originalOptions.preferredDoors) } : {}) } : undefined
    const result = refineHeatingConnectionBundle(fine, flows.map((flow) => ({ ...flow, cells: convert(flow.cells) })),
      sourceStubs.map(convert), targetStubs.map(convert), coils, settings, scale,
      { ...options, routeOptions, nativeFloor: grid, nativeWallCells: options.permittedWallCells, fineGrid: true, state, permittedWallCells: permitted })
    return { ...result, paths: result.paths.map((path) => path.map((cell) => grid.index(fine!.point(cell))).filter((cell, i, all) => cell >= 0 && (!i || cell !== all[i - 1]))) }
  }
  const checkpoint = options.checkpoint ?? (() => {}), limits = heatingDesignLimits(settings.diameterMm, settings.design)
  // Shapes are immutable during this refinement call: installing a route
  // creates a new pipe. Reuse the fixed coils' sampled curves across local
  // audits instead of rebuilding them for every candidate lane shift.
  const geometry = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (pipe: RectShape) => {
    let value = geometry.get(pipe)
    if (!value) { value = heatingPipeGeometry(pipe); geometry.set(pipe, value) }
    return value
  }
  const auditHeatingPlan = (...args: Parameters<typeof checkHeatingPlan>) => {
    args[4] = { ...args[4], geometryFor }
    return checkHeatingPlan(...args)
  }
  const searchWeight = coils.length >= 4 ? 1.25 : 1
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale), radiusCells = Math.ceil(2 * radius / grid.step)
  const baseWalls = { ...options.routeOptions, allowWalls: true, permittedWallCells: options.permittedWallCells }
  const sourceCell = options.sourcePosition ? grid.index(options.sourcePosition) : -1
  const sourceRooms = new Map<number, number>()
  for (const stub of sourceStubs) { const room = grid.room[stub[0]]; if (room > 0) sourceRooms.set(room, (sourceRooms.get(room) ?? 0) + 1) }
  const sourceRoomId = grid.room[sourceCell] > 0 ? grid.room[sourceCell] : [...sourceRooms].sort((a, b) => b[1] - a[1])[0]?.[0]
  const nativeFloor = options.nativeFloor ?? grid, nativeWalls = options.nativeWallCells ?? options.permittedWallCells
  const sourceShortcuts = options.sourcePosition ? heatingSourceShortcutRooms(nativeFloor, options.sourcePosition, nativeWalls, scale) : new Set<number>()
  // Compute static adapter context once per refinement call. Images and
  // unrelated annotation payloads never enter the routing cache key.
  const adapterContext = options.scene ? JSON.stringify([settings, scale, options.sourcePosition, options.sourceRadiusMm,
    nativeFloor.origin, nativeFloor.step, nativeFloor.width, nativeFloor.height, options.obstacles,
    options.scene.flatMap<unknown[]>((shape) => {
      if (shape.hidden) return []
      if (shape.kind === 'wall') return [[shape.kind, shape.start, shape.end, shape.strokeWidth]]
      if (shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate') return [[shape.kind, shape.start, shape.end]]
      if (isHeatingDoorSymbol(shape)) { const threshold = heatingDoorSymbolThreshold(shape); return [['door-symbol', threshold.start, threshold.end]] }
      return []
    })]) : undefined
  const adapterCoils = options.scene ? coils.map((coil) => JSON.stringify(geometryFor(coil).points)) : []
  const adapterEntryContext = options.scene ? JSON.stringify([adapterContext, adapterCoils]) : ''
  const adapterWallKeys = new WeakMap<ReadonlySet<number>, string>()
  const sourceRadius = drawingUnitsForMetres((options.sourceRadiusMm ?? 1500) / 1000, scale)
  const nearSource = (p: Point) => Boolean(options.sourcePosition &&
    Math.hypot(p.x - options.sourcePosition.x, p.y - options.sourcePosition.y) <= sourceRadius)
  const sourceEnd = (p: Point) => {
    if (!nearSource(p)) return false
    const cell = nativeFloor.index(p)
    if (cell < 0) return false
    if (nativeFloor.room[cell] === sourceRoomId) return true
    if (!nativeFloor.door[cell]) return false
    const probe = drawingUnitsForMetres(.2, scale)
    return [[probe, 0], [-probe, 0], [0, probe], [0, -probe]].some(([dx, dy]) => {
      const neighbour = nativeFloor.index({ x: p.x + dx, y: p.y + dy })
      return neighbour >= 0 && nativeFloor.room[neighbour] === sourceRoomId
    })
  }
  const sourceHasDoor = nativeFloor.door.some((door, cell) => Boolean(door && nativeFloor.room[cell] === sourceRoomId))
  const roomWallCache = new Map<number, { fine: ReadonlySet<number>; native: ReadonlySet<number> }>()
  const roomWalls = (room: number) => {
    const cached = roomWallCache.get(room)
    if (cached) return cached
    if (!sourceHasDoor || !sourceRoomId) return { fine: options.permittedWallCells, native: nativeWalls }
    const allowed = new Set<number>(), probe = drawingUnitsForMetres(.2, scale)
    for (const cell of nativeWalls) {
      const p = nativeFloor.point(cell), neighbours = new Set<number>()
      for (const [dx, dy] of [[probe, 0], [-probe, 0], [0, probe], [0, -probe]]) {
        const neighbour = nativeFloor.index({ x: p.x + dx, y: p.y + dy })
        if (neighbour >= 0 && nativeFloor.room[neighbour] > 0) neighbours.add(nativeFloor.room[neighbour])
      }
      // The adjoining room may use its useful source-wall shortcut. A remote
      // room must not borrow that room's coil apron instead of the source door.
      if (!neighbours.has(sourceRoomId) || neighbours.has(room)) allowed.add(cell)
    }
    const fine = options.nativeFloor ? new Set([...options.permittedWallCells].filter((cell) => allowed.has(nativeFloor.index(grid.point(cell))))) : allowed
    const result = { fine, native: allowed }; roomWallCache.set(room, result); return result
  }
  const data = { ...heatingPipeData(scale), ...settings, automatic: true }
  const endpoints = coils.map((pipe) => heatingPipeGeometry(pipe).points).flatMap((points) => [points[0], points.at(-1)!])
  // Keep the non-crossing flow's source ordering without forcing a hardware
  // connection. Pair adjacent source lanes; individual flow tails can interleave
  // the two arms of neighbouring circuits.
  let sourceLanes: Point[] | undefined
  if (options.sourcePosition && flows.length === coils.length * 2) {
    const ports = flows.map((flow) => sourceStubs[flow.source])
    const directions = new Set(ports.map((stub) => stub[1] - stub[0]))
    if (directions.size === 1) {
      const axis = Math.abs([...directions][0]) === grid.width ? 'x' : 'y'
      const positions = ports.map((stub) => grid.point(stub[0]))
      const ranked = coils.map((_, i) => ({ i, coordinate: (positions[i * 2][axis] + positions[i * 2 + 1][axis]) / 2 }))
        .sort((a, b) => a.coordinate - b.coordinate)
      positions.sort((a, b) => a[axis] - b[axis])
      sourceLanes = []
      for (const [rank, { i }] of ranked.entries()) sourceLanes[i] = {
        x: (positions[rank * 2].x + positions[rank * 2 + 1].x) / 2,
        y: (positions[rank * 2].y + positions[rank * 2 + 1].y) / 2 }
    }
  }
  const state = options.state ?? {}
  const paths = state.paths ??= flows.map((flow, goal) => [...sourceStubs[flow.source].slice(0, -1), ...flow.cells, ...targetStubs[goal].slice(0, -1).reverse()])
  const sources = state.sources ??= flows.map((flow) => flow.source)
  const exactEnd = (raw: Point[], head: Point) => {
    const result = raw.map((p) => ({ ...p })), last = result.at(-1)!, previous = result.at(-2)
    if (previous) {
      if (Math.abs(previous.x - last.x) < 1e-7) previous.x = head.x
      else if (Math.abs(previous.y - last.y) < 1e-7) previous.y = head.y
    }
    result[result.length - 1] = { ...head }; return result
  }
  const points = state.points ??= paths.map((path, goal) => exactEnd(simplifyHeatingPath(path.map(grid.point)), endpoints[goal]))
  const radii = state.bendRadiusMm ??= flows.map(() => limits.minBendRadiusMm)
  const tube = (vertices: Point[], goal: number, bendRadiusMm = radii[goal]) => createHeatingPipe(`bundle-envelope-${goal}`,
    vertices.some((p: Point & { bendRadiusMm?: number }) => p.bendRadiusMm !== undefined) ? vertices : openHeatingTurns(vertices, drawingUnitsForMetres(bendRadiusMm / 1000, scale), diameter), { ...data, bendRadiusMm, circuitId: coils[Math.floor(goal / 2)].heating!.circuitId, pipeRole: 'supply' })
  const envelopes = points.map((p, goal) => tube(p, goal))
  const coherent = (pair: readonly RectShape[]) => heatingFeedPairCoherent(pair, settings.spacingMm, scale, options.sourcePosition, options.sourceRadiusMm ?? 1500)
  const refined = state.refined ??= []
  const failures = state.failures ??= []
  const solids = (options.obstacles ?? []).map((b) => ({ x: b.x - diameter / 2, y: b.y - diameter / 2,
    width: b.width + diameter, height: b.height + diameter }))
  const domains = heatingFieldFootprintMask(grid, [...coils, ...(options.preserved ?? []).filter((pipe) => pipe.heating?.pipeRole === 'loop')])
  const emptyRoutingMask = new Uint8Array(grid.wall.length)
  const rooms = new Map<string, number[]>()
  for (let i = 0; i < coils.length; i++) {
    const nativeRoom = grid.room[grid.index(endpoints[i * 2])]
    const key = nativeRoom > 0 ? `native-${nativeRoom}` : coils[i].heating!.roomKey ?? coils[i].heating!.roomName ?? String(i)
    const members = rooms.get(key) ?? []; members.push(i); rooms.set(key, members)
  }
  const reach = (i: number) => Math.max(flows[i * 2].cells.length, flows[i * 2 + 1].cells.length)
  const inletFree = heatingPointClearance(coils, settings.diameterMm, scale)
  const apron = coils.map((coil) => {
    const vertices = heatingPipeGeometry(coil).points
    return Math.min(...[[vertices[0], vertices[1]], [vertices.at(-1)!, vertices.at(-2)!]].map(([head, next]) => {
      const length = Math.hypot(head.x - next.x, head.y - next.y)
      let available = 0
      for (let advance = diameter * 1.25; advance <= radius * 4; advance += diameter * 1.25) {
        const p = { x: head.x + (head.x - next.x) / length * advance, y: head.y + (head.y - next.y) / length * advance }
        const floor = options.nativeFloor ?? grid, cell = floor.index(p)
        if (cell < 0 || floor.obstacle[cell] || !heatingWallAllowed(floor, cell, options.nativeFloor
          ? { allowWalls: true, permittedWallCells: options.nativeWallCells } : baseWalls) || !inletFree(p)) break
        available = advance
      }
      return available
    }))
  })
  const transit = (members: number[]) => {
    const id = grid.room[grid.index(endpoints[members[0] * 2])]
    return coils.reduce((sum, _, circle) => sum + (members.includes(circle) ? 0 :
      flows[circle * 2].cells.some((cell) => grid.room[cell] === id) ? 1 : 0), 0)
  }
  const orderedRooms = [...rooms.values()].sort((a, b) => transit(b) - transit(a) || Math.max(...b.map(reach)) - Math.max(...a.map(reach)))
  const order = orderedRooms.flatMap((members) => [...members].sort((a, b) => reach(b) - reach(a) || apron[a] - apron[b]))
  // Give the substantial fields their trunk lanes before short infill coils.
  // Distance alone puts a small pocket under a stair ahead of the large fields
  // whose feeds still have to pass that pocket's approach.
  const loopLengths = coils.map((coil) => heatingPipeGeometry(coil).length)
  const parallelEntries = (members: number[]) => new Set(members.map((circle) => {
    const p = heatingPipeGeometry(coils[circle]).points, a = p[0], b = p[1]
    return Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? `x:${Math.sign(a.x - b.x)}` : `y:${Math.sign(a.y - b.y)}`
  })).size === 1
  const seedOrders = [orderedRooms.flatMap((members) => [...members].sort((a, b) => parallelEntries(members)
    ? reach(b) - reach(a) : loopLengths[b] - loopLengths[a] || reach(b) - reach(a))),
    orderedRooms.flatMap((members) => [...members].sort((a, b) => transit(members)
    ? reach(b) - reach(a) : reach(a) - reach(b))),
    orderedRooms.flatMap((members) => [...members].sort((a, b) => a - b)), order,
    orderedRooms.flatMap((members) => [...members].sort((a, b) => reach(a) - reach(b) || apron[a] - apron[b]))]
    .filter((value, index, all) => all.findIndex((other) => other.join(',') === value.join(',')) === index)
  const approach = (i: number) => {
    const entry = endpoints[i], vertices = heatingPipeGeometry(coils[Math.floor(i / 2)]).points
    const next = i % 2 ? vertices.at(-2)! : vertices[1], length = Math.hypot(entry.x - next.x, entry.y - next.y)
    const end = { x: entry.x + (entry.x - next.x) / length * radius, y: entry.y + (entry.y - next.y) / length * radius }
    return createHeatingPipe(`pending-entry-${i}`, [entry, end], { ...data, automatic: false,
      circuitId: coils[Math.floor(i / 2)].heating!.circuitId, pipeRole: 'supply' })
  }
  const routeGoal = (goal: number) => {
    checkpoint()
    const fastSeed = coils.length >= 4 && Boolean(state.priority?.seed) && refined.length < Math.ceil(coils.length / 3) * 2
    const head = endpoints[goal], headRoot = grid.index(head), snapped = grid.point(headRoot)
    const delta = { x: head.x - snapped.x, y: head.y - snapped.y }
    const phase: HeatingGrid = { ...grid, origin: { x: grid.origin.x + delta.x, y: grid.origin.y + delta.y },
      point: (cell) => { const p = grid.point(cell); return { x: p.x + delta.x, y: p.y + delta.y } },
      index: (p) => grid.index({ x: p.x - delta.x, y: p.y - delta.y }) }
    const targetRoom = grid.room[headRoot]
    const wallAccess = roomWalls(targetRoom), walls = { ...baseWalls, permittedWallCells: wallAccess.fine }
    const fixed = refined.map((i) => envelopes[i])
    const partner = goal ^ 1, paired = refined.includes(partner)
    const partnerDoors = paired && targetRoom === grid.room[grid.index(endpoints[partner])] ? heatingSharedDoors(grid, paths[partner]) : undefined
    const pairWidth = Math.max(drawingUnitsForMetres(.4, scale),
      Math.hypot(head.x - endpoints[partner].x, head.y - endpoints[partner].y) + radius * 2)
    const pairedCorridor = paired ? heatingRouteCorridor(grid, paths[partner], Math.ceil(pairWidth / grid.step)) : undefined
    const pending = endpoints.flatMap((_, i) => {
      // Protect this pair's return. Other circles may start curving immediately;
      // inventing straight R80 stubs for them can close a usable shared apron.
      if (i === goal || refined.includes(i) || Math.floor(i / 2) !== Math.floor(goal / 2)) return []
      return [approach(i)]
    })
    const key = JSON.stringify(['source-lanes-heuristic-v6', fastSeed, sourceLanes?.[Math.floor(goal / 2)], searchWeight, goal, false, options.sourcePosition ? sources[goal] : sources, paths[goal], paired ? paths[partner] : null,
      fixed.map((pipe) => [pipe.heating!.circuitId, pipe.heating!.bendRadiusMm, heatingPipeGeometry(pipe).points])])
    const cache = state.routeWork ??= []
    let work = cache.find((entry) => entry.key === key)
    if (!work) { work = { key, tried: [], avoid: [] }; cache.push(work); if (cache.length > 64) cache.shift() }
    if (work.result) {
      const saved = work.result
      paths[goal] = saved.path; points[goal] = saved.points; sources[goal] = saved.source; radii[goal] = saved.radius
      envelopes[goal] = tube(saved.points, goal, saved.radius); if (!refined.includes(goal)) refined.push(goal)
      return true
    }
    const free = heatingPointClearance([...coils, ...(options.preserved ?? []), ...fixed, ...pending], settings.diameterMm, scale,
      { joints: new Map([[coils[Math.floor(goal / 2)].id, [head]]]), solids })
    // Four heading states and neighbouring arc transitions revisit the same
    // grid points. Their physical envelope query is invariant for this route.
    const clearance = new Uint8Array(grid.wall.length)
    const physicalFree = (p: Point) => {
      const cell = phase.index(p)
      if (cell < 0) return false
      const node = phase.point(cell)
      if (Math.abs(node.x - p.x) > 1e-7 || Math.abs(node.y - p.y) > 1e-7) return free(p)
      if (!clearance[cell]) clearance[cell] = free(p) ? 1 : 2
      return clearance[cell] === 1
    }
    const avoid = work.avoid
    let restrictDomains = true
    const pointFree = (p: Point) => {
      if (options.nativeFloor) {
        const cell = options.nativeFloor.index(p)
        if (cell < 0 || options.nativeFloor.obstacle[cell] || !heatingWallAllowed(options.nativeFloor, cell,
          { allowWalls: true, permittedWallCells: wallAccess.native })) return false
      }
      const cell = grid.index(p)
      return cell >= 0 && !grid.obstacle[cell] && (!restrictDomains || !domains || !(domains[cell] & ~(1 << Math.floor(goal / 2)))) && heatingWallAllowed(grid, cell, walls) && physicalFree(p) &&
        avoid.every((point) => Math.hypot(point.x - p.x, point.y - p.y) >= diameter)
    }
    const claimed = new Set(sources.filter((_, i) => i !== goal)), original = sources[goal], originalPort = phase.point(sourceStubs[original][0])
    const choices = options.sourcePosition ? [original] : [original, ...sourceStubs.map((_, i) => i).filter((i) => i !== original && !claimed.has(i))
      .sort((a, b) => {
        const p = phase.point(sourceStubs[a][0]), q = phase.point(sourceStubs[b][0])
        return Math.hypot(p.x - originalPort.x, p.y - originalPort.y) - Math.hypot(q.x - originalPort.x, q.y - originalPort.y)
      }).slice(0, 4)]
    // A virtual lane suggests ordering, never a 40 mm hardware target for
    // loose ends. All independent fallbacks must use the same source zone as
    // the paired router; otherwise they repeatedly search an occupied port.
    const lane = sourceLanes?.[Math.floor(goal / 2)], sourcePoint = options.sourcePosition ?? lane
    const sourceRadius = drawingUnitsForMetres((options.sourcePosition ? options.sourceRadiusMm ?? 1500 : 40) / 1000, scale)
    const sourceHint = sourcePoint ? phase.index(sourcePoint) : -1
    let goalRegion: Set<number> | undefined, extendedGoals: Set<number> | undefined, optimisticGoals: Set<number> | undefined
    let goalRadiusCells = Math.ceil(sourceRadius / grid.step) + 1
    if (sourcePoint && sourceHint >= 0) {
      goalRegion = new Set<number>()
      const outsideDoor = new Set<number>()
      const sourceRoom = sourceRoomId
      const cells = Math.ceil(sourceRadius / grid.step) + 1
      for (let y = Math.max(0, Math.floor(sourceHint / grid.width) - cells); y <= Math.min(grid.height - 1, Math.floor(sourceHint / grid.width) + cells); y++) {
        for (let x = Math.max(0, sourceHint % grid.width - cells); x <= Math.min(grid.width - 1, sourceHint % grid.width + cells); x++) {
          const cell = y * grid.width + x, p = phase.point(cell), native = grid.index(p)
          if (native >= 0 && (!sourceRoom || grid.room[native] === sourceRoom) &&
            nativeFloor.room[nativeFloor.index(p)] === sourceRoomId &&
            Math.hypot(p.x - sourcePoint.x, p.y - sourcePoint.y) <= sourceRadius &&
            Math.hypot(p.x - head.x, p.y - head.y) >= radius + diameter && pointFree(p)) {
            goalRegion.add(cell)
            // Keep loose ends behind the doorway approach, so one short
            // terminating feed does not obstruct every following circuit.
            if (!grid.door[native]) outsideDoor.add(cell)
          }
        }
      }
      optimisticGoals = goalRegion
      extendedGoals = outsideDoor.size ? outsideDoor : goalRegion
      // Loose ends may use the complete source zone. Forcing every tube into
      // its inner 500 mm first can seal the remaining tails or create a long
      // detour even though a valid end behind the source doorway is free.
      goalRegion = extendedGoals
      goalRadiusCells = Math.ceil(sourceRadius / grid.step) + 1
    }
    if (coils.length > 1 && grid.step * scale / 8 / Math.SQRT2 <= (settings.diameterMm - 1) / 2) {
      // An optimistic, radius-free connectivity check rejects closed corridors
      // before spending time on many different bend radii. Relax clearance by
      // more than half the routing cell diagonal so sub-cell curved passages stay possible.
      const loose = heatingPointClearance([...coils, ...(options.preserved ?? []), ...fixed, ...pending], 1, scale,
        { joints: new Map([[coils[Math.floor(goal / 2)].id, [head]]]) })
      const optimistic = { ...phase, wall: emptyRoutingMask, obstacle: emptyRoutingMask, door: emptyRoutingMask }
      const connected = routeHeating(optimistic, headRoot, goalRegion ? sourceHint : sourceStubs[original][0], {
        goalRegion: optimisticGoals ?? goalRegion, goalRadiusCells: Math.ceil(sourceRadius / grid.step) + 1, checkpoint,
        pointFree: (p) => {
          const cell = phase.index(p), x = cell % grid.width, y = Math.floor(cell / grid.width)
          if (cell < 0 || !loose(p)) return false
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (x + dx < 0 || x + dx >= grid.width || y + dy < 0 || y + dy >= grid.height) continue
            const at = cell + dy * grid.width + dx
            if (!grid.obstacle[at] && heatingWallAllowed(grid, at, walls)) return true
          }
          return false
        }
      })
      if (!connected) { failures.push({ goal, reason: 'disconnected', point: head }); return false }
    }
    const corridor = pairedCorridor ?? heatingRouteCorridor(grid, paths[goal], radiusCells * 2)
    const cellPenalty = Float32Array.from(grid.wall, (_, cell) => corridor.has(cell) ? 0 : 2)
    let failure: typeof failures[number] = work.failure ?? { goal, reason: 'source-blocked' }
    const bendChoices = [...new Set((coils.length >= 4 ? [limits.minBendRadiusMm] : [limits.minBendRadiusMm, limits.minBendRadiusMm + settings.spacingMm,
      limits.minBendRadiusMm + 20, limits.minBendRadiusMm + 40, limits.minBendRadiusMm * 2, limits.minBendRadiusMm * 3]).map((value) => Math.ceil(value / (grid.step * scale / 8)) * grid.step * scale / 8))]
    for (const source of choices) for (const bendRadiusMm of bendChoices) for (let trial = 0; trial < 3; trial++) {
      checkpoint()
      const trialKey = `${source}:${bendRadiusMm}:${trial}`
      if (work.tried.includes(trialKey)) continue
      const reject = (remaining = false) => {
        work!.failure = failure
        for (let n = trial; n < (remaining ? 3 : trial + 1); n++) work!.tried.push(`${source}:${bendRadiusMm}:${n}`)
      }
      const stub = sourceStubs[source], target = targetStubs[goal]
      if (goalRegion ? !goalRegion.size : !pointFree(phase.point(stub[0]))) break
      // Search outwards from the constrained coil entrance. Distributor-zone
      // ends are free ends, so they need no artificial hardware orientation.
      let variableBends = false
      const route = () => {
        const searchKey = `${trialKey}:${restrictDomains}:${variableBends}:${goalRegion === extendedGoals}`
        if (work!.rejectedSearches?.includes(searchKey)) return null
        if (variableBends && coils.length >= 4) {
          const informed = `${searchKey}:informed`
          if (!work!.rejectedSearches?.includes(informed)) {
            state.routeAttempts = (state.routeAttempts ?? 0) + 1
            options.onProgress?.(refined.length, state.priority?.rootDone, state.routeAttempts)
            const result = routeHeating(phase, headRoot, goalRegion ? sourceHint : stub[0], { ...walls, preferredDoors: partnerDoors ?? walls.preferredDoors, goalRegion, goalRadiusCells,
              resumeKey: `${key}:${informed}`, arcOnly: true,
              radiusCells: Math.ceil(2 * drawingUnitsForMetres(bendRadiusMm / 1000, scale) / grid.step), preferArcs: true, continuousTurns: true,
              variableBends, obstacleHeuristic: true, pointFree, checkpoint, cellPenalty, searchWeight, startDirection: target[1] - target[0] })
            if (result) return result
            const rejected = work!.rejectedSearches ??= []
            rejected.push(informed)
          }
        }
        state.routeAttempts = (state.routeAttempts ?? 0) + 1
        options.onProgress?.(refined.length, state.priority?.rootDone, state.routeAttempts)
        const result = routeHeating(phase, headRoot, goalRegion ? sourceHint : stub[0], { ...walls, preferredDoors: partnerDoors ?? walls.preferredDoors, goalRegion, goalRadiusCells, resumeKey: `${key}:${searchKey}`, arcOnly: true, radiusCells: Math.ceil(2 * drawingUnitsForMetres(bendRadiusMm / 1000, scale) / grid.step), preferArcs: true, continuousTurns: true, variableBends, pointFree, checkpoint, cellPenalty, searchWeight,
          startDirection: target[1] - target[0] })
        if (!result) (work!.rejectedSearches ??= []).push(searchKey)
        return result
      }
      let outward = route()
      // A field footprint is a search shortcut, never a physical prohibition.
      // Concave fields can leave a useful passage that the morphological mask closes.
      if (!outward && restrictDomains) { restrictDomains = false; outward = route() }
      if (!outward && !fastSeed) { variableBends = true; outward = route() }
      if (!outward && extendedGoals && goalRegion !== extendedGoals) {
        goalRegion = extendedGoals; goalRadiusCells = Math.ceil(sourceRadius / grid.step) + 1; variableBends = false
        outward = route()
        if (!outward && !fastSeed) { variableBends = true; outward = route() }
      }
      if (!outward) { if (failure.reason === 'source-blocked') failure = { goal, reason: 'route', point: head }; reject(true); break }
      const path = [...outward].reverse()
      const vertices = simplifyHeatingPath(heatingPathPoints(phase, outward).reverse()), candidate = tube(vertices, goal, bendRadiusMm)
      if (heatingPipeGeometry(candidate).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1)) { failure = { goal, reason: 'bend' }; reject(true); break }
      const wall = heatingCurveWallConflict(options.nativeFloor ?? grid, heatingPipeGeometry(candidate).pieces,
        options.nativeFloor ? { allowWalls: true, permittedWallCells: wallAccess.native } : walls)
      if (wall) { failure = { goal, reason: 'wall', point: wall }; avoid.push(wall); reject(); continue }
      const audit = auditHeatingPlan([...coils, ...(options.preserved ?? []), ...fixed, ...pending, candidate], [], settings.design,
        [...(options.obstacles ?? [])], { focusPipeIds: new Set([candidate.id]), stopOnConflict: true, checkpoint })
      if (audit.errors) {
        const issue = audit.issues.find((i) => i.severity === 'error')!
        failure = { goal, reason: issue.code, point: issue.point, detail: issue.message }
        if (issue.point && Math.hypot(issue.point.x - head.x, issue.point.y - head.y) > diameter * 2) { avoid.push(issue.point); reject(); continue }
        reject(true); break
      }
      radii[goal] = bendRadiusMm; paths[goal] = path; points[goal] = heatingPipeGeometry(candidate).points; sources[goal] = source; envelopes[goal] = candidate
      if (!refined.includes(goal)) refined.push(goal)
      work.result = { path, points: points[goal], source, radius: bendRadiusMm }
      return true
    }
    failures.push(failure); return false
  }
  const snapshot = (): RefinementSnapshot => ({ paths: [...paths], points: [...points], sources: [...sources],
    bendRadiusMm: [...radii], refined: [...refined], failures: [...failures] })
  const restore = (saved: RefinementSnapshot) => {
    paths.splice(0, paths.length, ...saved.paths); points.splice(0, points.length, ...saved.points)
    sources.splice(0, sources.length, ...saved.sources); radii.splice(0, radii.length, ...saved.bendRadiusMm)
    refined.splice(0, refined.length, ...new Set(saved.refined)); failures.splice(0, failures.length, ...saved.failures)
    for (let goal = 0; goal < points.length; goal++) envelopes[goal] = tube(points[goal], goal)
  }
  const installGoal = (goal: number, vertices: Point[], bendRadius = radii[goal]) => {
      points[goal] = vertices; radii[goal] = bendRadius; envelopes[goal] = tube(vertices, goal, bendRadius)
      const path: number[] = []
      for (const piece of heatingPipeGeometry(envelopes[goal]).pieces) {
        const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / grid.step))
        for (let at = 0; at <= n; at++) {
          const cell = grid.index({ x: piece.a.x + (piece.b.x - piece.a.x) * at / n, y: piece.a.y + (piece.b.y - piece.a.y) * at / n })
          if (cell >= 0 && path.at(-1) !== cell) path.push(cell)
        }
      }
      paths[goal] = path; if (!refined.includes(goal)) refined.push(goal)
  }
  const installPair = (circuit: number, vertices: Point[][], bendRadii = [radii[circuit * 2], radii[circuit * 2 + 1]]) => {
    for (let i = 0; i < 2; i++) installGoal(circuit * 2 + i, vertices[i], bendRadii[i])
  }
  const preparedPairAccepted = (circuit: number) => {
    if (!options.onPreparedPair) return true
    const goals = [circuit * 2, circuit * 2 + 1]
    const feeds = goals.map((goal, leg) => {
      const vertices = geometryFor(envelopes[goal]).points
      return createHeatingPipe(`prepared-feed-${goal}`, leg ? [...vertices].reverse() : vertices,
        { ...envelopes[goal].heating!, pipeRole: leg ? 'return' : 'supply' })
    })
    // Save only a hint before the callback. A pause must report this pair
    // again on resume, and any reused hint still passes the physical audit.
    const coilKey = JSON.stringify(geometryFor(coils[circuit]).points)
    state.warmPairs = [...state.warmPairs?.filter((pair) => pair.coilKey !== coilKey) ?? [], {
      coilKey, points: goals.map((goal) => points[goal]), bendRadiusMm: goals.map((goal) => radii[goal]) }].slice(-32)
    if (options.onPreparedPair(circuit, feeds)) return true
    refined.splice(0)
    failures.splice(0, failures.length, ...goals.map((goal) => ({ goal, reason: 'measured-length', point: endpoints[goal] })))
    state.best = undefined
    if (state.priority) {
      state.priority.rootDone = Math.min(state.priority.rootDone, circuit)
      state.priority.solution = undefined
    }
    return false
  }
  const tryDoorAdapter = (circuit: number, fixed: RectShape[], walls: { fine: ReadonlySet<number>; native: ReadonlySet<number> },
    key: string, searchBudget?: { remaining: number }, target?: Point) => {
    if (!options.scene || !options.sourcePosition) return false
    let wallKey = adapterWallKeys.get(walls.native)
    if (wallKey === undefined) { wallKey = JSON.stringify([...walls.native].sort((a, b) => a - b)); adapterWallKeys.set(walls.native, wallKey) }
    const contextKey = JSON.stringify(['door-adapter-launches-v3', key, adapterContext, adapterCoils[circuit], wallKey])
    const adapters = state.doorAdapters ??= []
    let adapter = adapters.find((value) => value.key === contextKey)
    if (!adapter) { adapter = { key: contextKey, work: {} }; adapters.push(adapter); if (adapters.length > 32) adapters.shift() }
    const entries = state.doorEntries ??= [], entryKey = `${circuit}:${adapterEntryContext}`
    const hint = entries.find((entry) => entry.key === entryKey)?.pipes
    let adapted: ReturnType<typeof routeDoorAdaptedHeatingFeeds>
    try { adapted = routeDoorAdaptedHeatingFeeds(grid, options.scene, coils[circuit], coils, fixed, settings, scale, {
      source: options.sourcePosition, sourceRadiusMm: options.sourceRadiusMm ?? 1500,
      target, targetRadiusMm: target ? grid.step * scale / 8 * 1.1 : undefined,
      nativeFloor, nativeWallCells: walls.native, permittedWallCells: walls.fine,
      obstacles: options.obstacles, routeOptions: options.routeOptions, geometryFor,
      work: adapter.work, localHint: hint, searchBudget, searchKey: contextKey, checkpoint,
      onSearch: () => { state.routeAttempts = (state.routeAttempts ?? 0) + 1; options.onProgress?.(refined.length, state.priority?.rootDone, state.routeAttempts) } })
    } finally {
      if (adapter.work.local) {
        const previous = entries.find((entry) => entry.key === entryKey)
        if (previous) previous.pipes = adapter.work.local
        else { entries.push({ key: entryKey, pipes: adapter.work.local }); if (entries.length > 32) entries.shift() }
      }
    }
    if (!adapted) return false
    installPair(circuit, adapted, [limits.minBendRadiusMm, limits.minBendRadiusMm])
    return true
  }
  const repairLooseEnds = (circuit: number) => {
    if (!options.sourcePosition || !refined.length) return false
    const pair = [circuit * 2, circuit * 2 + 1], fixed = [...coils, ...(options.preserved ?? []), ...refined.map((goal) => envelopes[goal])]
    const inSource = sourceEnd
    const audit = auditHeatingPlan([...fixed, ...pair.map((goal) => envelopes[goal])], [], settings.design,
      [...options.obstacles ?? []], { focusPipeIds: new Set(pair.map((goal) => envelopes[goal].id)), checkpoint })
    if (!audit.errors || audit.issues.some((issue) => issue.severity === 'error' &&
      (issue.code !== 'collision' || !issue.point || !nearSource(issue.point)))) return false
    const first = points[pair[0]]
    const direction = (a: Point, b: Point) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    }
    if (first.length >= 3) {
      const u = direction(first[0], first[1]), v = direction(first[1], first[2])
      if (Math.abs(u.x * v.x + u.y * v.y) < 1e-6) {
        const group = [...refined, ...pair].filter((goal) => {
          const p = points[goal]
          if (p.length < 3 || !inSource(p[0]) || Math.hypot(p[1].x - options.sourcePosition!.x, p[1].y - options.sourcePosition!.y) > sourceRadius) return false
          const a = direction(p[0], p[1]), b = direction(p[1], p[2])
          return Math.abs(a.x - u.x) + Math.abs(a.y - u.y) + Math.abs(b.x - v.x) + Math.abs(b.y - v.y) < 1e-6
        })
        if (pair.every((goal) => group.includes(goal))) {
          const values = group.map((goal) => points[goal][1].x * (u.x + v.x) + points[goal][1].y * (u.y + v.y)).sort((a, b) => a - b)
          const retained = [...coils, ...(options.preserved ?? []), ...refined.filter((goal) => !group.includes(goal)).map((goal) => envelopes[goal])]
          // Align the source bends as one ordered fan. Independent routing
          // phases can place adjacent vertical tails only 4 mm apart even
          // though their horizontal approach runs already fit correctly.
          for (const value of new Set([values.at(-1)!, values[0], values[Math.floor(values.length / 2)]])) {
            checkpoint()
            const candidates = group.map((goal) => {
              const p = points[goal], shift = value - p[1].x * (u.x + v.x) - p[1].y * (u.y + v.y)
              return p.map((point, i) => i < 2 ? { ...point, x: point.x + v.x * shift, y: point.y + v.y * shift } : point)
            })
            if (candidates.some((p) => !inSource(p[0]))) continue
            const pipes = candidates.map((p, i) => tube(p, group[i]))
            if (pipes.some((pipe) => heatingPipeGeometry(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
              heatingCurveWallConflict(nativeFloor, heatingPipeGeometry(pipe).pieces, { allowWalls: true, permittedWallCells: nativeWalls }))) continue
            if (auditHeatingPlan([...retained, ...pipes], [], settings.design, [...options.obstacles ?? []],
              { focusPipeIds: new Set(pipes.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint }).errors) continue
            group.forEach((goal, i) => installGoal(goal, candidates[i])); return true
          }
        }
      }
    }
    const legs = pair.map((goal) => points[goal].slice(0, 2))
    if (legs.every((leg) => leg.length === 2)) {
      const vertical = Math.abs(legs[0][0].x - legs[0][1].x) < 1e-6
      const parallel = legs.every(([a, b]) => vertical ? Math.abs(a.x - b.x) < 1e-6 : Math.abs(a.y - b.y) < 1e-6)
      if (parallel) for (let step = 1; step <= 20; step++) for (const sign of [-1, 1]) {
        checkpoint()
        const offset = drawingUnitsForMetres(step * settings.diameterMm * 1.25 / 1000, scale) * sign
        const vertices = pair.map((goal) => points[goal].map((p, i) => i < 2 ? {
          ...p, x: p.x + (vertical ? offset : 0), y: p.y + (vertical ? 0 : offset) } : p))
        if (vertices.some((p) => !inSource(p[0]) ||
          Math.hypot(p[1].x - options.sourcePosition!.x, p[1].y - options.sourcePosition!.y) > sourceRadius)) continue
        const candidates = vertices.map((p, i) => tube(p, pair[i]))
        if (candidates.some((pipe) => heatingPipeGeometry(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
          heatingCurveWallConflict(nativeFloor, heatingPipeGeometry(pipe).pieces, { allowWalls: true, permittedWallCells: nativeWalls }))) continue
        if (auditHeatingPlan([...fixed, ...candidates], [], settings.design, [...options.obstacles ?? []],
          { focusPipeIds: new Set(candidates.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint }).errors) continue
        installPair(circuit, vertices); return true
      }
    }
    // These are intentionally loose ends. A collision at their virtual port
    // does not require rerouting the whole circuit: shorten the straight tail
    // inside the source room, preserving every bend and the full room approach.
    const choices = pair.map((goal) => {
      const original = points[goal], head = original[0], next = original[1]
      if (!next) return []
      const length = Math.hypot(next.x - head.x, next.y - head.y)
      const firstBend = heatingPipeGeometry(envelopes[goal]).bends[0]?.radiusMm ?? limits.minBendRadiusMm
      const keep = drawingUnitsForMetres((firstBend + settings.diameterMm) / 1000, scale)
      const candidates: Point[][] = []
      for (let advance = 0; advance <= Math.min(length - keep, sourceRadius * 2); advance += diameter) {
        checkpoint()
        const end = { ...head, x: head.x + (next.x - head.x) / length * advance, y: head.y + (next.y - head.y) / length * advance }
        if (!inSource(end)) continue
        const vertices = [end, ...original.slice(1)], candidate = tube(vertices, goal)
        if (heatingPipeGeometry(candidate).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1)) continue
        if (!auditHeatingPlan([...fixed, candidate], [], settings.design, [...options.obstacles ?? []],
          { focusPipeIds: new Set([candidate.id]), stopOnConflict: true, checkpoint }).errors) candidates.push(vertices)
      }
      return candidates
    })
    for (const a of choices[0]) for (const b of choices[1]) {
      const candidates = [tube(a, pair[0]), tube(b, pair[1])]
      if (auditHeatingPlan([...fixed, ...candidates], [], settings.design, [...options.obstacles ?? []],
        { focusPipeIds: new Set(candidates.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint }).errors) continue
      installPair(circuit, [a, b]); return true
    }
    return false
  }
  const connectPair = (circuit: number) => {
    const before = snapshot(), pair = [circuit * 2, circuit * 2 + 1]
    const launchBaselines = new WeakMap<ReadonlySet<number>, Map<RectShape, number>>()
    const baselineFor = (walls: ReadonlySet<number>) => {
      let baseline = launchBaselines.get(walls)
      if (!baseline) { baseline = new Map(); launchBaselines.set(walls, baseline) }
      return baseline
    }
    let independentTried = false, rejected: typeof failures = []
    const tryIndependentPair = () => {
      if (independentTried) return false
      independentTried = true
      const first = paths[pair[0]].length >= paths[pair[1]].length ? pair : [...pair].reverse()
      try {
        for (const sequence of [first, [...first].reverse()]) {
          restore(before)
          if (routeGoal(sequence[0]) && routeGoal(sequence[1]) && (!options.sourcePosition ||
            !heatingEntrySealsOtherLaunch(coils[circuit], pair.map((goal) => envelopes[goal]),
              [...coils, ...(options.preserved ?? []), ...before.refined.map((goal) => envelopes[goal])], settings, scale, {
                grid, nativeFloor, nativeWallCells: nativeWalls, permittedWallCells: options.permittedWallCells,
                source: options.sourcePosition, sourceRadiusMm: options.sourceRadiusMm, obstacles: options.obstacles,
                checkpoint, baseline: baselineFor(nativeWalls) }))) return true
          rejected = failures.slice(before.failures.length)
        }
      } catch (error) { restore(before); throw error }
      restore(before)
      return false
    }
    if (repairLooseEnds(circuit)) return true
    const hostCell = nativeFloor.index(endpoints[pair[0]])
    const sourceWallEntry = hostCell >= 0 && sourceShortcuts.has(nativeFloor.room[hostCell])
    if (refined.length) {
      const fixed = [...coils, ...(options.preserved ?? []), ...refined.map((goal) => envelopes[goal])]
      const ids = new Set(pair.map((goal) => envelopes[goal].id))
      const current = auditHeatingPlan([...fixed, ...pair.map((goal) => envelopes[goal])], [], settings.design,
        [...options.obstacles ?? []], { focusPipeIds: ids, checkpoint })
      if (current.errors && current.issues.every((issue) => issue.severity !== 'error' || issue.code === 'collision')) {
        const shifted = shiftHeatingApproachLanes(pair.map((goal) => points[goal]), scale, { sourceEnd, checkpoint,
          occupied: refined.map((goal) => points[goal]), separationMm: Math.max(settings.diameterMm * 1.25, grid.step * scale / 8 * 2),
          valid: (vertices) => {
            const candidates = vertices.map((p, i) => tube(p, pair[i]))
            if (candidates.some((pipe) => heatingPipeGeometry(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
              heatingCurveWallConflict(nativeFloor, heatingPipeGeometry(pipe).pieces, { allowWalls: true, permittedWallCells: nativeWalls }))) return false
            return !auditHeatingPlan([...fixed, ...candidates], [], settings.design, [...options.obstacles ?? []],
              { focusPipeIds: ids, stopOnConflict: true, checkpoint }).errors
          } })
        if (shifted) { installPair(circuit, shifted); return true }
      }
      // Small S transitions inherited from different grid phases can collide
      // while both long, parallel runs fit. Slide the transition along its
      // straight runs before searching a completely different room route.
      const windows = pair.map((goal) => points[goal].flatMap((a, i, all) => {
        if (!i || i + 2 >= all.length) return []
        const previous = all[i - 1], b = all[i + 1], next = all[i + 2]
        const length = Math.hypot(a.x - previous.x, a.y - previous.y), after = Math.hypot(next.x - b.x, next.y - b.y)
        if (!length || !after) return []
        const u = { x: (a.x - previous.x) / length, y: (a.y - previous.y) / length }
        if (((next.x - b.x) * u.x + (next.y - b.y) * u.y) / after < .999 ||
          Math.abs(u.x * (b.y - a.y) - u.y * (b.x - a.x)) < diameter / 4) return []
        return [{ i, u, length, after }]
      }).slice(0, 3))
      try {
        for (const a of windows[0]) for (const b of windows[1]) {
          if (a.u.x * b.u.x + a.u.y * b.u.y < .999) continue
          for (const mm of [20, 40, 60, 80, 100, 150, 200, 300, 400]) for (const sign of [-1, 1]) {
            checkpoint()
            const shift = drawingUnitsForMetres(mm / 1000, scale) * sign
            if ([a, b].some((window) => window.length + shift < radius + diameter || window.after - shift < radius + diameter)) continue
            restore(before)
            const vertices = [a, b].map((window, index) => before.points[pair[index]].map((p, i) =>
              i === window.i || i === window.i + 1 ? { ...p, x: p.x + window.u.x * shift, y: p.y + window.u.y * shift } : p))
            const candidates = vertices.map((p, i) => tube(p, pair[i]))
            if (candidates.some((pipe) => heatingPipeGeometry(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
              heatingCurveWallConflict(nativeFloor, heatingPipeGeometry(pipe).pieces, { allowWalls: true, permittedWallCells: nativeWalls }))) continue
            const fixed = [...coils, ...(options.preserved ?? []), ...refined.map((goal) => envelopes[goal])]
            const audit = auditHeatingPlan([...fixed, ...candidates], [], settings.design, [...options.obstacles ?? []],
              { focusPipeIds: new Set(candidates.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint })
            if (!audit.errors) { installPair(circuit, vertices); return true }
            for (let i = 0; i < 2; i++) { points[pair[i]] = vertices[i]; envelopes[pair[i]] = candidates[i] }
            if (repairLooseEnds(circuit)) return true
          }
        }
      } catch (error) { restore(before); throw error }
      restore(before)
    }
    // Once the shared trunk is occupied, independent legs can fit a doorway
    // that is too tight for a rigid ribbon. Try that flexible, fully audited
    // route before an exhaustive variable-radius paired search.
    if (state.priority?.seed && refined.length >= Math.ceil(coils.length / 3) * 2 && tryIndependentPair()) return true
    if (options.sourcePosition) {
      const fixed = [...(options.preserved ?? []), ...refined.map((goal) => envelopes[goal])]
      const preferredWalls = roomWalls(grid.room[grid.index(endpoints[pair[0]])])
      const wallChoices = [preferredWalls]
      if (preferredWalls.fine.size < options.permittedWallCells.size) wallChoices.push({
        fine: options.permittedWallCells, native: nativeWalls })
      const lane = sourceLanes?.[circuit]
      // Once a substantial prefix fits, exhaust the physical bend/launch options
      // for the next pair. The four-query probe can reject a usable doorway
      // when it needs an S transition or a different initial turn.
      const fast = coils.length >= 4 && Boolean(state.priority?.seed) && refined.length < Math.ceil(coils.length / 3) * 2
      // Bound the work spent on one inlet in a seed, then explore a
      // different local order or inlet. A paused global session still keeps
      // its completed routes and rejected physical searches.
      let searchBudget: { remaining: number } | undefined
      if (state.priority?.seed) {
        const key = JSON.stringify(['paired-probe-v2', fast, circuit,
          fixed.map((pipe) => [pipe.heating!.circuitId, pipe.heating!.bendRadiusMm, geometryFor(pipe).points])])
        const probes = state.pairedProbes ??= []
        let probe = probes.find((probe) => probe.key === key)
        // A doorway adapter performs two searches: the local escape and the
        // common leader. Four queries can exhaust the local turn variants
        // before the leader is attempted, incorrectly rejecting an open room.
        if (!probe) { probe = { key, remaining: fast ? 12 : 24 }; probes.push(probe); if (probes.length > 64) probes.shift() }
        searchBudget = probe
      }
      // Virtual port order is a preference for loose ends, not a hardware
      // constraint. Retry in the actual source zone when that lane is sealed.
      // Do not restart an exhausted paired probe before a paused independent
      // leg: that would overwrite its active search frontier on every resume.
      pairedCandidates: for (const [wallChoice, walls] of wallChoices.entries()) for (const target of lane ? [undefined, lane] : [undefined]) {
        if (searchBudget && searchBudget.remaining <= 0) break pairedCandidates
        const key = JSON.stringify(['loose-source-wall-fallback-v11', fast, wallChoice, target, circuit, fixed.map((pipe) => [pipe.heating!.circuitId, pipe.heating!.bendRadiusMm, heatingPipeGeometry(pipe).points])])
        const cache = state.pairedWork ??= []
        let work = cache.find((value) => value.key === key)
        if (!work) { work = { key, rejected: [] }; cache.push(work); if (cache.length > 64) cache.shift() }
        // Adjacent rooms can use the short authorised source-wall route and
        // fan in beyond the wall. Prove that pair before a doorway detour.
        if (!sourceWallEntry && tryDoorAdapter(circuit, fixed, walls, `${key}:door-adapter-v1`, searchBudget, target)) return true
        const result = routePairedHeatingFeeds(grid, coils[circuit], coils, fixed, settings, scale,
          { source: options.sourcePosition, target, targetRadiusMm: target ? grid.step * scale / 8 * 1.1 : undefined,
            sourceRadiusMm: options.sourceRadiusMm ?? 1500, permittedWallCells: walls.fine,
            nativeFloor: options.nativeFloor, nativeWallCells: walls.native, obstacles: options.obstacles, geometryFor,
            routeOptions: options.routeOptions, guideCells: pair.map((goal) => flows[goal].cells), fieldMask: domains, ownField: 1 << circuit, fast, searchBudget, searchKey: key, checkpoint, rejectedSearches: work.rejected,
            // The caller measures these physical leaders before rejecting an
            // overlong circuit and repartitioning its room. Rejecting length
            // here would discard that feedback and repeat the same short
            // estimated approaches. No overlong plan is committed by it.
            acceptPair: (candidate) => !heatingEntrySealsOtherLaunch(coils[circuit], candidate, [...coils, ...fixed], settings, scale, {
              grid, nativeFloor, nativeWallCells: walls.native, permittedWallCells: walls.fine, source: options.sourcePosition!,
              sourceRadiusMm: options.sourceRadiusMm, obstacles: options.obstacles, checkpoint, baseline: baselineFor(walls.native) }),
            onSearch: () => { state.routeAttempts = (state.routeAttempts ?? 0) + 1; options.onProgress?.(refined.length, state.priority?.rootDone, state.routeAttempts) } })
        if (result) {
          installPair(circuit, result, [limits.minBendRadiusMm, limits.minBendRadiusMm])
          return true
        }
        if (sourceWallEntry && tryDoorAdapter(circuit, fixed, walls, `${key}:door-adapter-v1`, searchBudget, target)) return true
        if (searchBudget && searchBudget.remaining <= 0) break pairedCandidates
      }
      if (fast) {
        restore(before)
        for (const goal of pair) failures.push({ goal, reason: 'entry-choice', point: endpoints[goal] })
        return false
      }
    }
    if (tryIndependentPair()) return true
    restore(before)
    for (const goal of pair) failures.push(rejected.find((failure) => failure.goal === goal) ?? { goal, reason: 'partner-route', point: endpoints[goal] })
    return false
  }
  const finish = () => {
    if (options.sourcePosition && refined.length === flows.length) {
      const inside = (p: Point) => {
        const cell = nativeFloor.index(p)
        return cell >= 0 && nativeFloor.room[cell] === sourceRoomId && !nativeFloor.obstacle[cell] && nearSource(p)
      }
      const rejected = new Set<number>()
      for (const goal of [...refined]) {
        if (inside(points[goal][0])) continue
        const extended = bringHeatingSourceEndInside(points[goal], settings.diameterMm, scale, { inside, checkpoint,
          valid: (vertices) => {
            const candidate = tube(vertices, goal)
            if (heatingCurveWallConflict(nativeFloor, geometryFor(candidate).pieces,
              { allowWalls: true, permittedWallCells: nativeWalls })) return false
            return !auditHeatingPlan([...coils, ...(options.preserved ?? []), ...envelopes.filter((_, i) => i !== goal), candidate],
              [], settings.design, [...options.obstacles ?? []], { focusPipeIds: new Set([candidate.id]), stopOnConflict: true, checkpoint }).errors
          } })
        if (extended) installGoal(goal, extended)
        else { rejected.add(goal & ~1); failures.push({ goal, reason: 'source-room', point: points[goal][0] }) }
      }
      if (rejected.size) {
        refined.splice(0, refined.length, ...refined.filter((goal) => !rejected.has(goal & ~1)))
        if (state.priority) state.priority.solution = undefined
      } else {
        if (state.priority?.solution) state.priority.solution = snapshot()
        if (state.best) state.best = snapshot()
      }
    }
    if (coils.length === 1 && refined.length === 2) preparedPairAccepted(0)
    return { paths, points, sources, bendRadiusMm: radii, refined, failures }
  }
  if (coils.length > 1) {
    // Conflict-driven priorities replan only an actual blocker and its dependants.
    // A few fixed global orderings cannot resolve interdependent doorway routes.
    const search = state.priority ??= { rootDone: 0, queue: [], seen: [], expanded: 0 }
    if (!search.solution && search.rootPolicy !== 'paired-corridors-v3') {
      if (search.root) {
        const cached = state.warmPairs ??= []
        for (let circle = 0; circle < search.rootDone; circle++) cached.push({
          coilKey: JSON.stringify(heatingPipeGeometry(coils[circle]).points),
          points: search.root.points.slice(circle * 2, circle * 2 + 2),
          bendRadiusMm: search.root.bendRadiusMm.slice(circle * 2, circle * 2 + 2) })
        state.warmPairs = cached.slice(-32)
      }
      search.rootDone = 0; search.root = undefined; search.seedPolicy = undefined
      search.seeded = false; search.seed = undefined; search.queue = []; search.active = undefined
      search.rootPolicy = 'paired-corridors-v3'
    }
    // A resumed checkpoint may already contain independent physical pairs.
    // Their lengths must be reported before the next expensive room search.
    const prepared = search.solution ?? search.root
    if (options.onPreparedPair && prepared) {
      restore(prepared)
      for (let circle = 0; circle < search.rootDone; circle++) if (!preparedPairAccepted(circle)) {
        return { paths, points, sources, bendRadiusMm: radii, refined, failures }
      }
    }
    if (search.solution) restore(search.solution)
    else {
      const launchBaseline = new Map<RectShape, number>()
      for (let circle = search.rootDone; circle < coils.length; circle++) {
        if (search.root) restore(search.root)
        refined.splice(0); failures.splice(0)
        const currentPoints = geometryFor(coils[circle]).points, coilKey = JSON.stringify(currentPoints)
        const entryKey = heatingConnectionEntryKey(currentPoints)
        const warm = state.warmPairs?.find((pair) => pair.coilKey === coilKey) ?? state.warmPairs?.find((pair) => {
          if (!entryKey) return false
          try { return heatingConnectionEntryKey(JSON.parse(pair.coilKey)) === entryKey } catch { return false }
        })
        let reused = false
        if (warm && options.sourcePosition && warm.points.length === 2 && warm.points.every((p) => p.length >= 2 && sourceEnd(p[0]))) {
          const candidates = warm.points.map((p, i) => tube(p, circle * 2 + i, warm.bendRadiusMm[i]))
          reused = coherent(candidates) && !candidates.some((pipe) => heatingPipeGeometry(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
            heatingCurveWallConflict(nativeFloor, heatingPipeGeometry(pipe).pieces, { allowWalls: true, permittedWallCells: nativeWalls })) &&
            !auditHeatingPlan([...coils, ...(options.preserved ?? []), ...candidates], [], settings.design, [...options.obstacles ?? []],
              { focusPipeIds: new Set(candidates.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint }).errors &&
            !heatingEntrySealsOtherLaunch(coils[circle], candidates, [...coils, ...(options.preserved ?? [])], settings, scale, {
              grid, nativeFloor, nativeWallCells: nativeWalls, permittedWallCells: options.permittedWallCells,
              source: options.sourcePosition, sourceRadiusMm: options.sourceRadiusMm, obstacles: options.obstacles, checkpoint, baseline: launchBaseline })
          if (reused) installPair(circle, warm.points, warm.bendRadiusMm)
        }
        if (!reused && !connectPair(circle)) return { paths, points, sources, bendRadiusMm: radii, refined: [], failures }
        if (!preparedPairAccepted(circle)) return { paths, points, sources, bendRadiusMm: radii, refined, failures }
        search.root = snapshot(); search.rootDone = circle + 1
        options.onProgress?.(0, search.rootDone, state.routeAttempts ?? 0)
      }
      const assess = (edges: [number, number][]): PriorityNode => {
        checkpoint()
        const audit = auditHeatingPlan([...coils, ...(options.preserved ?? []), ...envelopes], [], settings.design,
          [...(options.obstacles ?? [])], { focusPipeIds: new Set(envelopes.map((pipe) => pipe.id)), checkpoint })
        const errors = audit.issues.filter((issue) => issue.severity === 'error')
        const ids = errors.find((issue) => issue.code === 'collision' && issue.circuits.length === 2)?.circuits
        const conflict = ids?.map((id) => coils.findIndex((coil) => coil.heating!.circuitId === id))
        return { routes: snapshot(), edges, errors: errors.length,
          safeGoals: coils.filter((coil) => !errors.some((issue) => issue.circuits.includes(coil.heating!.circuitId!))).length * 2, cost: envelopes.reduce((sum, pipe) => sum + heatingPipeGeometry(pipe).length, 0),
          ...(conflict?.length === 2 && conflict.every((id) => id >= 0) ? { conflict: conflict as [number, number] } : {}) }
      }
      if (!search.solution && search.seedPolicy !== 'native-room-local-order-v17') {
        const warm = search.bestSeed
        search.seedPolicy = 'native-room-local-order-v17'; search.seeded = false; search.seed = undefined
        search.triedSeeds = []; search.pendingSeeds = seedOrders.map((order) => ({ order, next: 0,
          routes: { ...search.root!, refined: [], failures: [] } }))
        if (warm) {
          const goals = new Set(warm.routes.refined)
          const completed = [...new Set(warm.routes.refined.map((goal) => goal >> 1))]
            .filter((circle) => goals.has(circle * 2) && goals.has(circle * 2 + 1) && coherent([0, 1].map((offset) =>
              tube(warm.routes.points[circle * 2 + offset], circle * 2 + offset, warm.routes.bendRadiusMm[circle * 2 + offset]))))
          const retained = new Set(completed)
          let order = [...completed, warm.blocked, ...seedOrders[0].filter((circle) => !retained.has(circle) && circle !== warm.blocked)]
          let prefix = completed
          const members = [...rooms.values()].find((group) => group.includes(warm.blocked))!
          const first = completed.findIndex((circle) => members.includes(circle))
          if (first >= 0 && parallelEntries(members)) {
            // Old bounded probes do not prove that the proper trunk order is
            // impossible. Retry the partial room with the complete solver,
            // retaining every earlier room rather than its sealed near lane.
            prefix = completed.slice(0, first)
            const kept = new Set([...prefix, ...members])
            order = [...prefix, ...[...members].sort((a, b) => reach(b) - reach(a)), ...seedOrders[0].filter((circle) => !kept.has(circle))]
          }
          search.pendingSeeds.unshift({ strategy: 'retained-prefix', order, next: prefix.length,
            routes: { ...warm.routes, refined: prefix.flatMap((circle) => [circle * 2, circle * 2 + 1]), failures: [] } })
        }
        search.queue = []; search.seen = []; search.expanded = 0; search.active = undefined; search.bestSeed = undefined
      }
      // Paired field entrances permit a useful global warm start. Keep an
      // already valid pair when it clears all earlier pairs; repair only the
      // actual conflicts, farthest rooms first. Independent shortest paths
      // otherwise produce dozens of crossings before the priority search can
      // even begin. Its full conflict-driven fallback remains available.
      while (!search.seeded && !search.solution) {
        if (!search.seed) {
          search.seed = search.pendingSeeds!.shift()!
          search.triedSeeds!.push(search.seed.order.join(','))
        }
        const seed = search.seed
        restore(seed.routes)
        for (; seed.next < seed.order.length; seed.next++) {
          checkpoint()
          const circle = seed.order[seed.next], pair = [circle * 2, circle * 2 + 1]
          const accepted = [...refined], ids = new Set(pair.map((goal) => envelopes[goal].id))
          const audit = auditHeatingPlan([...coils, ...(options.preserved ?? []), ...[...accepted, ...pair].map((goal) => envelopes[goal])],
            [], settings.design, [...(options.obstacles ?? [])], { focusPipeIds: ids, stopOnConflict: true, checkpoint })
          if (!audit.errors) { for (const goal of pair) if (!refined.includes(goal)) refined.push(goal) }
          else if (!connectPair(circle)) break
          seed.routes = snapshot()
          options.onProgress?.(refined.length, coils.length, state.routeAttempts ?? 0)
        }
        if (seed.next === seed.order.length) {
          const candidate = assess([])
          if (!candidate.errors) search.solution = candidate.routes
        }
        if (!search.solution && seed.next > 0) {
          // Keep the repaired prefix as a search candidate. Returning directly
          // to independent shortest paths would throw away valid global work.
          restore(seed.routes); search.queue.push(assess([]))
          if (seed.next < seed.order.length && (!search.bestSeed || seed.next > search.bestSeed.completed)) search.bestSeed = {
            routes: seed.routes, completed: seed.next, blocked: seed.order[seed.next] }
          if (seed.next < seed.order.length) {
            // Keep completed rooms and undo only the blocked room. Different
            // rooms need different local port orders; flipping one global
            // order throws away the room combinations that already worked.
            const blocked = seed.order[seed.next], members = [...rooms.values()].find((group) => group.includes(blocked))!
            const first = seed.order.findIndex((circle) => members.includes(circle))
            const local = seed.order.filter((circle) => members.includes(circle)), index = local.indexOf(blocked)
            if (parallelEntries(members)) {
              const sorted = [...local].sort((a, b) => reach(b) - reach(a))
              const canonical = [...seed.order.slice(0, first), ...sorted, ...seed.order.slice(first + local.length)]
              if (!search.triedSeeds!.includes(canonical.join(','))) {
                search.pendingSeeds = search.pendingSeeds!.filter((other) => other.order.join(',') !== canonical.join(','))
                search.pendingSeeds.push({ strategy: 'room-canonical', order: canonical, next: first,
                  routes: { ...seed.routes, refined: seed.order.slice(0, first).flatMap((circle) => [circle * 2, circle * 2 + 1]), failures: [] } })
              }
            }
            for (let insertion = index - 1; insertion >= 0; insertion--) {
              const changed = local.filter((circle) => circle !== blocked); changed.splice(insertion, 0, blocked)
              const repaired = [...seed.order.slice(0, first), ...changed, ...seed.order.slice(first + local.length)]
              if (!search.triedSeeds!.includes(repaired.join(','))) {
                search.pendingSeeds = search.pendingSeeds!.filter((other) => other.order.join(',') !== repaired.join(','))
                search.pendingSeeds.push({ strategy: 'room-local', order: repaired, next: first, routes: { ...seed.routes,
                  refined: seed.order.slice(0, first).flatMap((circle) => [circle * 2, circle * 2 + 1]), failures: [] } })
              }
            }
            // A nearby transit room can own the inside of a shared bend.
            // If local swaps cannot open it, give that room the trunk first.
            const promoted = [...[...members].sort((a, b) => reach(b) - reach(a)),
              ...seed.order.filter((circle) => !members.includes(circle))]
            if (first > 0 && !search.triedSeeds!.includes(promoted.join(','))) {
              search.pendingSeeds = search.pendingSeeds!.filter((other) => other.order.join(',') !== promoted.join(','))
              search.pendingSeeds.push({ strategy: members.length === 1 || seed.next < coils.length - 2 ? 'bottleneck-room' : undefined,
                order: promoted, next: 0, routes: { ...seed.routes, refined: [], failures: [] } })
            }
            // Preserve completed rooms before trying a global promotion. A
            // three-order ceiling used to discard these local combinations.
            search.pendingSeeds!.sort((a, b) => Number(b.strategy === 'bottleneck-room') - Number(a.strategy === 'bottleneck-room') ||
              b.next - a.next || Number(b.strategy === 'room-canonical') - Number(a.strategy === 'room-canonical') ||
              Number(b.strategy === 'room-local') - Number(a.strategy === 'room-local'))
          }
        }
        // When several circuits remain, another inlet is more useful than
        // exhausting every room ordering behind the same sealed entrance.
        // Near-complete bundles retain the deeper local-order search.
        const seedLimit = search.bestSeed && search.bestSeed.completed >= coils.length - 2
          ? Math.min(8, Math.max(3, rooms.size + 1)) : 2
        search.seeded = !search.pendingSeeds!.length || search.triedSeeds!.length >= seedLimit; search.seed = undefined
        if (!search.solution) restore(search.root!)
      }
      if (!search.solution && !search.queue.length && !search.active && !search.expanded) {
        restore(search.root!); search.queue.push(assess([])); search.seen.push('')
      }
      const ancestors = (circle: number, edges: [number, number][]) => {
        const result = new Set<number>(), pending = [circle]
        while (pending.length) {
          const lower = pending.pop()!
          for (const [higher, child] of edges) if (child === lower && !result.has(higher)) { result.add(higher); pending.push(higher) }
        }
        return result
      }
      let best: PriorityNode | undefined
      // A sealed field inlet needs a different field entrance. Bound the
      // priority search per layout so alternative entrances are actually tried,
      // rather than spending every resumed interval on the same sealed seam.
      const nearComplete = search.bestSeed && search.bestSeed.completed >= coils.length - 2
      const priorityLimit = !nearComplete && search.bestSeed && search.bestSeed.completed >= Math.ceil(coils.length / 3) ? 0 : 8
      while (!search.solution && (search.active || search.queue.length) && search.expanded < priorityLimit) {
        checkpoint()
        if (!search.active) {
          search.queue.sort((a, b) => a.errors - b.errors || a.cost - b.cost)
          const node = search.queue.shift()!
          if (!best || node.errors < best.errors) best = node
          if (!node.errors) { restore(node.routes); search.solution = node.routes; break }
          if (!node.conflict) { search.expanded++; continue }
          search.active = { node, branch: 0 }
          options.onProgress?.(node.safeGoals, coils.length, state.routeAttempts ?? 0)
        }
        const active = search.active
        while (active.branch < 2) {
          checkpoint()
          if (!active.edges) {
            const pair = active.node.conflict!, higher = pair[active.branch], lower = pair[1 - active.branch]
            if (ancestors(higher, active.node.edges).has(lower)) { active.branch++; continue }
            const edges: [number, number][] = [...active.node.edges, [higher, lower]]
            const key = edges.map(([a, b]) => `${a}>${b}`).sort().join(',')
            if (search.seen.includes(key)) { active.branch++; continue }
            search.seen.push(key); active.edges = edges
            active.affected = coils.map((_, circle) => circle).filter((circle) => circle === lower || ancestors(circle, edges).has(lower))
              .sort((a, b) => ancestors(a, edges).size - ancestors(b, edges).size)
            active.next = 0; active.candidate = active.node.routes
          }
          restore(active.candidate!)
          let valid = true
          for (let i = active.next!; i < active.affected!.length; i++) {
            const circle = active.affected![i], above = ancestors(circle, active.edges)
            refined.splice(0, refined.length, ...[...above].flatMap((other) => [other * 2, other * 2 + 1])); failures.splice(0)
            if (!connectPair(circle)) { valid = false; break }
            active.candidate = snapshot(); active.next = i + 1
          }
          if (valid) {
            const candidate = assess(active.edges)
            if (!candidate.errors) { restore(candidate.routes); search.solution = candidate.routes; break }
            search.queue.push(candidate)
            if (search.queue.length > 64) { search.queue.sort((a, b) => a.errors - b.errors || a.cost - b.cost); search.queue.length = 64 }
            if (!best || candidate.errors < best.errors) best = candidate
            options.onProgress?.(candidate.safeGoals, coils.length, state.routeAttempts ?? 0)
          }
          active.branch++; active.edges = undefined; active.candidate = undefined; active.affected = undefined; active.next = undefined
        }
        if (search.solution) break
        search.active = undefined; search.expanded++
      }
      if (!search.solution && best) restore(best.routes)
    }
    if (search.solution) { refined.splice(0, refined.length, ...flows.map((_, goal) => goal)); failures.splice(0) }
    else {
      // Only genuinely collision-free subsets may be accepted by callers.
      if (search.bestSeed) {
        restore(search.bestSeed.routes)
        const circle = search.bestSeed.blocked
        failures.splice(0, failures.length, ...[circle * 2, circle * 2 + 1].map((goal) => ({
          goal, reason: 'bundle-entry', point: endpoints[goal] })))
      }
      refined.splice(0)
      if (!failures.length) {
        const conflicts = auditHeatingPlan([...coils, ...(options.preserved ?? []), ...envelopes], [], settings.design, [], { checkpoint }).issues
          .find((issue) => issue.severity === 'error' && issue.code === 'collision')?.circuits ?? []
        for (let goal = 0; goal < flows.length; goal++) if (!conflicts.length || conflicts.includes(coils[Math.floor(goal / 2)].heating!.circuitId!)) failures.push({ goal, reason: 'bundle-conflict', point: endpoints[goal] })
      }
    }
    return finish()
  }
  if (coils.length === 1 && options.scene && options.sourcePosition && refined.length < 2) {
    const fixed = [...options.preserved ?? []]
    const walls = roomWalls(grid.room[grid.index(endpoints[0])])
    const key = JSON.stringify(['single-door-adapter-v1', settings, scale, options.sourcePosition,
      options.sourceRadiusMm, geometryFor(coils[0]).points, fixed.map((pipe) => [pipe.heating!.circuitId, geometryFor(pipe).points])])
    if (tryDoorAdapter(0, fixed, walls, key)) return finish()
  }
  // Route and, if necessary, undo whole pairs. One successful supply must not
  // strand its own return or become a committed half-circuit.
  for (let pass = state.pass ?? 0; pass < 3; pass++) {
    const currentOrder = state.order ?? order
    state.pass = pass; state.order = currentOrder
    const signature = currentOrder.join(',')
    state.triedOrders ??= []
    if (!state.triedOrders.includes(signature)) state.triedOrders.push(signature)
    for (const circuit of currentOrder) {
      const pair = [circuit * 2, circuit * 2 + 1]
      if (pair.every((goal) => refined.includes(goal))) continue
      for (let i = failures.length - 1; i >= 0; i--) if (pair.includes(failures[i].goal)) failures.splice(i, 1)
      const snapshot = pair.map((goal) => ({ goal, path: paths[goal], points: points[goal], source: sources[goal], radius: radii[goal], envelope: envelopes[goal] }))
      const startCount = refined.length, failureCount = failures.length
      const restore = () => {
        refined.splice(startCount); failures.splice(failureCount)
        for (const saved of snapshot) { radii[saved.goal] = saved.radius; paths[saved.goal] = saved.path; points[saved.goal] = saved.points; sources[saved.goal] = saved.source; envelopes[saved.goal] = saved.envelope }
      }
      const first = paths[pair[0]].length >= paths[pair[1]].length ? pair : [...pair].reverse()
      let success = false, rejected: typeof failures = []
      try {
        for (const sequence of [first, [...first].reverse()]) {
          restore()
          const a = routeGoal(sequence[0]), b = a && routeGoal(sequence[1])
          if (a && b) { success = true; break }
          rejected = failures.slice(failureCount)
        }
      } catch (error) {
        // A pause retains completed pairs, never an unfinished half-circuit.
        restore(); throw error
      }
      if (!success) {
        restore()
        for (const goal of pair) failures.push(rejected.find((failure) => failure.goal === goal) ?? { goal, reason: 'partner-route', point: endpoints[goal] })
      }
      options.onProgress?.(refined.length)
    }
    if (!state.best || refined.length > state.best.refined.length) state.best = {
      paths: [...paths], points: [...points], sources: [...sources], bendRadiusMm: [...radii], refined: [...refined], failures: [...failures] }
    if (refined.length === flows.length || pass === 2) break
    // A successful greedy pair can block a later one at a doorway. Give the
    // stranded pairs first choice on the next *different* bundle ordering.
    // Repeating them behind the same fixed feeds cannot solve that blockage.
    const stranded = currentOrder.filter((circuit) => !refined.includes(circuit * 2))
    let nextOrder = [...stranded, ...currentOrder.filter((circuit) => !stranded.includes(circuit))]
    if (state.triedOrders.includes(nextOrder.join(','))) nextOrder = [...currentOrder].reverse()
    if (state.triedOrders.includes(nextOrder.join(','))) break
    state.order = nextOrder; state.pass = pass + 1
    refined.splice(0); failures.splice(0)
  }
  if (state.best && state.best.refined.length > refined.length) {
    paths.splice(0, paths.length, ...state.best.paths); points.splice(0, points.length, ...state.best.points)
    sources.splice(0, sources.length, ...state.best.sources); radii.splice(0, radii.length, ...state.best.bendRadiusMm)
    refined.splice(0, refined.length, ...state.best.refined); failures.splice(0, failures.length, ...state.best.failures)
  }
  return finish()
}
