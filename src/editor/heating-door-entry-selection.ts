import type { Point, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import { generateHeatingAreaLoop, type HeatingAreaSettings } from './heating-area-kernel.js'
import { heatingFieldEntryGuards } from './heating-field-entry-guards.js'
import { heatingConnectionEntryKey } from './heating-connection-refinement.js'
import { heatingRoomKey } from './heating-coverage.js'
import { createHeatingPipe, heatingPipeData } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingEntryTangentConflict, retractHeatingFeedEntries } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingCurveWallConflict } from './heating-routing.js'
import { heatingSourceShortcutRooms } from './heating-wall-policy.js'
import { heatingObstacleBounds } from './heating-openings.js'
import { shapeBounds } from './model/model.js'
import { heatingDesignLimits } from './heating-design.js'

/** Prefer a witnessed room-door entry before searching the whole building.
 * A negative bounded local search remains a fallback, never an impossibility
 * proof. Only the original partition's validated inlet variants are considered. */
export const selectHeatingDoorEntries = (input: readonly HeatingSpiralField[], grid: HeatingGrid, scene: readonly Shape[],
  source: Point, settings: HeatingAreaSettings, scale: number, options: {
    variants: Map<string, number>; checkpoint: () => void; sourceRadiusMm?: number; wallCells?: ReadonlySet<number>;
  }): HeatingSpiralField[] => {
  const jobs = input.map((job) => ({ ...job })), checkpoint = options.checkpoint
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const pipe = (job: HeatingSpiralField, index: number) => createHeatingPipe(`door-choice-${index}`, job.points!,
    { ...heatingPipeData(scale), ...settings, automatic: true, circuitId: `door-choice-${index}`, pipeRole: 'loop' })
  const coils = jobs.map(pipe), obstacles = heatingObstacleBounds(scene, shapeBounds)
  const shortcutRooms = heatingSourceShortcutRooms(grid, source, options.wallCells ?? new Set(), scale)
  const raster = (points: readonly Point[]) => {
    const result: number[] = []
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.step / 2)))
      for (let n = i ? 1 : 0; n <= count; n++) {
        const cell = grid.index({ x: a.x + (b.x - a.x) * n / count, y: a.y + (b.y - a.y) * n / count })
        if (cell >= 0 && cell !== result.at(-1)) result.push(cell)
      }
    }
    return result
  }
  for (let index = 0; index < jobs.length; index++) {
    checkpoint()
    const original = jobs[index]
    // Joining another room changes the complete curve. Its former standalone
    // entry variants must never replace the joined circuit and discard a room.
    if (!original.entryKey || !original.entryArea || !original.entrySettings || !original.points) continue
    const members = new Set(original.roomMembers?.map((room) => room.key) ?? (original.roomKey ? [original.roomKey] : []))
    const roomIds = new Set(grid.rooms.filter((room) => members.has(heatingRoomKey(room))).map((room) => room.id))
    // The authorised source-wall opening is also a valid room entry. Do not
    // force an adjacent field to prove a long doorway detour before the
    // physical source router can use that already selected short passage.
    if ([...roomIds].some((room) => shortcutRooms.has(room))) continue
    const guard = (candidate: typeof coils[number]) => {
      const bodyM = heatingPipeGeometry(candidate).length * scale / 8000
      return heatingFieldEntryGuards(grid, scene, candidate,
        coils.map((coil, i) => i === index ? candidate : coil), roomIds, source, settings, scale, { obstacles, checkpoint,
          acceptPair: (pair) => {
            const minimumM = pair.reduce((sum, pipe) => {
              const curve = heatingPipeGeometry(pipe), end = curve.points.at(-1)!
              // These candidates run from the coil to the door. Both real
              // tails count, plus an optimistic straight leader to the source
              // zone. A long local detour must not become an impossible inlet.
              return sum + curve.length * scale / 8000 + Math.max(0,
                Math.hypot(end.x - source.x, end.y - source.y) * scale / 8000 - (options.sourceRadiusMm ?? 1500) / 1000)
            }, bodyM + limits.allowanceM)
            return minimumM <= limits.maxCircuitLengthM + .05
          } })
    }
    // Keep an existing good entrance; this preserves work in other rooms.
    if (guard(coils[index]) !== null) continue
    const seen = new Set([heatingConnectionEntryKey(original.points)])
    const minimum = Math.max(original.entryVariant ?? 0, options.variants.get(original.entryKey) ?? 0)
    // A saved value is the requested next (or already proved) variant. Resume
    // must retry that value, while skipping the unchanged original entrance.
    for (let variant = Math.max((original.entryVariant ?? 0) + 1, minimum); variant < 8; variant++) {
      checkpoint()
      const loop = generateHeatingAreaLoop(original.entryArea,
        { ...original.entrySettings, entryVariant: variant }, scale, checkpoint)
      if (!loop || loop.gapRatio > (original.entryMaxGapRatio ?? .02) + 1e-7) continue
      const points = retractHeatingFeedEntries(loop.points, settings.diameterMm, settings.spacingMm, scale, limits.minBendRadiusMm)
      const key = heatingConnectionEntryKey(points)
      if (seen.has(key)) continue
      seen.add(key)
      const candidate = { ...original, points, pattern: loop.pattern, cells: raster(points), entryVariant: variant }
      const proposed = pipe(candidate, index), geometry = heatingPipeGeometry(proposed)
      if (geometry.length * scale / 8000 + limits.allowanceM > limits.maxCircuitLengthM + .05 ||
        heatingCurveWallConflict(grid, geometry.pieces, { permittedWallCells: new Set() })) continue
      const others = coils.filter((_, i) => i !== index)
      if (heatingEntryTangentConflict(proposed, others) || others.some((other) => heatingEntryTangentConflict(other, [proposed]))) continue
      if (checkHeatingPlan([...others, proposed], [], settings.design, obstacles,
        { focusPipeIds: new Set([proposed.id]), stopOnConflict: true, checkpoint }).errors) continue
      const witness = guard(proposed)
      if (!witness?.length) continue
      jobs[index] = candidate; coils[index] = proposed
      options.variants.set(original.entryKey, variant)
      break
    }
  }
  return jobs
}
