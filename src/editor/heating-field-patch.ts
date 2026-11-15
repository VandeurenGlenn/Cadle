import type { Point, RectShape, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import type { HeatingAreaSettings } from './heating-area-kernel.js'
import { heatingRoomKey } from './heating-coverage.js'
import { routeHeating, heatingPathPoints, simplifyHeatingPath, heatingCurveWallConflict } from './heating-routing.js'
import { heatingPipeData, createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance, heatingEntryTangentConflict } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingDesignLimits } from './heating-design.js'
import { heatingSpliceWindows } from './heating-paired-splice.js'
import { heatingFieldEntryGuards } from './heating-field-entry-guards.js'
import { heatingAccessDistances } from './heating-access-distances.js'

const joinHeatingFieldPatchUncached = (jobs: HeatingSpiralField[], patch: HeatingSpiralField,
  native: HeatingGrid, scene: readonly Shape[], settings: HeatingAreaSettings, scale: number,
  options: { source: Point; feedPipes: RectShape[]; checkpoint: () => void; obstacles: { x: number; y: number; width: number; height: number }[];
    completeM: (job: HeatingSpiralField) => number; raster: (points: readonly Point[]) => number[]; reserveFeeds?: boolean; feedCorridor?: Uint8Array }): boolean => {
  const { source, feedPipes, checkpoint, obstacles, completeM, raster } = options
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const pipe = (points: Point[], id: string) => createHeatingPipe(id, points,
    { ...heatingPipeData(scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: id })
  const exact = (points: Point[], at: Point, start: boolean) => {
    const path = start ? points.map((p) => ({ ...p })) : points.map((p) => ({ ...p })).reverse()
    if (path.length > 1) {
      if (Math.abs(path[1].x - path[0].x) < 1e-6) path[1].x = at.x
      else if (Math.abs(path[1].y - path[0].y) < 1e-6) path[1].y = at.y
    }
    path[0] = at
    return start ? path : path.reverse()
  }
    const radius = limits.minBendRadiusMm * 8 / scale, pitch = settings.spacingMm * 8 / scale
    const diameter = settings.diameterMm * 8 / scale
    const hostLengths = jobs.map(completeM), patchLength = heatingPipeGeometry(pipe(patch.points!, 'patch-length')).length * scale / 8000
    const bridgeLength = (a: Point, b: Point) => (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) * scale / 8000
    const windowsFor = (job: HeatingSpiralField) => {
      const points = job.points!, windows = heatingSpliceWindows(points, patch.points!, radius, pitch, diameter)
      const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const sides = new Map<string, typeof windows[number]>()
      for (const window of windows) {
        const a = window.before.at(-1)!, b = window.after[0]
        const side = Math.abs(a.x - b.x) < 1e-6 ? a.x < cx ? 'west' : 'east' : a.y < cy ? 'north' : 'south'
        if (!sides.has(side)) sides.set(side, window)
      }
      // The nearest eight cuts can all lie on the same side of a small room.
      // Keep a doorway-facing cut before spending the rest on nearby windows.
      const chosen = new Set(sides.values())
      return [...chosen, ...windows.filter((window) => !chosen.has(window))].slice(0, 12)
    }
    const fromFirst = heatingAccessDistances(native, [native.index(patch.points![0])], new Set(), true, checkpoint)
    const fromLast = heatingAccessDistances(native, [native.index(patch.points!.at(-1)!)], new Set(), true, checkpoint)
    const approachM = (distances: Int32Array, to: Point, from: Point) => {
      const cell = native.index(to), distance = cell >= 0 ? distances[cell] : -1
      return distance >= 0 ? distance * native.step * scale / 8000 : bridgeLength(from, to)
    }
    const choices = jobs.flatMap((job, index) => windowsFor(job).flatMap((window) => [false, true].map((reverse) => ({ index, ...window, reverse,
        b: reverse ? [...patch.points!].reverse() : patch.points! })))).map((choice) => {
          const start = choice.before.at(-1)!, end = choice.after[0]
          const cutM = Math.hypot(start.x - end.x, start.y - end.y) * scale / 8000
          return { ...choice,
            // Wall-aware approaches rank the doorway-facing cuts before nearby
            // cuts whose straight-line score passes through a closed wall.
            projectedM: hostLengths[choice.index] + patchLength - cutM +
              approachM(choice.reverse ? fromLast : fromFirst, start, choice.b[0]) +
              approachM(choice.reverse ? fromFirst : fromLast, end, choice.b.at(-1)!),
            minimumM: hostLengths[choice.index] + patchLength - cutM +
              (Math.hypot(start.x - choice.b[0].x, start.y - choice.b[0].y) +
               Math.hypot(choice.b.at(-1)!.x - end.x, choice.b.at(-1)!.y - end.y)) * scale / 8000 }
        }).filter((choice) => choice.minimumM <= limits.maxCircuitLengthM + .05)
          .sort((a, b) => a.projectedM - b.projectedM || a.distance - b.distance)
    // A nearby, nearly full coil can contribute every short splice window.
    // Retain a trial for each host before spending the remaining search budget;
    // a farther small-room coil may be the only one with enough length left.
    // The estimate only ranks trials: routed geometry still decides feasibility.
    const bestByHost = new Map<number, typeof choices[number]>()
    for (const choice of choices) if (!bestByHost.has(choice.index)) bestByHost.set(choice.index, choice)
    const trials = [...bestByHost.values(), ...choices.filter((choice) => bestByHost.get(choice.index) !== choice)].slice(0, 24)
    const originalPipes = [...jobs, patch].map((job, i) => pipe(job.points!, `area-${i}`))
    const entryGuards = new Map<number, ReturnType<typeof heatingFieldEntryGuards>>()
    const heading = (a: Point, b: Point) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y) * native.width
    for (const { index, before, after, b } of trials) {
      checkpoint()
      if (!entryGuards.has(index)) {
        const ids = new Set((jobs[index].roomMembers ?? []).flatMap((member) => native.rooms.filter((room) => heatingRoomKey(room) === member.key).map((room) => room.id)))
        entryGuards.set(index, heatingFieldEntryGuards(native, scene, originalPipes[index], originalPipes, ids, source, settings, scale, { obstacles, checkpoint }))
      }
      const guards = entryGuards.get(index)
      if (guards === null) continue
      const others = [...originalPipes.filter((_, i) => i !== index && i !== originalPipes.length - 1), ...feedPipes]
      const retained = [pipe(before, 'splice-before'), pipe(after, 'splice-after'), pipe(b, 'splice-patch')]
      const joints = new Map(retained.map((p) => [p.id, [heatingPipeGeometry(p).points[0], heatingPipeGeometry(p).points.at(-1)!]]))
      const members = new Set([...(jobs[index].roomMembers ?? []), ...(patch.roomMembers ?? [])].map((room) => room.key))
      const allowedRooms = new Set(native.rooms.filter((room) => members.has(heatingRoomKey(room))).map((room) => room.id))
      const legs = [
        { from: before.at(-1)!, to: b[0], direction: heading(before.at(-2)!, before.at(-1)!), endDirection: heading(b[0], b[1]) },
        { from: b.at(-1)!, to: after[0], direction: heading(b.at(-2)!, b.at(-1)!), endDirection: heading(after[0], after[1]) }
      ]
      const tangent = (head: Point, next: Point, id: string) => {
        const length = Math.hypot(head.x - next.x, head.y - next.y)
        return createHeatingPipe(id, [head, { x: head.x + (head.x - next.x) / length * radius,
          y: head.y + (head.y - next.y) / length * radius }],
        { ...heatingPipeData(scale), ...settings, automatic: false, circuitId: id, pipeRole: 'supply' })
      }
      const inlets = [tangent(before[0], before[1], 'splice-inlet-supply'), tangent(after.at(-1)!, after.at(-2)!, 'splice-inlet-return')]
      for (const order of [[0, 1], [1, 0]]) {
        const bridges: Point[][] = [], routed = []
        let valid = true
        for (const n of order) {
          const leg = legs[n]
          const partner = legs[1 - n]
          const ahead = (p: Point, direction: number, sign: number) => Math.abs(direction) === native.width
            ? { x: p.x, y: p.y + Math.sign(direction) * radius * sign } : { x: p.x + Math.sign(direction) * radius * sign, y: p.y }
          const pending = routed.length ? [] : [tangent(partner.from, ahead(partner.from, partner.direction, -1), 'splice-pending-from'),
            tangent(partner.to, ahead(partner.to, partner.endDirection, 1), 'splice-pending-to')]
          const tubeFree = heatingPointClearance([...others, ...retained, ...routed, ...inlets, ...pending, ...guards ?? []], settings.diameterMm, scale, { joints })
          const pointFree = (p: Point) => {
            const cell = native.index(p)
            return cell >= 0 && (allowedRooms.has(native.room[cell]) || native.room[cell] <= 0 && native.door[cell]) && tubeFree(p) &&
              // A coarse access mask must not block physically clear space
              // between real reserved tubes. Their exact envelopes above are
              // authoritative when the actual guide geometry is available.
              (!options.reserveFeeds || feedPipes.length > 0 || !options.feedCorridor?.[native.index(p)])
          }
          const path = routeHeating(native, native.index(leg.from), native.index(leg.to), {
            radiusCells: Math.ceil(2 * radius / native.step), startDirection: leg.direction, endDirection: leg.endDirection,
            preferArcs: true, continuousTurns: true, pointFree, permittedWallCells: new Set(), checkpoint })
          if (!path) { valid = false; break }
          const bridge = exact(exact(heatingPathPoints(native, path), leg.from, true), leg.to, false)
          bridges[n] = bridge; routed.push(pipe(bridge, `splice-leg-${n}`))
        }
        if (!valid) continue
        const points = simplifyHeatingPath([...before, ...bridges[0].slice(1, -1), ...b, ...bridges[1].slice(1, -1), ...after])
        const combined = pipe(points, originalPipes[index].id), geometry = heatingPipeGeometry(combined)
        if (heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() })) continue
        if (heatingEntryTangentConflict(combined, others)) continue
        if (originalPipes.some((other, i) => i !== index && i !== originalPipes.length - 1 && heatingEntryTangentConflict(other, [combined]))) continue
        if (checkHeatingPlan([...others, combined, ...guards ?? []], [], settings.design, obstacles,
          { focusPipeIds: new Set([combined.id]), stopOnConflict: true, checkpoint }).errors) continue
        const candidate = { ...jobs[index], points, cells: raster(points), pattern: 'mixed' as const,
          entryArea: undefined, entrySettings: undefined,
          roomName: `${jobs[index].roomName} / ${patch.roomName}`, roomMembers: [...jobs[index].roomMembers ?? [], ...patch.roomMembers ?? []],
          areaM2: jobs[index].areaM2 + patch.areaM2 }
        if (completeM(candidate) > limits.maxCircuitLengthM + .05) continue
        jobs[index] = candidate
        return true
      }
    }
    return false

}

