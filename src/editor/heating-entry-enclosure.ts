import type { Point, RectShape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingDesignInputs } from './heating-design.js'
import { routePairedHeatingFeeds } from './heating-paired-route.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingPipeGeometry, type PipeGeometry } from './heating-geometry.js'
import { heatingSourceShortcutRooms } from './heating-wall-policy.js'

type Settings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }
type LaunchContext = {
  grid: HeatingGrid; nativeFloor: HeatingGrid; nativeWallCells: ReadonlySet<number>; permittedWallCells: ReadonlySet<number>;
  source: Point; sourceRadiusMm?: number; obstacles?: readonly { x: number; y: number; width: number; height: number }[];
  checkpoint: () => void; baseline: Map<RectShape, number>;
}
type PrefixCache = { prefixes: Map<RectShape, readonly (readonly RectShape[])[]>; geometry: WeakMap<RectShape, PipeGeometry>; shortcutRooms: ReadonlySet<number> }
const caches = new WeakMap<Map<RectShape, number>, PrefixCache>()

/** Keep an existing R80 launch at every pending coil mouth. Collision-free
 * feeds can curl around another field and consume all of its launch space.
 * Reuse the actual paired router's audited launch prefixes. Adding a candidate
 * can only remove those launches; checking its tubes against each cached
 * prefix is sufficient and avoids auditing the entire floor repeatedly.
 * A zero search budget stops baseline generation before any path search.
 * The caller owns one baseline map per immutable coils/fixed-feeds context.
 * This preserves available launches; it does not claim a complete connection
 * is possible or impossible, and leaves already connected circuits alone.
 */
export const heatingEntrySealsOtherLaunch = (host: RectShape, pair: readonly RectShape[], coils: readonly RectShape[],
  settings: Settings, scale: number, options: LaunchContext): boolean => {
  const loops = coils.filter((pipe) => pipe.heating?.pipeRole === 'loop')
  const fixed = coils.filter((pipe) => pipe.heating?.pipeRole !== 'loop')
  const connected = new Set(fixed.map((pipe) => pipe.heating?.circuitId).filter(Boolean))
  let cache = caches.get(options.baseline)
  if (!cache) { cache = { prefixes: new Map(), geometry: new WeakMap(),
    shortcutRooms: heatingSourceShortcutRooms(options.nativeFloor, options.source, options.nativeWallCells, scale) }; caches.set(options.baseline, cache) }
  const geometryFor = (pipe: RectShape) => {
    let geometry = cache!.geometry.get(pipe)
    if (!geometry) { geometry = heatingPipeGeometry(pipe); cache!.geometry.set(pipe, geometry) }
    return geometry
  }
  const prepare = (coil: RectShape) => {
    let launches = 0
    let prefixes: readonly (readonly RectShape[])[] = []
    routePairedHeatingFeeds(options.grid, coil, loops, fixed, settings, scale, {
      source: options.source, sourceRadiusMm: options.sourceRadiusMm ?? 256,
      nativeFloor: options.nativeFloor, nativeWallCells: options.nativeWallCells, permittedWallCells: options.permittedWallCells,
      obstacles: options.obstacles, searchBudget: { remaining: 0 }, checkpoint: options.checkpoint, geometryFor,
      onLaunches: (value, validated) => { launches = value; prefixes = validated },
    })
    options.baseline.set(coil, launches); cache!.prefixes.set(coil, prefixes)
  }
  for (const other of loops) {
    if (other.id === host.id || connected.has(other.heating!.circuitId)) continue
    // Such feeds may cross the source wall as separate straight legs before
    // fanning in. The rigid local ribbon's launch set is not a necessary
    // condition for that physically audited route.
    const head = geometryFor(other).points[0]
    if (!head) continue
    const cell = options.nativeFloor.index(head)
    if (cell >= 0 && cache.shortcutRooms.has(options.nativeFloor.room[cell])) continue
    if (options.baseline.get(other) === 0) continue
    if (!cache.prefixes.has(other)) prepare(other)
    const prefixes = cache.prefixes.get(other)!
    if (!prefixes.length) continue
    const preserved = prefixes.some((prefix) => !checkHeatingPlan([...pair, ...prefix], [], settings.design, [], {
      focusPipeIds: new Set(prefix.map((pipe) => pipe.id)), stopOnConflict: true, checkpoint: options.checkpoint, geometryFor,
    }).errors)
    if (!preserved) return true
  }
  return false
}
