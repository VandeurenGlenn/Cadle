import type { Point, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import { heatingRoomKey } from './heating-coverage.js'
import { rectangularHeatingArea, unionHeatingAreas, subtractHeatingAreas, partitionHeatingArea, heatingAreaSurface, heatingAreaBounds, heatingAreaComponents, insetHeatingArea, generateHeatingAreaLoop, type HeatingAreaSettings } from './heating-area-kernel.js'
import { heatingObstacleBounds } from './heating-openings.js'
import { shapeBounds } from './model/model.js'
import { routeHeating, simplifyHeatingPath, heatingCurveWallConflict } from './heating-routing.js'
import { heatingPipeData, createHeatingPipe } from './heating-pipe.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { heatingPointClearance } from './heating-clearance.js'
import { checkHeatingPlan } from './heating-checks.js'
import { heatingDesignLimits } from './heating-design.js'
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

export const buildHeatingAreaFields = (grid: HeatingGrid, scene: readonly Shape[], settings: HeatingAreaSettings, scale: DrawingScale, source: Point,
  options: { targets: ReadonlyMap<string, number>; omitted?: ReadonlySet<number>; leads?: Int32Array; checkpoint: () => void;
    nativeGrid?: HeatingGrid; capacity?: number; preferredMaxM?: number; fixedCounts?: boolean; reserveFeeds?: boolean;
    onParts?: (group: string, parts: { room: string; areaM2: number; boundaries: Point[][] }[]) => void;
    onRoom?: (name: string, completed: number, total: number) => void }) => {
  const native = options.nativeGrid ?? grid, obstacles = heatingObstacleBounds(scene, shapeBounds), checkpoint = options.checkpoint
  const limits = heatingDesignLimits(settings.diameterMm, settings.design), capacity = options.capacity ?? [...options.targets.values()].reduce((a, b) => a + b, 0)
  const preferredMaxM = options.preferredMaxM ?? limits.maxCircuitLengthM
  const lead = (p: Point) => {
    const cell = native.index(p), distance = cell >= 0 ? options.leads?.[cell] : -1
    return distance !== undefined && distance >= 0 ? distance * native.step * scale / 8000 :
      (Math.abs(p.x - source.x) + Math.abs(p.y - source.y)) * scale / 8000
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
  const joinPatch = (jobs: HeatingSpiralField[], patch: HeatingSpiralField) => {
    const choices = jobs.flatMap((job, index) => [false, true].flatMap((reverseA) => [false, true].map((reverseB) => {
      const a = reverseA ? [...job.points!].reverse() : job.points!, b = reverseB ? [...patch.points!].reverse() : patch.points!
      return { index, a, b, distance: Math.hypot(a.at(-1)!.x - b[0].x, a.at(-1)!.y - b[0].y) }
    }))).sort((a, b) => a.distance - b.distance)
    const originalPipes = [...jobs, patch].map((job, i) => pipe(job.points!, `area-${i}`))
    for (const { index, a, b } of choices.slice(0, 20)) {
      checkpoint()
      const start = native.index(a.at(-1)!), end = native.index(b[0])
      const heading = (a: Point, b: Point) => Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y) * native.width
      const joints = new Map([[originalPipes[index].id, [a.at(-1)!]], [originalPipes.at(-1)!.id, [b[0]]]])
      const tubeFree = heatingPointClearance(originalPipes, settings.diameterMm, scale, { joints })
      const pointFree = (p: Point) => tubeFree(p) && (!options.reserveFeeds || !grid.feedCorridor?.[grid.index(p)])
      const path = routeHeating(native, start, end, { radiusCells: Math.ceil(2 * limits.minBendRadiusMm * 8 / scale / native.step),
        startDirection: heading(a.at(-2)!, a.at(-1)!), endDirection: heading(b[0], b[1]),
        preferArcs: true, pointFree, permittedWallCells: new Set(), checkpoint })
      if (!path) continue
      const bridge = exact(exact(simplifyHeatingPath(path.map(native.point)), a.at(-1)!, true), b[0], false)
      const points = simplifyHeatingPath([...a, ...bridge.slice(1, -1), ...b]), combined = pipe(points, originalPipes[index].id)
      const geometry = heatingPipeGeometry(combined)
      if (heatingCurveWallConflict(native, geometry.pieces, { permittedWallCells: new Set() })) continue
      if (checkHeatingPlan([...originalPipes.filter((_, i) => i !== index && i !== originalPipes.length - 1), combined], [], settings.design, obstacles,
        { focusPipeIds: new Set([combined.id]), stopOnConflict: true, checkpoint }).errors) continue
      const candidate = { ...jobs[index], points, cells: raster(points), pattern: 'mixed' as const,
        roomName: `${jobs[index].roomName} / ${patch.roomName}`, roomMembers: [...jobs[index].roomMembers ?? [], ...patch.roomMembers ?? []],
        areaM2: jobs[index].areaM2 + patch.areaM2 }
      if (completeM(candidate) > limits.maxCircuitLengthM + .05) continue
      jobs[index] = candidate
      return true
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
    const jobFor = (part: typeof parts[number], points: Point[], pattern: HeatingSpiralField['pattern'], areaM2: number): HeatingSpiralField => ({
      cells: raster(points), points, pattern, roomName: part.room.name, roomKey: heatingRoomKey(group),
      roomMembers: [{ key: heatingRoomKey(part.room), name: part.room.name }], areaM2,
      spacingMinMm: settings.spacingMm, spacingMaxMm: settings.spacingMm })
    const counts = options.fixedCounts ? [target] : [...new Set([target, target + 1, target + 2, Math.max(large.length, target - 1), Math.max(large.length, target - 2)])]
    for (const count of counts) {
      if (count < target && !proposals.some((proposal) => proposal.count === target && proposal.maxM <= preferredMaxM)) continue
      if (count > target && proposals.some((proposal) => proposal.count === target && proposal.maxM <= preferredMaxM - 3)) continue
      if (count < large.length || count > capacity - Math.max(0, grid.rooms.length - 1)) continue
      // A small pocket may share a circuit only when that connection leaves
      // the feed bundle open. Otherwise allocate it one of the available
      // circuits, rather than bridging across every other room's leads.
      const separateCounts = Array.from({ length: Math.min(small.length, count - large.length) + 1 }, (_, i) => i)
      if (separateCounts.length > 1) [separateCounts[0], separateCounts[1]] = [separateCounts[1], separateCounts[0]]
      for (const separate of separateCounts) {
        const dedicated = [...large, ...small.slice(0, separate)], allocation = dedicated.map(() => 1)
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
            if (!layouts.has(key)) layouts.set(key, partitionHeatingArea(part.area, assigned[i], settings, scale, { checkpoint, leadM: lead }))
            const result = layouts.get(key)
            if (!result) { failureDetail = `${part.room.name}: legvlak van ${part.eligible.toFixed(1)} m² past niet in ${assigned[i]} kringen.`; valid = false; break }
            for (const [index, loop] of result.loops.entries()) jobs.push(jobFor(part, loop.points, loop.pattern, heatingAreaSurface(result.areas[index]) * (scale / 8000) ** 2))
          }
          if (!valid || jobs.some((job) => completeM(job) > limits.maxCircuitLengthM + .05)) continue
          for (const part of small.slice(separate)) {
            const loop = generateHeatingAreaLoop(part.area, settings, scale, checkpoint)
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
    if (!proposals.length) return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(), failedRoom: group.name, requested: target, failureDetail }
    const bestByCount = new Map<number, Proposal>()
    for (const proposal of proposals) if (!bestByCount.has(proposal.count) || proposal.maxM < bestByCount.get(proposal.count)!.maxM) bestByCount.set(proposal.count, proposal)
    groups.push([...bestByCount.values()]); completed++; options.onRoom?.(group.name, completed, grid.rooms.length)
  }
  let states = [{ jobs: [] as HeatingSpiralField[], count: 0, maxM: 0, targets: new Map<string, number>() }]
  for (const proposals of groups) {
    const candidates = states.flatMap((state) => proposals.flatMap((proposal) => state.count + proposal.count > capacity ? [] : [{
      jobs: [...state.jobs, ...proposal.jobs], count: state.count + proposal.count, maxM: Math.max(state.maxM, proposal.maxM),
      targets: new Map([...state.targets, [proposal.key, proposal.count] as const]) }])).sort((a, b) => a.maxM - b.maxM || a.count - b.count)
    const seen = new Set<number>()
    states = candidates.filter((state) => { if (seen.has(state.count)) return false; seen.add(state.count); return true })
  }
  const selected = states[0]
  if (!selected) return { jobs: [] as HeatingSpiralField[], occupied: new Set<number>(), failedRoom: 'Volledig grondplan', requested: capacity }
  const occupied = new Set(selected.jobs.flatMap((job) => job.cells))
  return { jobs: selected.jobs, occupied, targets: selected.targets, estimatedMaxM: selected.maxM }
}