type JoinOptions = Parameters<typeof joinHeatingFieldPatchUncached>[6]
type JoinCacheEntry = { result: boolean; changed: { index: number; job: HeatingSpiralField }[] }
type JoinCache = { room: Int32Array; obstacle: Uint8Array; entries: Map<string, JoinCacheEntry> }
const completedJoins = new WeakMap<Uint8Array, JoinCache>()
const sameMask = (a: Int32Array | Uint8Array, b: Int32Array | Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index])

/** Resume retains completed join prefixes, never a partial search or a timeout.
 * One floor snapshot and at most eight exact geometry entries are kept per wall
 * raster; discarded drawings release the entire cache through the WeakMap. */
export const joinHeatingFieldPatch = (jobs: HeatingSpiralField[], patch: HeatingSpiralField,
  native: HeatingGrid, scene: readonly Shape[], settings: HeatingAreaSettings, scale: number, options: JoinOptions): boolean => {
  options.checkpoint()
  let cache = completedJoins.get(native.wall)
  if (!cache || !sameMask(cache.room, native.room) || !sameMask(cache.obstacle, native.obstacle)) {
    cache = { room: native.room.slice(), obstacle: native.obstacle.slice(), entries: new Map() }
    completedJoins.set(native.wall, cache)
  }
  const description = (job: HeatingSpiralField) => ({ ...job, cells: undefined })
  const key = JSON.stringify([native.origin, native.step, native.width, native.height,
    native.rooms.map((room) => [room.id, room.name]), scene, settings, scale, options.source,
    jobs.map(description), description(patch), jobs.map(options.completeM), options.completeM(patch), options.feedPipes,
    options.reserveFeeds, options.reserveFeeds && !options.feedPipes.length && options.feedCorridor ? [...options.feedCorridor] : undefined, options.obstacles])
  const cached = cache.entries.get(key)
  if (cached && (!cached.result || cached.changed.every(({ job }) => options.completeM(job) <=
    heatingDesignLimits(settings.diameterMm, settings.design).maxCircuitLengthM + .05))) {
    for (const { index, job } of cached.changed) jobs[index] = structuredClone(job)
    return cached.result
  }
  const before = [...jobs]
  // Exceptions deliberately escape without caching: a cooperative pause must
  // not turn an unfinished candidate into a remembered rejection.
  const result = joinHeatingFieldPatchUncached(jobs, patch, native, scene, settings, scale, options)
  cache.entries.set(key, { result, changed: jobs.flatMap((job, index) => job === before[index] ? [] : [{ index, job: structuredClone(job) }]) })
  if (cache.entries.size > 8) cache.entries.delete(cache.entries.keys().next().value!)
  return result
}
