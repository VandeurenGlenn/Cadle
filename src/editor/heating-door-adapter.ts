import type { Point, RectShape, Shape } from './model/types.js'
import type { HeatingGrid, HeatingRoutingOptions } from './heating-routing.js'
import { heatingCurveWallConflict, heatingSourceRoom, simplifyHeatingPath } from './heating-routing.js'
import { heatingFieldEntryGuards } from './heating-field-entry-guards.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { createHeatingPipe } from './heating-pipe.js'
import { routePairedHeatingFeeds } from './heating-paired-route.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingRoomKey } from './heating-coverage.js'
import { heatingFeedGrid } from './heating-feed-grid.js'
import { heatingEntrySealsOtherLaunch } from './heating-entry-enclosure.js'

export type HeatingDoorAdapterWork = {
  local?: RectShape[] | null; localRejected?: string[][]; globalRejected?: string[]; budget?: { remaining: number }
}
type Settings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }
type Vertex = Point & { bendRadiusMm?: number }

/** A room's physically routed entry is the terminal for the global leaders.
 * Treat both proven local tails as a temporary extension of the coil, route
 * the remaining pair, then return complete leaders at the original ports. */
export const routeDoorAdaptedHeatingFeeds = (grid: HeatingGrid, scene: readonly Shape[], coil: RectShape,
  coils: readonly RectShape[], fixed: readonly RectShape[], settings: Settings, scale: number,
  options: { source: Point; sourceRadiusMm: number; target?: Point; targetRadiusMm?: number;
    nativeFloor: HeatingGrid; nativeWallCells: ReadonlySet<number>; permittedWallCells: ReadonlySet<number>;
    obstacles?: readonly { x: number; y: number; width: number; height: number }[]; geometryFor?: typeof heatingPipeGeometry;
    routeOptions?: Pick<HeatingRoutingOptions, 'wallEntryPenalty' | 'preferredDoors' | 'manifoldAccess'>;
    work: HeatingDoorAdapterWork; localHint?: readonly RectShape[]; searchBudget?: { remaining: number }; searchKey: string;
    checkpoint: () => void; onSearch?: () => void }): [Vertex[], Vertex[]] | null => {
  const { work, nativeFloor, checkpoint } = options
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), geometryFor = options.geometryFor ?? heatingPipeGeometry
  const budget = options.searchBudget ?? (work.budget ??= { remaining: 24 })
  if (budget.remaining <= 0) return null
  checkpoint()
  const points = geometryFor(coil).points
  const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
  if (work.local === undefined && options.localHint?.length === 2) {
    const hint = options.localHint, incoming = geometryFor(hint[0]).points, outgoing = geometryFor(hint[1]).points
    // A proved room entry is independent of its global source lane. Reuse it
    // only while the newly committed leaders leave the complete entry clear.
    if (close(incoming.at(-1)!, points[0]) && close(outgoing[0], points.at(-1)!) &&
      !hint.some((pipe) => geometryFor(pipe).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
        heatingCurveWallConflict(nativeFloor, geometryFor(pipe).pieces, { allowWalls: true, permittedWallCells: new Set() })) &&
      !checkHeatingPlan([...coils, ...fixed, ...hint], [], settings.design, [...options.obstacles ?? []], {
        focusPipeIds: new Set(hint.map((pipe) => pipe.id)), stopOnConflict: true, geometryFor, checkpoint }).errors &&
      !heatingEntrySealsOtherLaunch(coil, hint, [...coils, ...fixed], settings, scale, {
        grid: heatingFeedGrid(nativeFloor, scale, checkpoint), nativeFloor, nativeWallCells: new Set(), permittedWallCells: new Set(),
        source: options.source, obstacles: options.obstacles, checkpoint, baseline: new Map() })) work.local = [...hint]
  }
  if (work.local === undefined) {
    const members = new Set(coil.heating!.roomMembers?.map((room) => room.key) ?? (coil.heating!.roomKey ? [coil.heating!.roomKey] : []))
    const ids = new Set(nativeFloor.rooms.filter((room) => members.has(heatingRoomKey(room))).map((room) => room.id))
    if (!ids.size) for (const point of [points[0], points.at(-1)!]) {
      const room = nativeFloor.room[nativeFloor.index(point)]
      if (room > 0) ids.add(room)
    }
    const local = heatingFieldEntryGuards(nativeFloor, scene, coil, [...coils, ...fixed], ids,
      options.source, settings, scale, { obstacles: [...options.obstacles ?? []], checkpoint,
        searchBudget: budget, searchKey: `${options.searchKey}:entry`, rejectedSearches: work.localRejected ??= [], onSearch: options.onSearch })
    // Only completed computations enter this state; a pause propagates while
    // retaining its rejected queries and the live route search frontier.
    if (local) work.local = local
    else if (budget.remaining > 0) work.local = null
  }
  if (!work.local || budget.remaining <= 0) return null
  const incoming = geometryFor(work.local[0]).points, outgoing = geometryFor(work.local[1]).points
  if (!close(incoming.at(-1)!, points[0]) || !close(outgoing[0], points.at(-1)!)) return null
  const proxy = createHeatingPipe(`${coil.id}-door-adapter`,
    simplifyHeatingPath([...incoming, ...points.slice(1), ...outgoing.slice(1)]), coil.heating!)
  const proxyLengthM = geometryFor(proxy).length * scale / 8000
  if (proxyLengthM + limits.allowanceM > limits.maxCircuitLengthM + .05) return null
  const all = coils.map((other) => other === coil ? proxy : other)
  // Native curves and the fixed priority prefix decide clearance. The old
  // coarse field footprint/flow hints still point at the original coil seam,
  // so they are intentionally left to the ordinary fallback search below.
  const routingGrid = heatingFeedGrid(grid, scale, checkpoint)
  const convertMask = (mask: ReadonlySet<number>): ReadonlySet<number> => {
    if (routingGrid === grid) return mask
    const converted = new Set<number>(), extent = Math.ceil(grid.step / routingGrid.step)
    for (const cell of mask) {
      const centre = routingGrid.index(grid.point(cell)), x = centre % routingGrid.width, y = Math.floor(centre / routingGrid.width)
      for (let dy = -extent; dy <= extent; dy++) for (let dx = -extent; dx <= extent; dx++) {
        if (x + dx < 0 || x + dx >= routingGrid.width || y + dy < 0 || y + dy >= routingGrid.height) continue
        const fine = (y + dy) * routingGrid.width + x + dx
        if (grid.index(routingGrid.point(fine)) === cell) converted.add(fine)
      }
    }
    return converted
  }
  const permittedWallCells = convertMask(options.permittedWallCells), factor = grid.step / routingGrid.step
  const routeOptions = routingGrid === grid || !options.routeOptions ? options.routeOptions : {
    ...options.routeOptions,
    ...(options.routeOptions.wallEntryPenalty === undefined ? {} : { wallEntryPenalty: options.routeOptions.wallEntryPenalty * factor }),
    ...(options.routeOptions.manifoldAccess ? { manifoldAccess: { ...options.routeOptions.manifoldAccess,
      entryPenalty: options.routeOptions.manifoldAccess.entryPenalty * factor } } : {}),
    ...(options.routeOptions.preferredDoors ? { preferredDoors: convertMask(options.routeOptions.preferredDoors) } : {}),
  }
  const baseline = new Map<RectShape, number>()
  const leaders = routePairedHeatingFeeds(routingGrid, proxy, all, fixed, settings, scale, {
    source: options.source, sourceRadiusMm: options.sourceRadiusMm, target: options.target, targetRadiusMm: options.targetRadiusMm,
    nativeFloor, nativeWallCells: options.nativeWallCells, permittedWallCells,
    obstacles: options.obstacles, geometryFor, routeOptions,
    searchBudget: budget, searchKey: `${options.searchKey}:leaders`, rejectedSearches: work.globalRejected ??= [], checkpoint, onSearch: options.onSearch,
    acceptPair: (candidate) => proxyLengthM + candidate.reduce((sum, pipe) => sum + geometryFor(pipe).length * scale / 8000, 0) +
      limits.allowanceM <= limits.maxCircuitLengthM + .05 && !heatingEntrySealsOtherLaunch(proxy, candidate, [...all, ...fixed], settings, scale, {
      grid: routingGrid, nativeFloor, nativeWallCells: options.nativeWallCells, permittedWallCells, source: options.source,
      sourceRadiusMm: options.sourceRadiusMm, obstacles: options.obstacles, checkpoint, baseline }) })
  if (!leaders) return null
  const complete = [simplifyHeatingPath([...leaders[0], ...incoming.slice(1)]),
    simplifyHeatingPath([...leaders[1], ...[...outgoing].reverse().slice(1)])] as [Vertex[], Vertex[]]
  const feeds = complete.map((vertices, index) => createHeatingPipe(`${coil.id}-adapted-${index}`,
    index ? [...vertices].reverse() : vertices, { ...coil.heating!, pipeRole: index ? 'return' : 'supply', bendRadiusMm: limits.minBendRadiusMm }))
  const sourceRoom = heatingSourceRoom(nativeFloor, options.source)
  const sourceRadius = options.sourceRadiusMm * 8 / scale
  if (complete.some((vertices) => {
    const root = vertices[0], cell = nativeFloor.index(root)
    return cell < 0 || nativeFloor.obstacle[cell] || nativeFloor.room[cell] !== sourceRoom?.id ||
      Math.hypot(root.x - options.source.x, root.y - options.source.y) > sourceRadius + 1e-6
  })) return null
  if (feeds.some((feed) => geometryFor(feed).bends.some((bend) => bend.radiusMm < limits.minBendRadiusMm - .1) ||
    heatingCurveWallConflict(nativeFloor, geometryFor(feed).pieces, { allowWalls: true, permittedWallCells: options.nativeWallCells }))) return null
  if ((geometryFor(coil).length + feeds.reduce((sum, feed) => sum + geometryFor(feed).length, 0)) * scale / 8000 +
    limits.allowanceM > limits.maxCircuitLengthM + .05) return null
  if (checkHeatingPlan([...coils, ...fixed, ...feeds], [], settings.design, [...options.obstacles ?? []], {
    focusPipeIds: new Set(feeds.map((feed) => feed.id)), stopOnConflict: true, geometryFor, checkpoint }).errors) return null
  return complete
}
