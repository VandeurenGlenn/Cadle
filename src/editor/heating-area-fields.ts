import type { Point, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import { heatingRoomKey } from './heating-coverage.js'
import { rectangularHeatingArea, unionHeatingAreas, subtractHeatingAreas, partitionHeatingArea, heatingAreaSurface, heatingAreaBounds, heatingAreaComponents, insetHeatingArea, generateHeatingAreaLoop, type HeatingAreaSettings } from './heating-area-kernel.js'
import { heatingObstacleBounds } from './heating-openings.js'
import { shapeBounds } from './model/model.js'
import { routeHeating, heatingPathPoints, simplifyHeatingPath, heatingCurveWallConflict } from './heating-routing.js'
import { heatingPipeData, createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance, heatingEntryTangentConflict, retractHeatingFeedEntries } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingDesignLimits } from './heating-design.js'
import { heatingSpliceWindows } from './heating-paired-splice.js'
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
const areaPartitions = new WeakMap<Int32Array | Uint8Array, Map<string, ReturnType<typeof partitionHeatingArea>>>()

export const buildHeatingAreaFields = (grid: HeatingGrid, scene: readonly Shape[], settings: HeatingAreaSettings, scale: DrawingScale, source: Point,
  options: { measuredLeads?: readonly HeatingMeasuredLead[]; entryVariants?: ReadonlyMap<string, number>; targets: ReadonlyMap<string, number>; omitted?: ReadonlySet<number>; leads?: Int32Array; checkpoint: () => void;
    nativeGrid?: HeatingGrid; capacity?: number; preferredMaxM?: number; fixedCounts?: boolean; reserveFeeds?: boolean; allowPatchJoining?: boolean; allocationVariant?: number;
    onParts?: (group: string, parts: { room: string; areaM2: number; boundaries: Point[][] }[]) => void;
    onRoom?: (name: string, completed: number, total: number) => void }): HeatingAreaFieldsResult => {
  const native = options.nativeGrid ?? grid, obstacles = heatingObstacleBounds(scene, shapeBounds), checkpoint = options.checkpoint
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), capacity = options.capacity ?? [...options.targets.values()].reduce((a, b) => a + b, 0)
  const preferredMaxM = options.preferredMaxM ?? limits.maxCircuitLengthM
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
    const baseline = distance !== undefined && distance >= 0 ? distance * native.step * scale / 8000 :
      (Math.abs(p.x - source.x) + Math.abs(p.y - source.y)) * scale / 8000
    const room = cell >= 0 ? native.room[cell] : -1
    let closest: HeatingMeasuredLead | undefined, nearest = Infinity
    for (const sample of options.measuredLeads ?? []) if (sample.roomId === room) {
      const d = Math.hypot(p.x - sample.point.x, p.y - sample.point.y)
      if (d < nearest) { nearest = d; closest = sample }
    }
    return Math.max(baseline, closest?.leadM ?? 0)
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
  const exact = (points: Point[], at: Point, start: boolean) => {
    const path = start ? points.map((p) => ({ ...p })) : points.map((p) => ({ ...p })).reverse()
    if (path.length > 1) {
      if (Math.abs(path[1].x - path[0].x) < 1e-6) path[1].x = at.x
      else if (Math.abs(path[1].y - path[0].y) < 1e-6) path[1].y = at.y
    }
    path[0] = at
    return start ? path : path.reverse()
  }
  // Reservation paths describe real transit tubes, not just blocked raster
  // centres. A connector may otherwise cut between sampled cells or move onto
  // a feed when its endpoints and fillets are aligned after routing.
  const feedPipes = options.reserveFeeds ? (grid.feedPaths ?? []).map((cells, i) => createHeatingPipe(`reserved-feed-${i}`,
    simplifyHeatingPath(cells.map(native.point)), { ...heatingPipeData(scale), ...settings, automatic: false,
      pipeRole: 'supply', circuitId: `reserved-feed-${i}` })) : []
  const joinPatch = (jobs: HeatingSpiralField[], patch: HeatingSpiralField) => {
    const radius = limits.minBendRadiusMm * 8 / scale, pitch = settings.spacingMm * 8 / scale
    const diameter = settings.diameterMm * 8 / scale
    const choices = jobs.flatMap((job, index) => heatingSpliceWindows(job.points!, patch.points!, radius, pitch, diameter)
      .slice(0, 8).flatMap((window) => [false, true].map((reverse) => ({ index, ...window,
        b: reverse ? [...patch.points!].reverse() : patch.points! })))).sort((a, b) => a.distance - b.distance)
    const originalPipes = [...jobs, patch].map((job, i) => pipe(job.points!, `area-${i}`))
    const heading = (a: Point, b: Point) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y) * native.width
    for (const { index, before, after, b } of choices.slice(0, 24)) {
      checkpoint()
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
          const tubeFree = heatingPointClearance([...others, ...retained, ...routed, ...inlets, ...pending], settings.diameterMm, scale, { joints })
          const pointFree = (p: Point) => {
            const cell = native.index(p)
            return cell >= 0 && (allowedRooms.has(native.room[cell]) || native.room[cell] <= 0 && native.door[cell]) && tubeFree(p) &&
              (!options.reserveFeeds || !grid.feedCorridor?.[grid.index(p)])
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
        if (checkHeatingPlan([...others, combined], [], settings.design, obstacles,
          { focusPipeIds: new Set([combined.id]), stopOnConflict: true, checkpoint }).errors) continue
        const candidate = { ...jobs[index], points, cells: raster(points), pattern: 'mixed' as const,
          roomName: `${jobs[index].roomName} / ${patch.roomName}`, roomMembers: [...jobs[index].roomMembers ?? [], ...patch.roomMembers ?? []],
          areaM2: jobs[index].areaM2 + patch.areaM2 }
        if (completeM(candidate) > limits.maxCircuitLengthM + .05) continue
        jobs[index] = candidate
        return true
      }
    }
    return false
  }
  type Proposal = { jobs: HeatingSpiralField[]; count: number; maxM: number; key: string }
  const groups: Proposal[][] = []
  let completed = 0
  for (const group of grid.rooms) {
    checkpoint(); options.onRoom?.(group.name, completed, grid.rooms.length)
    const target = options.targets.get(heatingRoomKey(group)) ?? 0
    if (!target) { completed++; continue }
    const keys = new Set(group.members?.map((member) => member.key) ?? [heatingRoomKey(group)])
    const parts = native.rooms.filter((room) => keys.has(heatingRoomKey(room))).flatMap((room) => {
      let entry = source, closest = Infinity
      for (const cell of room.cells) if (native.door[cell]) {
        const point = native.point(cell), distance = lead(point)
        if (distance < closest) { closest = distance; entry = point }
      }
      const cells = room.cells.filter((cell) => !options.omitted?.has(cell) && !native.wall[cell] && (!options.reserveFeeds || !grid.feedCorridor?.[cell]))
      const area = subtractHeatingAreas(heatingAreaFromCells(native, cells, entry), obstacles)
      return heatingAreaComponents(area).flatMap((area) => {
        const core = insetHeatingArea(area, (settings.edgeMm ?? 100) * 8 / scale)
        const eligible = heatingAreaSurface(core) * (scale / 8000) ** 2
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
        return eligible >= .05 ? [{ area, eligible, room, count: 0 }] : []
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
      if (count > target && proposals.some((proposal) => proposal.count === target && proposal.maxM <= preferredMaxM - 3)) continue
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
            const part = dedicated[i], key = `${parts.indexOf(part)}:${assigned[i]}`
            const attempt = options.entryVariants?.get(heatingRoomKey(part.room)) ?? 0
            const partitionVariant = assigned[i] === 1 ? 0 : Math.floor(attempt / 2)
            // Fragments of one native room still share its feed approach.
            // Sizing the large fragment for just its own two coils can close
            // the bus used by the room's other coils and force long detours.
            const approachCount = assigned[i] > 1 ? dedicated.reduce((sum, other, n) =>
              sum + (other.room.id === part.room.id ? assigned[n] : 0), 0) : assigned[i]
            const partSettings = { ...layoutSettings, entryVariant: assigned[i] === 1 ? attempt : attempt % 2,
              // Keep enough room for the complete supply/return bundle to turn.
              edgeMm: assigned[i] === 2 && approachCount === 2 ? layoutSettings.edgeMm : Math.max(layoutSettings.edgeMm,
                limits.minBendRadiusMm + (approachCount === 1 ? settings.spacingMm :
                  2 * approachCount * Math.ceil(settings.diameterMm / (native.step * scale / 16)) * (native.step * scale / 16)) +
                settings.diameterMm / 2 + native.step * scale / 16) }
            if (!layouts.has(key)) {
              const cacheKey = JSON.stringify([part.area, assigned[i], partSettings, partitionVariant, scale, source,
                options.measuredLeads?.filter((sample) => sample.roomId === part.room.id)])
              if (!partitions.has(cacheKey)) {
                const box = heatingAreaBounds(part.area), entry = part.area.entry
                const distance = Math.hypot(Math.max(0, box.x - entry.x, entry.x - box.x - box.width),
                  Math.max(0, box.y - entry.y, entry.y - box.y - box.height))
                const doorEntry = assigned[i] === 1 && part.eligible < 2.5 && distance <= native.step * 4 && native.door[native.index(entry)]
                partitions.set(cacheKey, partitionHeatingArea(part.area, assigned[i], partSettings, scale,
                  { checkpoint, leadM: lead, entryPoint: doorEntry ? entry : undefined, variant: partitionVariant }))
                if (partitions.size > 128) partitions.delete(partitions.keys().next().value!)
              }
              layouts.set(key, partitions.get(cacheKey)!)
            }
            const result = layouts.get(key)
            if (!result || result.loops.some((loop) => loop.gapRatio > .05)) {
              failureDetail = `${part.room.name}: legvlak van ${part.eligible.toFixed(1)} m² past niet met voldoende dekking in ${assigned[i]} kringen.`
              valid = false; break
            }
            for (const [index, loop] of result.loops.entries()) jobs.push(jobFor(part, loop.points, loop.pattern, heatingAreaSurface(result.areas[index]) * (scale / 8000) ** 2))
          }
          if (!valid || jobs.some((job) => completeM(job) > limits.maxCircuitLengthM + .05)) continue
          for (const part of small.filter((part) => !separate.includes(part))) {
            const loop = generateHeatingAreaLoop(part.area, { ...layoutSettings, entryVariant: options.entryVariants?.get(heatingRoomKey(part.room)) ?? 0 }, scale, checkpoint)
            if (!loop || !joinPatch(jobs, jobFor(part, loop.points, loop.pattern, part.eligible))) { failureDetail = `${part.room.name}: deelvlak van ${part.eligible.toFixed(1)} m² kon niet veilig in dezelfde kring worden opgenomen.`; valid = false; break }
          }
          if (valid) {
            proposals.push({ jobs, count, maxM: Math.max(...jobs.map(completeM)), key: heatingRoomKey(group) })
            if (proposals.at(-1)!.maxM <= preferredMaxM - 3) break
          }
        }
        if (proposals.some((proposal) => proposal.count === count && proposal.maxM <= preferredMaxM - 3)) break
      }
    }
    if (!proposals.length) {
      if (!options.allowPatchJoining) return buildHeatingAreaFields(grid, scene, settings, scale, source, { ...options, allowPatchJoining: true })
      return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(), failedRoom: group.name, failedRoomKey: heatingRoomKey(group), requested: target, failureDetail }
    }
    const bestByCount = new Map<number, Proposal>()
    for (const proposal of proposals) if (!bestByCount.has(proposal.count) || proposal.maxM < bestByCount.get(proposal.count)!.maxM) bestByCount.set(proposal.count, proposal)
    groups.push([...bestByCount.values()]); completed++; options.onRoom?.(group.name, completed, grid.rooms.length)
  }
  let states = [{ jobs: [] as HeatingSpiralField[], count: 0, maxM: 0, targets: new Map<string, number>() }]
  for (const proposals of groups) {
    const candidates = states.flatMap((state) => proposals.flatMap((proposal) => state.count + proposal.count > capacity ? [] : [{
      jobs: [...state.jobs, ...proposal.jobs], count: state.count + proposal.count, maxM: Math.max(state.maxM, proposal.maxM),
      targets: new Map([...state.targets, [proposal.key, proposal.count] as const]) }])).sort((a, b) =>
        Math.max(0, a.maxM - preferredMaxM) - Math.max(0, b.maxM - preferredMaxM) || a.count - b.count || a.maxM - b.maxM)
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
    return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(), failedRoom: 'Volledig grondplan', requested: capacity }
  }
  const occupied = new Set(selected.jobs.flatMap((job) => job.cells))
  return { jobs: selected.jobs, occupied, targets: selected.targets, estimatedMaxM: selected.maxM, allocationAlternatives: states.length }
}
