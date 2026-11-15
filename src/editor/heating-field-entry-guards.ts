import type { Point, RectShape, Shape } from './model/types.js'
import type { HeatingAreaSettings } from './heating-area-kernel.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingDoorSymbolThreshold, isHeatingDoorSymbol } from './heating-openings.js'
import { heatingDesignLimits } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { createHeatingPipe } from './heating-pipe.js'
import { routePairedHeatingFeeds } from './heating-paired-route.js'
import { heatingFeedGrid } from './heating-feed-grid.js'
import { heatingEntrySealsOtherLaunch } from './heating-entry-enclosure.js'

/** Reserve a physical pair through the host room's doorway before inserting
 * another laying area. A short tangent alone does not preserve the mouth:
 * a later splice can wrap around both tips and imprison the return. */
export const heatingFieldEntryGuards = (grid: HeatingGrid, scene: readonly Shape[], host: RectShape,
  coils: readonly RectShape[], roomIds: ReadonlySet<number>, source: Point, settings: HeatingAreaSettings, scale: number,
  options: { obstacles?: { x: number; y: number; width: number; height: number }[]; checkpoint: () => void;
    searchBudget?: { remaining: number }; searchKey?: string; rejectedSearches?: string[][]; onSearch?: () => void;
    acceptPair?: (pipes: readonly RectShape[]) => boolean }): RectShape[] | null | undefined => {
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), radius = limits.minBendRadiusMm * 8 / scale
  const vertices = heatingPipeGeometry(host).points, first = vertices[0], last = vertices.at(-1)!
  const middle = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
  const ownSource = roomIds.has(grid.room[grid.index(source)])
  // An anchor inside the same laying room needs no inter-room doorway pair.
  if (ownSource) return undefined
  const targets: Point[] = []
  for (const shape of scene) {
    const door = shape.kind === 'door' ? shape : isHeatingDoorSymbol(shape) ? heatingDoorSymbolThreshold(shape) : undefined
    if (!door || shape.hidden) continue
    const dx = door.end.x - door.start.x, dy = door.end.y - door.start.y, length = Math.hypot(dx, dy)
    if (!length) continue
    const centre = { x: (door.start.x + door.end.x) / 2, y: (door.start.y + door.end.y) / 2 }
    for (const side of [-1, 1]) {
      const inside = { x: centre.x - dy / length * radius * 2 * side, y: centre.y + dx / length * radius * 2 * side }
      const outside = { x: centre.x + dy / length * radius * 2 * side, y: centre.y - dx / length * radius * 2 * side }
      const a = grid.index(inside), b = grid.index(outside)
      if (a < 0 || b < 0 || !roomIds.has(grid.room[a]) || roomIds.has(grid.room[b]) || grid.room[b] <= 0 || grid.obstacle[b]) continue
      targets.push(outside)
    }
  }
  // Drawings with an open source or no recognised room door retain their
  // existing tangent strategy; absence of a door is not proof of enclosure.
  if (!targets.length) return undefined
  targets.sort((a, b) => Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y))
  const routingGrid = heatingFeedGrid(grid, scale, options.checkpoint), baseline = new Map<RectShape, number>()
  for (const [targetIndex, target] of targets.slice(0, 3).entries()) {
    if (options.searchBudget && options.searchBudget.remaining <= 0) return null
    const rejected = options.rejectedSearches ? options.rejectedSearches[targetIndex] ??= [] : undefined
    options.checkpoint()
    const pair = routePairedHeatingFeeds(routingGrid, host, coils, [], settings, scale, {
      source: target, sourceRadiusMm: Math.max(250, limits.minBendRadiusMm * 3 + settings.diameterMm),
      nativeFloor: grid, nativeWallCells: new Set(),
      permittedWallCells: new Set(), obstacles: options.obstacles, checkpoint: options.checkpoint, searchBudget: options.searchBudget ?? { remaining: 24 },
      searchKey: options.searchKey ? `${options.searchKey}:door-${targetIndex}` : undefined, rejectedSearches: rejected, onSearch: options.onSearch,
      acceptPair: (candidate) => (!options.acceptPair || options.acceptPair(candidate)) && !heatingEntrySealsOtherLaunch(host, candidate, coils, settings, scale, {
        grid: routingGrid, nativeFloor: grid, nativeWallCells: new Set(), permittedWallCells: new Set(), source: target,
        obstacles: options.obstacles, checkpoint: options.checkpoint, baseline }) })
    if (!pair) continue
    return pair.map((points, index) => createHeatingPipe(`${host.id}-entry-${index}`,
      index ? [...points].reverse() : points, { ...host.heating!, pipeRole: index ? 'return' : 'supply' }))
  }
  return null
}
