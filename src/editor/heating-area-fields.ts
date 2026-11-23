import type { Point, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import { heatingRoomKey, heatingCoverageRadius, heatingWallDistances, measureHeatingCoverage } from './heating-coverage.js'
import { rectangularHeatingArea, unionHeatingAreas, subtractHeatingAreas, intersectHeatingAreas, partitionHeatingArea, heatingAreaSurface, heatingAreaBounds, heatingAreaComponents, insetHeatingArea, generateHeatingAreaLoop, type HeatingAreaSettings, type HeatingArea, type HeatingAreaTrace } from './heating-area-kernel.js'
import { heatingObstacleBounds } from './heating-openings.js'
import { shapeBounds } from './model/model.js'
import { heatingCurveWallConflict, simplifyHeatingPath } from './heating-routing.js'
import { heatingPipeData, createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance, retractHeatingFeedEntries } from './heating-clearance.js'
import { heatingDesignLimits } from './heating-design.js'
import { joinHeatingFieldPatch } from './heating-field-patch.js'
import type { DrawingScale } from './layout/drawing-scale.js'

/** Trace row runs once. The polygon keeps concave rooms and holes; it is not
 * reduced to the room's enclosing rectangle or a bag of independent coils. */
export const heatingAreaFromCells = (grid: HeatingGrid, cells: readonly number[], entry: Point) => {
  const selected = new Set(cells), rectangles = []
  for (const cell of cells) {
    if (cell % grid.width && selected.has(cell - 1)) continue
    let end = cell
    while (end % grid.width + 1 < grid.width && selected.has(end + 1)) end++
    const p = grid.point(cell)
    rectangles.push(rectangularHeatingArea({ x: p.x - grid.step / 2, y: p.y - grid.step / 2,
      width: (end - cell + 1) * grid.step, height: grid.step }, entry))
  }
  return unionHeatingAreas(rectangles, entry)
}

type HeatingAreaFieldsResult = { jobs: HeatingSpiralField[]; occupied: Set<number>; targets?: Map<string, number>; estimatedMaxM?: number; allocationAlternatives?: number;
  failedRoom?: string; failedRoomKey?: string; requested?: number; failureDetail?: string }
export type HeatingMeasuredLead = { roomId: number; point: Point; leadM: number }
/** A partial physical route updates its own inlet, not the other measured
 * approaches in that room. Nearby measurements describe the same inlet. */
export const mergeHeatingMeasuredLeads = (previous: readonly HeatingMeasuredLead[], samples: readonly HeatingMeasuredLead[],
  scale: DrawingScale): HeatingMeasuredLead[] => {
  let result = [...previous]
  for (const sample of samples) {
    result = result.filter((old) => old.roomId !== sample.roomId ||
      Math.hypot(old.point.x - sample.point.x, old.point.y - sample.point.y) * scale / 8000 > .1)
    result.push(sample)
  }
  return result.slice(-128)
}

/** Allocation may extrapolate a measured approach towards a nearby inlet.
 * This is a length estimate; the complete routed cut is still measured and
 * checked before accepting a plan. The original distance floor always holds. */
export const heatingMeasuredLeadEstimate = (point: Point, roomId: number, baseline: number,
  samples: readonly HeatingMeasuredLead[], scale: DrawingScale): number => {
  let closest: HeatingMeasuredLead | undefined, nearest = Infinity
  for (const sample of samples) if (sample.roomId === roomId) {
    const distance = Math.hypot(point.x - sample.point.x, point.y - sample.point.y)
    if (distance < nearest) { nearest = distance; closest = sample }
  }
  return Math.max(baseline, closest ? Math.max(0, closest.leadM - nearest * scale / 8000) : 0)
}
const areaPartitions = new WeakMap<Int32Array | Uint8Array, Map<string, ReturnType<typeof partitionHeatingArea>>>()

export const buildHeatingAreaFields = (grid: HeatingGrid, scene: readonly Shape[], settings: HeatingAreaSettings, scale: DrawingScale, source: Point,
  options: { fieldEntryVariants?: ReadonlyMap<string, number>; measuredLeads?: readonly HeatingMeasuredLead[]; entryVariants?: ReadonlyMap<string, number>; targets: ReadonlyMap<string, number>; omitted?: ReadonlySet<number>; leads?: Int32Array; checkpoint: () => void;
    nativeGrid?: HeatingGrid; capacity?: number; preferredMaxM?: number; fixedCounts?: boolean; reserveFeeds?: boolean; allowPatchJoining?: boolean; allocationVariant?: number;
    onParts?: (group: string, parts: { room: string; areaM2: number; boundaries: Point[][] }[]) => void;
    onRejectedPart?: (room: string, area: HeatingArea, trace?: HeatingAreaTrace) => void;
    onRoom?: (name: string, completed: number, total: number) => void }): HeatingAreaFieldsResult => {
  const native = options.nativeGrid ?? grid, obstacles = heatingObstacleBounds(scene, shapeBounds), checkpoint = options.checkpoint
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), capacity = options.capacity ?? [...options.targets.values()].reduce((a, b) => a + b, 0)
  const preferredMaxM = options.preferredMaxM ?? limits.maxCircuitLengthM
  const wallDistances = heatingWallDistances(native), edgeCells = (settings.edgeMm ?? 100) * 8 / scale / native.step
  const roomCoverageBudgets = new Map(native.rooms.map((room) => [room.id, Math.max(.05,
    room.cells.filter((cell) => !native.obstacle[cell] && wallDistances[cell] >= edgeCells).length * (native.step * scale / 8000) ** 2 * .02)]))
  // A real reserved route already describes the feed bundle. Its cut through
  // the floor needs half a laying pitch, not a second wall/approach setback.
  // A mask without routes cannot establish that physical clearance yet.
  const preparedFeeds = options.reserveFeeds && Boolean(grid.feedPaths?.some((path) => path.length > 1))
  const physicalEdge = (settings.edgeMm ?? 100) * 8 / scale
  const feedEdge = Math.max(settings.spacingMm / 2, settings.diameterMm) * 8 / scale
  const fixtureRadius = settings.diameterMm * 4 / scale
  const fixtureEnvelopes = obstacles.map((box) => ({ x: box.x - fixtureRadius, y: box.y - fixtureRadius,
    width: box.width + fixtureRadius * 2, height: box.height + fixtureRadius * 2 }))
  // Keep room for a pair to turn beside the field. The requested wall offset
  // is a minimum; transit tubes heat this access strip as well. Pitch inside
  // the heating fields remains unchanged.
  const layoutSettings = { ...settings, edgeMm: Math.max(settings.edgeMm ?? 100,
    limits.minBendRadiusMm + Math.max(settings.spacingMm / 2, settings.diameterMm * 2) + native.step * scale / 16) }
  const partitionContext = options.leads ?? native.wall
  let partitions = areaPartitions.get(partitionContext)
  if (!partitions) { partitions = new Map(); areaPartitions.set(partitionContext, partitions) }
  const lead = (p: Point) => {
    const cell = native.index(p), distance = cell >= 0 ? options.leads?.[cell] : -1
    // Four-neighbour grid distance is a square-guide estimate, not a lower
    // bound for continuous rounded/diagonal routes. Use an optimistic bound
    // for allocation; actual routed leads replace it before final acceptance.
    const baseline = distance !== undefined && distance >= 0 ? distance * native.step * scale / 8000 / Math.SQRT2 :
      Math.hypot(p.x - source.x, p.y - source.y) * scale / 8000
    const room = cell >= 0 ? native.room[cell] : -1
    return heatingMeasuredLeadEstimate(p, room, baseline, options.measuredLeads ?? [], scale)
  }
  const pipe = (points: Point[], id: string) => createHeatingPipe(id, points,
    { ...heatingPipeData(scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: id })
  const raster = (points: readonly Point[]) => {
    const path: number[] = []
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / (native.step / 2)))
      for (let n = i ? 1 : 0; n <= steps; n++) {
        const cell = native.index({ x: a.x + (b.x - a.x) * n / steps, y: a.y + (b.y - a.y) * n / steps })
        if (cell >= 0 && path.at(-1) !== cell) path.push(cell)
      }
    }
    return path
  }
  const completeM = (job: HeatingSpiralField) => {
    const points = job.points!
    return heatingPipeGeometry(pipe(points, 'length')).length * scale / 8000 + lead(points[0]) + lead(points.at(-1)!) + limits.allowanceM
  }
  // Reservation paths describe real transit tubes, not just blocked raster
  // centres. A connector may otherwise cut between sampled cells or move onto
  // a feed when its endpoints and fillets are aligned after routing.
  const feedPipes = options.reserveFeeds ? (grid.feedPaths ?? []).map((cells, i) => createHeatingPipe(`reserved-feed-${i}`,
    simplifyHeatingPath(cells.map(native.point)), { ...heatingPipeData(scale), ...settings, automatic: false,
      pipeRole: 'supply', circuitId: `reserved-feed-${i}` })) : []
  const partitionCoverageAccepted = (candidate: ReturnType<typeof partitionHeatingArea>, roomId: number) =>
    Boolean(candidate?.loops.every((loop, index) => loop.gapRatio * heatingAreaSurface(candidate.areas[index]) * (scale / 8000) ** 2 <=
      Math.max(.05, roomCoverageBudgets.get(roomId) ?? .05)))
  const clearOfReservedGeometry = (points: Point[], jobs: readonly HeatingSpiralField[]) => {
    const geometry = heatingPipeGeometry(pipe(points, 'field-clearance'))
    const existing = [...feedPipes, ...jobs.map((job, i) => pipe(job.points!, `field-existing-${i}`))]
    const feedClearance = heatingPointClearance(existing, settings.diameterMm, scale, { solids: fixtureEnvelopes })
    if (heatingCurveWallConflict(native, geometry.pieces, { checkpoint, permittedWallCells: new Set() })) return false
    return geometry.pieces.every((piece) => {
      const samples = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (native.step / 2)))
      for (let i = 0; i <= samples; i++) if (!feedClearance({
        x: piece.a.x + (piece.b.x - piece.a.x) * i / samples,
        y: piece.a.y + (piece.b.y - piece.a.y) * i / samples
      })) return false
      return true
    })
  }
  const feedCoverageRadiusMm = heatingCoverageRadius(settings.spacingMm, scale, native.step) * scale / 8
  const notFeedCovered = feedPipes.length ? heatingPointClearance(feedPipes,
    Math.max(0, feedCoverageRadiusMm * 2 - settings.diameterMm), scale) : () => true
  const deferCoveredNarrowTips = (cells: number[]) => {
    if (!feedPipes.length) return cells
    const free = new Set(cells.filter((cell) => !native.obstacle[cell])), narrow = new Set<number>()
    const minimum = (limits.minBendRadiusMm * 2 + settings.diameterMm) * 8 / scale
    for (const stride of [1, native.width]) for (const cell of free) {
      if (free.has(cell - stride) && (stride !== 1 || cell % native.width)) continue
      const run: number[] = []
      for (let c = cell; free.has(c); c += stride) {
        run.push(c)
        if (stride === 1 && c % native.width === native.width - 1) break
      }
      if (run.length * native.step < minimum) for (const c of run) narrow.add(c)
    }
    // These cells remain in the final native coverage audit. Avoid forcing an
    // extra coil into a throat too narrow for R80 when real transit tubes
    // already cover it at the very same reach used by that final audit.
    return cells.filter((cell) => !narrow.has(cell) || notFeedCovered(native.point(cell)))
  }
  const joinPatch = (jobs: HeatingSpiralField[], patch: HeatingSpiralField) =>
    joinHeatingFieldPatch(jobs, patch, native, scene, settings, scale, { source, feedPipes, checkpoint, obstacles, completeM, raster,
      reserveFeeds: options.reserveFeeds, feedCorridor: grid.feedCorridor })
  type Proposal = { jobs: HeatingSpiralField[]; count: number; maxM: number; key: string; gapM2: number; reviewM2: number }
  const groups: Proposal[][] = []
  let completed = 0
  for (const group of grid.rooms) {
    checkpoint(); options.onRoom?.(group.name, completed, grid.rooms.length)
    const target = options.targets.get(heatingRoomKey(group)) ?? 0
    if (!target) { completed++; continue }
    const keys = new Set(group.members?.map((member) => member.key) ?? [heatingRoomKey(group)])
    const parts = native.rooms.filter((room) => keys.has(heatingRoomKey(room))).flatMap((room) => {
      const doors = room.cells.filter((cell) => native.door[cell]).map(native.point)
      const entry = [...doors].sort((a, b) => lead(a) - lead(b))[0] ?? source
      const wallArea = preparedFeeds ? heatingAreaFromCells(native,
        room.cells.filter((cell) => !options.omitted?.has(cell) && !native.wall[cell]), entry) : undefined
      // Fixture footprints are hard obstacles, but they are not walls. Inset
      // walls by the requested edge and fixtures by the actual tube envelope.
      const entryArea = wallArea && subtractHeatingAreas(wallArea, fixtureEnvelopes)
      const physicalFloor = wallArea && subtractHeatingAreas(insetHeatingArea(wallArea, physicalEdge), fixtureEnvelopes)
      const cells = deferCoveredNarrowTips(room.cells.filter((cell) => !options.omitted?.has(cell) && !native.wall[cell] && (!options.reserveFeeds || !grid.feedCorridor?.[cell])))
      const corridorArea = heatingAreaFromCells(native, cells, entry)
      const feedFloor = preparedFeeds ? insetHeatingArea(corridorArea, feedEdge) : undefined
      const area = subtractHeatingAreas(corridorArea, obstacles)
      return heatingAreaComponents(area).flatMap((area) => {
        const centreFloor = physicalFloor && feedFloor && intersectHeatingAreas(physicalFloor, intersectHeatingAreas(feedFloor, area))
        if (centreFloor) area.clearance = { boundaries: wallArea!.boundaries, edge: physicalEdge, bounds: heatingAreaBounds(area),
          entryBoundaries: entryArea!.boundaries, coverageStep: native.step }
        // A transit bundle can split a native room into several fields. Each
        // fragment needs its own nearby doorway, rather than inheriting the
        // source-nearest door of a different wing of that room.
        const core = centreFloor ?? insetHeatingArea(area, Math.max(layoutSettings.edgeMm, limits.minBendRadiusMm + settings.spacingMm +
          settings.diameterMm / 2 + native.step * scale / 16) * 8 / scale)
        const distanceToArea = (p: Point) => Math.min(...(core.boundaries.length ? core : area).boundaries.flatMap((ring) => ring.map((a, i) => {
          const b = ring[(i + 1) % ring.length], dx = b.x - a.x, dy = b.y - a.y
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
          return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
        })))
        area.entry = [...doors].sort((a, b) => distanceToArea(a) - distanceToArea(b) || lead(a) - lead(b))[0] ?? entry
        if (centreFloor) centreFloor.entry = area.entry
        const eligible = heatingAreaSurface(centreFloor ?? insetHeatingArea(area, physicalEdge)) * (scale / 8000) ** 2
        // Feed bundles can isolate a tiny strip too narrow for an R80 return.
        // Those strips remain in the final whole-floor coverage measurement;
        // they do not need an additional coil between the transit pipes.
        if (options.reserveFeeds && eligible < .25 && core.boundaries.length) {
          const box = heatingAreaBounds(core)
          const nextToFeed = area.boundaries.flat().some((p) => {
            const cell = grid.index(p)
            return [cell, cell - 1, cell + 1, cell - grid.width, cell + grid.width].some((c) => grid.feedCorridor?.[c])
          })
          if (nextToFeed && Math.min(box.width, box.height) * scale / 8 < 2 * limits.minBendRadiusMm) return []
        }
        return eligible >= .05 ? [{ area, centreFloor, eligible, room, count: 0 }] : []
      })
    })
    if (!parts.length) { completed++; continue }
    options.onParts?.(group.name, parts.map((part) => ({ room: part.room.name, areaM2: part.eligible, boundaries: part.area.boundaries })))
    const large = parts.filter((part) => part.eligible >= 2.5), small = parts.filter((part) => part.eligible < 2.5)
    if (!large.length) { small.sort((a, b) => b.eligible - a.eligible); large.push(small.shift()!) }
    const proposals: Proposal[] = []
    let failureDetail = ''
    const layouts = new Map<string, ReturnType<typeof partitionHeatingArea>>()
    small.sort((a, b) => b.eligible - a.eligible)
    const jobFor = (part: typeof parts[number], raw: Point[], pattern: HeatingSpiralField['pattern'], areaM2: number): HeatingSpiralField => {
      const points = retractHeatingFeedEntries(raw, settings.diameterMm, settings.spacingMm, scale, limits.minBendRadiusMm)
      return { cells: raster(points), points, pattern, roomName: part.room.name, roomKey: heatingRoomKey(group),
      roomMembers: [{ key: heatingRoomKey(part.room), name: part.room.name }], areaM2,
      spacingMinMm: settings.spacingMm, spacingMaxMm: settings.spacingMm }
    }
    const counts = options.fixedCounts ? [target] : [...new Set([target, target + 1, target + 2, Math.max(large.length, target - 1), Math.max(large.length, target - 2)])]
    for (const count of counts) {
      // A room may use fewer groups within the authorised fallback length so
      // another room can keep its entrance open with a separate circuit.
      // The global allocation compares these complete alternatives afterwards.
      if (count > target && proposals.some((proposal) => proposal.count === target && proposal.reviewM2 <= 1e-7 && proposal.maxM <= (preparedFeeds ? limits.maxCircuitLengthM : Math.min(limits.maxCircuitLengthM, preferredMaxM)) + .05)) continue
      if (count < large.length || count > capacity - Math.max(0, grid.rooms.length - 1)) continue
      // A small pocket may share a circuit only when that connection leaves
      // the feed bundle open. Otherwise allocate it one of the available
      // circuits, rather than bridging across every other room's leads.
      // Try which small area owns a circuit, not just how many. Giving the
      // landing its own loop can keep the main feed corridor open while a
      // larger adjacent pocket safely shares a neighbouring room's circuit.
      let separateChoices: typeof small[] = [[]]
      const rank = (choice: typeof small) => choice.length === 1 ? 0 : choice.length ? choice.length : 1
      for (const part of small) {
        separateChoices = [...separateChoices, ...separateChoices.filter((choice) => choice.length < count - large.length).map((choice) => [...choice, part])]
          .sort((a, b) => rank(a) - rank(b) || b.reduce((sum, p) => sum + p.eligible, 0) - a.reduce((sum, p) => sum + p.eligible, 0)).slice(0, 32)
      }
      // First solve allocation with complete, independently accessible coils.
      // A spare authorised circuit is preferable to chaining remote pockets.
      // Only search physical two-leg splices if this allocation cannot fit.
      if (!options.allowPatchJoining) separateChoices = separateChoices.filter((choice) => choice.length === small.length)
      for (const separate of separateChoices) {
        const dedicated = [...large, ...separate], allocation = dedicated.map(() => 1)
        for (let n = dedicated.length; n < count; n++) {
          let next = 0
          for (let i = 1; i < large.length; i++) if (dedicated[i].eligible / allocation[i] > dedicated[next].eligible / allocation[next]) next = i
          allocation[next]++
        }
        const variants = [allocation]
        for (let from = 0; from < large.length; from++) if (allocation[from] > 1) for (let to = 0; to < large.length; to++) if (to !== from) {
          const changed = [...allocation]; changed[from]--; changed[to]++; variants.push(changed)
        }
        for (const assigned of variants) {
          const jobs: HeatingSpiralField[] = []
          let valid = true
          for (let i = 0; i < dedicated.length; i++) {
            const part = dedicated[i]
            const attempt = options.entryVariants?.get(heatingRoomKey(part.room)) ?? 0
            const partitionVariant = assigned[i] === 1 ? 0 : Math.floor(attempt / 2)
            // Fragments of one native room still share its feed approach.
            // Sizing the large fragment for just its own two coils can close
            // the bus used by the room's other coils and force long detours.
            const approachCount = assigned[i] > 1 ? dedicated.reduce((sum, other, n) =>
              sum + (other.room.id === part.room.id ? assigned[n] : 0), 0) : assigned[i]
            const partSettings = { ...layoutSettings, entryVariant: assigned[i] === 1 ? attempt : attempt % 2,
              // Keep enough room for the complete supply/return bundle to turn.
              // Actual reserved feeds use their local strip instead of moving
              // every wall and every artificial field boundary away from it.
              edgeMm: part.centreFloor ? settings.edgeMm ?? 100 : assigned[i] === 2 && approachCount === 2 ? layoutSettings.edgeMm : Math.max(layoutSettings.edgeMm,
                limits.minBendRadiusMm + (approachCount === 1 ? settings.spacingMm :
                  2 * approachCount * Math.ceil(settings.diameterMm / (native.step * scale / 16)) * (native.step * scale / 16)) +
                settings.diameterMm / 2 + native.step * scale / 16) }
            // Another allocation can retain this fragment's coil count while
            // adding transit tubes to a different fragment of the same room.
            const key = JSON.stringify([parts.indexOf(part), assigned[i], partSettings.edgeMm,
              partSettings.entryVariant, partitionVariant, preparedFeeds && part.eligible < 2.5 ? jobs.map((job) => job.points) : undefined])
            if (!layouts.has(key)) {
              const cacheKey = JSON.stringify([part.area, part.centreFloor, assigned[i], partSettings, partitionVariant, scale, source,
                options.measuredLeads?.filter((sample) => sample.roomId === part.room.id), [...options.fieldEntryVariants ?? []]])
              const entry = part.area.entry
              const doorEntry = native.door[native.index(entry)]
              if (!partitions.has(cacheKey)) {
                // Use the actual room doorway for inlet orientation. The
                // length lower bound cannot see the other heating fields;
                // its nearest corner may face a sealed internal seam.
                partitions.set(cacheKey, partitionHeatingArea(part.area, assigned[i], partSettings, scale,
                  { checkpoint, centreFloor: part.centreFloor, coverageBudgetM2: roomCoverageBudgets.get(part.room.id), leadM: lead,
                    entryPoint: doorEntry ? entry : undefined, variant: partitionVariant, fieldEntryVariants: options.fieldEntryVariants,
                    onRejectedArea: options.onRejectedPart && ((area, trace) => options.onRejectedPart!(part.room.name, area, trace)) }))
                if (partitions.size > 128) partitions.delete(partitions.keys().next().value!)
              }
              let partition = partitions.get(cacheKey)!
              const feedInsetDominates = part.centreFloor &&
                heatingAreaSurface(part.centreFloor) < heatingAreaSurface(part.area) * .8
              if (preparedFeeds && part.eligible >= 1.5 && part.eligible < 2.5 && assigned[i] === 1 &&
                partitionVariant === 0 && partSettings.entryVariant === 0 && feedInsetDominates &&
                !partitionCoverageAccepted(partition, part.room.id)) {
                const relaxedKey = JSON.stringify([cacheKey, 'feed-clearance-fallback'])
                if (!partitions.has(relaxedKey)) {
                  // Keep the wall/fixture inset, but let the real feed clearance
                  // decide whether a narrow pocket can use the space beside its bundle.
                  const relaxed = partitionHeatingArea(part.area, assigned[i], partSettings, scale,
                    { checkpoint, coverageBudgetM2: roomCoverageBudgets.get(part.room.id), leadM: lead,
                      entryPoint: doorEntry ? entry : undefined, variant: partitionVariant, fieldEntryVariants: options.fieldEntryVariants,
                      onRejectedArea: options.onRejectedPart && ((area, trace) => options.onRejectedPart!(part.room.name, area, trace)) })
                  partitions.set(relaxedKey, partitionCoverageAccepted(relaxed, part.room.id) ? relaxed : null)
                }
                const relaxed = partitions.get(relaxedKey)
                if (partitionCoverageAccepted(relaxed, part.room.id)) {
                  const fallbackJobs: HeatingSpiralField[] = []
                  for (const [index, loop] of relaxed!.loops.entries()) {
                    const candidate = jobFor(part, loop.points, loop.pattern,
                      heatingAreaSurface(relaxed!.areas[index]) * (scale / 8000) ** 2)
                    if (!clearOfReservedGeometry(candidate.points!, [...jobs, ...fallbackJobs])) break
                    fallbackJobs.push(candidate)
                  }
                  if (fallbackJobs.length === relaxed!.loops.length) partition = relaxed
                }
                if (partitions.size > 128) partitions.delete(partitions.keys().next().value!)
              }
              layouts.set(key, partition)
            }
            const result = layouts.get(key)
            if (!partitionCoverageAccepted(result, part.room.id)) {
              options.onRejectedPart?.(part.room.name, part.centreFloor ?? part.area,
                { message: result ? `coverage: ${result.loops.map((loop) => loop.gapRatio).join(', ')}` : 'No connected partition within the requested circuit count.' })
              failureDetail = `${part.room.name}: legvlak van ${part.eligible.toFixed(1)} m² past niet met voldoende dekking in ${assigned[i]} kringen.`
              valid = false; break
            }
            for (const [index, loop] of result.loops.entries()) {
              const entryKey = JSON.stringify(result.areas[index].boundaries)
              jobs.push({ ...jobFor(part, loop.points, loop.pattern, heatingAreaSurface(result.areas[index]) * (scale / 8000) ** 2),
                entryKey, entryVariant: options.fieldEntryVariants?.get(entryKey) ?? partSettings.entryVariant,
                entryArea: structuredClone(result.areas[index]), entrySettings: { ...partSettings, edgeMm: settings.spacingMm / 2 },
                entryMaxGapRatio: Math.max(.02, loop.gapRatio) })
            }
          }
          if (!valid) continue
          const tooLong = jobs.find((job) => completeM(job) > limits.maxCircuitLengthM + .05)
          if (tooLong) {
            options.onRejectedPart?.(tooLong.roomName, dedicated[0].area, { message: `Prepared coil ${completeM(tooLong).toFixed(2)}m exceeds ${limits.maxCircuitLengthM}m` })
            continue
          }
          for (const part of small.filter((part) => !separate.includes(part))) {
            const patchKey = JSON.stringify(part.area.boundaries)
            const patchSettings = { ...layoutSettings, entryVariant: options.fieldEntryVariants?.get(patchKey) ?? options.entryVariants?.get(heatingRoomKey(part.room)) ?? 0 }
            const coverageLimit = Math.min(1, Math.max(.05, (roomCoverageBudgets.get(part.room.id) ?? .05) / part.eligible))
            const loop = part.centreFloor ? partitionHeatingArea(part.area, 1, patchSettings, scale,
              // Small pockets are combined with a host and transit tubes.
              // Judge their actual combined native coverage afterwards, not
              // a neck in isolation that the transit already partly heats.
              { checkpoint, centreFloor: part.centreFloor, coverageLimit,
                onRejectedArea: options.onRejectedPart && ((area, trace) => options.onRejectedPart!(part.room.name, area, trace)) })?.loops[0] : generateHeatingAreaLoop(part.area, patchSettings, scale, checkpoint)
            if (!loop || !joinPatch(jobs, { ...jobFor(part, loop.points, loop.pattern, part.eligible), entryKey: patchKey, entryVariant: patchSettings.entryVariant })) {
              failureDetail = `${part.room.name}: deelvlak van ${part.eligible.toFixed(1)} m² kon niet veilig in dezelfde kring worden opgenomen.`
              options.onRejectedPart?.(part.room.name, part.centreFloor ?? part.area,
                { message: `${loop ? 'Patch connection' : 'Patch loop'} failed for ${part.eligible.toFixed(2)}m2; hosts ${jobs.map((job) => `${job.roomName}:${completeM(job).toFixed(1)}m`).join(', ')}` })
              valid = false; break
            }
          }
          if (valid) {
            const coverage = measureHeatingCoverage({ ...native, rooms: native.rooms.filter((room) => keys.has(heatingRoomKey(room))) },
              [...feedPipes, ...jobs.map((job, i) => pipe(job.points!, `proposal-${i}`))], scale, settings.spacingMm, settings.edgeMm, checkpoint, false).coverage
            proposals.push({ jobs, count, maxM: Math.max(...jobs.map(completeM)), key: heatingRoomKey(group),
              gapM2: preparedFeeds ? coverage.rooms.reduce((sum, room) => sum + room.gapM2, 0) : 0,
              reviewM2: preparedFeeds ? coverage.rooms.reduce((sum, room) => sum + Math.max(0, room.gapM2 - Math.max(.05, room.eligibleM2 * .02)), 0) : 0 })
            if (proposals.at(-1)!.maxM <= limits.maxCircuitLengthM + .05) break
          }
        }
        if (proposals.some((proposal) => proposal.count === count && proposal.maxM <= limits.maxCircuitLengthM + .05)) break
      }
    }
    if (!proposals.length) {
      if (!options.allowPatchJoining) return buildHeatingAreaFields(grid, scene, settings, scale, source, { ...options, allowPatchJoining: true })
      return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(), failedRoom: group.name, failedRoomKey: heatingRoomKey(group), requested: target, failureDetail }
    }
    const bestByCount = new Map<number, Proposal>()
    for (const proposal of proposals) {
      const previous = bestByCount.get(proposal.count)
      if (!previous || proposal.reviewM2 < previous.reviewM2 - 1e-7 || Math.abs(proposal.reviewM2 - previous.reviewM2) < 1e-7 &&
        (proposal.gapM2 < previous.gapM2 - 1e-7 || Math.abs(proposal.gapM2 - previous.gapM2) < 1e-7 && proposal.maxM < previous.maxM)) bestByCount.set(proposal.count, proposal)
    }
    groups.push([...bestByCount.values()]); completed++; options.onRoom?.(group.name, completed, grid.rooms.length)
  }
  let states = [{ jobs: [] as HeatingSpiralField[], count: 0, maxM: 0, reviewM2: 0, gapM2: 0, targets: new Map<string, number>() }]
  for (const proposals of groups) {
    const candidates = states.flatMap((state) => proposals.flatMap((proposal) => state.count + proposal.count > capacity ? [] : [{
      jobs: [...state.jobs, ...proposal.jobs], count: state.count + proposal.count, maxM: Math.max(state.maxM, proposal.maxM),
      reviewM2: state.reviewM2 + proposal.reviewM2, gapM2: state.gapM2 + proposal.gapM2,
      targets: new Map([...state.targets, [proposal.key, proposal.count] as const]) }])).sort((a, b) =>
        a.reviewM2 - b.reviewM2 || a.gapM2 - b.gapM2 || Math.max(0, a.maxM - preferredMaxM) - Math.max(0, b.maxM - preferredMaxM) || a.count - b.count || a.maxM - b.maxM)
    const seen = new Set<string>(), retained = new Map<number, number>()
    states = candidates.filter((state) => {
      const signature = JSON.stringify([...state.targets])
      if (seen.has(signature) || (retained.get(state.count) ?? 0) >= 8) return false
      seen.add(signature); retained.set(state.count, (retained.get(state.count) ?? 0) + 1); return true
    })
  }
  const selected = states[(options.allocationVariant ?? 0) % Math.max(1, states.length)]
  if (!selected) {
    if (!options.allowPatchJoining) return buildHeatingAreaFields(grid, scene, settings, scale, source, { ...options, allowPatchJoining: true })
    // Feed guides themselves depend on the distribution. Report the group
    // needing an extra pair so the outer allocator can transfer one and
    // rebuild those guides, instead of retrying this same impossible split.
    const shortage = groups.map((proposals) => ({ key: proposals[0].key,
      need: Math.min(...proposals.map((proposal) => proposal.count)) - (options.targets.get(proposals[0].key) ?? 0) }))
      .filter((item) => item.need > 0).sort((a, b) => b.need - a.need)[0]
    return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(),
      failedRoom: shortage ? grid.rooms.find((room) => heatingRoomKey(room) === shortage.key)?.name ?? 'Volledig grondplan' : 'Volledig grondplan',
      failedRoomKey: shortage?.key, requested: capacity }
  }
  const occupied = new Set(selected.jobs.flatMap((job) => job.cells))
  return { jobs: selected.jobs, occupied, targets: selected.targets, estimatedMaxM: selected.maxM, allocationAlternatives: states.length }
}
