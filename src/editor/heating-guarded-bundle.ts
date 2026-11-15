import type { Point, RectShape } from './model/types.js'
import { createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance } from './heating-clearance.js'
import { routeHeatingBundle } from './heating-bundle.js'
import { MAX_HEATING_CIRCUITS } from './heating-design.js'
import { heatingWallAllowed, simplifyHeatingPath, type HeatingGrid, type HeatingRoutingOptions } from './heating-routing.js'

type LocalPair = readonly [RectShape, RectShape] | readonly RectShape[] | undefined
type Vertex = Point & { bendRadiusMm?: number }
export type HeatingGuardedBundle = {
  coils: RectShape[]; targetStubs: number[][]; blocked: Uint8Array;
  flows: { source: number; cells: number[] }[];
  /** Both tails run from the door terminal to the original coil joint. */
  tails: [Vertex[], Vertex[]][]
}
const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6

/** Make every proved room entry solid before routing the common leaders.
 * Original coils remain unchanged. The temporary extended coils make it
 * impossible for an early leader to close another field's future entrance. */
export const prepareHeatingGuardedBundle = (grid: HeatingGrid, sourceStubs: readonly number[][],
  originalCoils: readonly RectShape[], localPairs: readonly LocalPair[], originalBlocked: Uint8Array,
  options: HeatingRoutingOptions = {}): HeatingGuardedBundle | null => {
  if (!originalCoils.length || originalCoils.length > MAX_HEATING_CIRCUITS || localPairs.length !== originalCoils.length ||
    originalBlocked.length !== grid.wall.length || sourceStubs.length < originalCoils.length * 2 ||
    sourceStubs.some((stub) => !stub.length || stub.some((cell) => !Number.isInteger(cell) || cell < 0 || cell >= grid.wall.length))) return null
  const ids = originalCoils.map((coil) => coil.heating?.circuitId)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length || originalCoils.some((coil) =>
    coil.heating?.kind !== 'pipe' || coil.heating.pipeRole !== 'loop' || coil.heating.drawingScale !== grid.drawingScale)) return null
  const coils: RectShape[] = [], tails: HeatingGuardedBundle['tails'] = []
  for (const [index, coil] of originalCoils.entries()) {
    options.checkpoint?.()
    const points = heatingPipeGeometry(coil).points as Vertex[], pair = localPairs[index]
    if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null
    if (!pair) { coils.push(coil); tails.push([[points[0]], [points.at(-1)!]]); continue }
    if (pair.length !== 2 || pair.some((pipe) => pipe.heating?.kind !== 'pipe' || pipe.heating.circuitId !== coil.heating!.circuitId ||
      pipe.heating.diameterMm !== coil.heating!.diameterMm || pipe.heating.drawingScale !== grid.drawingScale)) return null
    const incoming = heatingPipeGeometry(pair[0]).points as Vertex[], outgoing = heatingPipeGeometry(pair[1]).points as Vertex[]
    if (incoming.length < 2 || outgoing.length < 2 || !close(incoming.at(-1)!, points[0]) || !close(outgoing[0], points.at(-1)!)) return null
    coils.push(createHeatingPipe(coil.id, simplifyHeatingPath([...incoming, ...points.slice(1), ...outgoing.slice(1)]), coil.heating!))
    tails.push([incoming.map((point) => ({ ...point })), [...outgoing].reverse().map((point) => ({ ...point }))])
  }
  const targetStubs: number[][] = []
  for (const coil of coils) {
    const points = heatingPipeGeometry(coil).points
    for (const [head, next] of [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]]) {
      const dx = head.x - next.x, dy = head.y - next.y
      // Raster flow needs a genuine cardinal terminal tangent. Its cells are
      // hints; the physical refiner restores the exact fractional door joint.
      if (Math.hypot(dx, dy) < 1e-7 || Math.min(Math.abs(dx), Math.abs(dy)) > 1e-6) return null
      const cell = grid.index(head), direction = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * grid.width
      const end = cell + direction
      if (cell < 0 || end < 0 || end >= grid.wall.length || Math.abs(grid.point(cell).x - grid.point(end).x) > grid.step * 1.01) return null
      targetStubs.push([cell, end])
    }
  }
  const blocked = originalBlocked.slice(), joints = new Map(coils.map((coil) => {
    const points = heatingPipeGeometry(coil).points
    return [coil.id, [points[0], points.at(-1)!]] as const
  }))
  // Keep the caller's native field/obstacle mask, and add the actual local
  // tails. A morphological field outline would also close useful concavities.
  const diameter = Math.max(...coils.map((coil) => coil.heating!.diameterMm))
  const free = heatingPointClearance(coils, diameter, grid.drawingScale, { joints })
  for (let cell = 0; cell < blocked.length; cell++) {
    if (cell % 4096 === 0) options.checkpoint?.()
    if (!blocked[cell] && !free(grid.point(cell))) blocked[cell] = 1
  }
  for (const stub of [...sourceStubs, ...targetStubs]) {
    if (stub.some((cell) => cell < 0 || cell >= grid.wall.length || grid.obstacle[cell] || !heatingWallAllowed(grid, cell, options))) return null
    for (const cell of stub.slice(0, -1)) blocked[cell] = 1
  }
  const sources = sourceStubs.map((stub) => stub.at(-1)!), goals = targetStubs.map((stub) => stub.at(-1)!)
  if ([...sources, ...goals].some((cell) => blocked[cell])) return null
  const flows = routeHeatingBundle(grid, sources, goals, blocked, options)
  return flows ? { coils, targetStubs, blocked, flows, tails } : null
}

/** Return complete source-to-original-joint leaders, never proxy endpoints. */
export const mergeHeatingGuardedFeeds = (bundle: Pick<HeatingGuardedBundle, 'coils' | 'tails'>,
  leaders: readonly (readonly Vertex[])[]): Vertex[][] | null => {
  if (leaders.length !== bundle.coils.length * 2 || bundle.tails.length !== bundle.coils.length) return null
  const complete: Vertex[][] = []
  for (let index = 0; index < bundle.coils.length; index++) for (let role = 0; role < 2; role++) {
    const leader = leaders[index * 2 + role], tail = bundle.tails[index][role]
    if (!leader.length || !tail.length || leader.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
      !close(leader.at(-1)!, tail[0])) return null
    complete.push(simplifyHeatingPath([...leader.map((point) => ({ ...point })), ...tail.slice(1).map((point) => ({ ...point }))]))
  }
  return complete
}
