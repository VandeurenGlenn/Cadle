import type { Point, RectShape, Shape } from './model/types.js'
import { drawingLengthMetres, drawingUnitsForMetres, type DrawingScale } from './layout/drawing-scale.js'
import { createHeatingPipe, createHeatingScheduleTables, heatingDefaults, heatingManifoldSize, heatingSchedule, heatingTableSize, HEATING_TABLE_ROW_HEIGHT, type HeatingScheduleRow } from './heating-plan.js'
import { buildHeatingGrid, routeHeating, simplifyHeatingPath, type HeatingGrid } from './heating-routing.js'
import { shapeBounds } from './model/model.js'
import { heatingDesignLimits, sanitizeHeatingDesign, MAX_HEATING_CIRCUITS, type HeatingDesignInputs } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import type { HeatingPlanningProgress } from './heating-planner-protocol.js'
import { checkHeatingPlan } from './heating-checks.js'
import { isHeatingSymbolObstacle } from './heating-openings.js'

/** Open paired meander bends slightly near their ends when half the pitch is below the product radius.
 * The straight runs retain the requested pitch; shallow transitions avoid forcing a tighter U-bend.
 */
export const openHeatingTurns = (points: Point[], radius: number, pipeDiameter = radius / 5): Point[] => {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1], d = points[i + 2]
    if (a && c && d) {
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, wx = d.x - c.x, wy = d.y - c.y
      const before = Math.hypot(ux, uy), gap = Math.hypot(vx, vy), after = Math.hypot(wx, wy), delta = radius - gap / 2
      // Widen the end of each paired run while retaining the entered pitch along
      // the floor. Limit the bulb by the actual tube envelope, not a quarter-pitch
      // cutoff: that cutoff rejected every 100 mm / R80 mm turn for 16 mm pipe.
      const clearBetweenBulbs = gap - 2 * delta
      if (gap > 0 && delta > 1e-6 && clearBetweenBulbs > pipeDiameter + 1e-6 && before > 8 * radius && after > 8 * radius &&
        Math.abs(ux * vx + uy * vy) < 1e-6 && Math.abs(wx * vx + wy * vy) < 1e-6 && ux * wx + uy * wy < 0) {
        const u = { x: ux / before, y: uy / before }, v = { x: vx / gap, y: vy / gap }
        result.push({ x: b.x - u.x * radius * 4, y: b.y - u.y * radius * 4 },
          { x: b.x - u.x * radius * 2 - v.x * delta, y: b.y - u.y * radius * 2 - v.y * delta },
          { x: b.x - v.x * delta, y: b.y - v.y * delta },
          { x: c.x + v.x * delta, y: c.y + v.y * delta },
          { x: c.x - u.x * radius * 2 + v.x * delta, y: c.y - u.y * radius * 2 + v.y * delta },
          { x: c.x - u.x * radius * 4, y: c.y - u.y * radius * 4 })
        i++; continue
      }
    }
    result.push(b)
  }
  return result
}

/** Replace a short square sideways step with a gradual transition, where the floor is free. */
export const softenHeatingJogs = (points: Point[], radius: number, free: (p: Point) => boolean, step: number): Point[] => {
  const result: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1], d = points[i + 2]
    if (a && c && d) {
      const before = Math.hypot(b.x - a.x, b.y - a.y), gap = Math.hypot(c.x - b.x, c.y - b.y), after = Math.hypot(d.x - c.x, d.y - c.y)
      const reach = Math.min(2 * radius, before / 3, after / 3)
      const ux = (b.x - a.x) / before, uy = (b.y - a.y) / before
      if (gap > 0 && gap < 2 * radius && reach >= radius && (d.x - c.x) * ux + (d.y - c.y) * uy > 0 &&
        Math.abs((c.x - b.x) * ux + (c.y - b.y) * uy) < 1e-7) {
        const from = { x: b.x - ux * reach, y: b.y - uy * reach }, to = { x: c.x + ux * reach, y: c.y + uy * reach }
        const n = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (step / 2))
        if (Array.from({ length: n + 1 }, (_, j) => ({ x: from.x + (to.x - from.x) * j / n, y: from.y + (to.y - from.y) * j / n })).every(free)) {
          result.push(from, to); i++; continue
        }
      }
    }
    result.push(points[i])
  }
  return result
}

export type AutomaticHeatingSettings = { diameterMm: number; spacingMm: number; design?: HeatingDesignInputs }
type HeatingWorkBudget = { routes: number; grid?: HeatingGrid; deadline?: number; roomTimeMs?: number; roomDeadline?: number; onProgress?: (value: HeatingPlanningProgress) => void }
const checkHeatingDeadline = (budget: HeatingWorkBudget) => {
  if (budget.deadline !== undefined && Date.now() >= budget.deadline) throw new Error('De planner heeft binnen de rekentijd geen geldige indeling gevonden. Het bestaande plan is behouden.')
}
type CircuitJob = { cells: number[]; roomName: string; roomKey?: string; areaM2: number; spacingMinMm: number; spacingMaxMm: number }

const routeLength = (cells: number[], grid: HeatingGrid, scale: number) => drawingLengthMetres(Math.max(0, cells.length - 1) * grid.step, scale)

/** Keep a room's circuits together. Distance controls planning order, while angular
 * order still controls manifold ports to avoid crossing the connection bundle. */
const roomsFarthestFirst = (grid: HeatingGrid, jobs: CircuitJob[], position: Point) => {
  const rooms = new Map<number, { jobs: CircuitJob[]; minX: number; maxX: number; minY: number; maxY: number }>()
  for (const job of jobs) {
    const id = grid.room[job.cells[0]], room = rooms.get(id) ?? { jobs: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    room.jobs.push(job)
    for (const cell of job.cells) {
      const p = grid.point(cell)
      room.minX = Math.min(room.minX, p.x); room.maxX = Math.max(room.maxX, p.x)
      room.minY = Math.min(room.minY, p.y); room.maxY = Math.max(room.maxY, p.y)
    }
    rooms.set(id, room)
  }
  const distance = (room: { minX: number; maxX: number; minY: number; maxY: number }) =>
    Math.abs((room.minX + room.maxX) / 2 - position.x) + Math.abs((room.minY + room.maxY) / 2 - position.y)
  return [...rooms.values()].sort((a, b) => distance(b) - distance(a)).map((room) => room.jobs)
}


const loopJobs = (grid: HeatingGrid, settings: AutomaticHeatingSettings, scale: number, manifold: Point, budgetFactor: number, rotated = false, halfPitch = false,
  checkpoint: () => void = () => {}) => {
  const jobs: CircuitJob[] = [], occupied = new Set<number>(), size = grid.width * grid.height
  const distance = new Uint16Array(size).fill(65535), queue = new Int32Array(size)
  let read = 0, write = 0
  for (let i = 0; i < size; i++) if (grid.wall[i]) { distance[i] = 0; queue[write++] = i }
  const clearance = Math.ceil(drawingUnitsForMetres(Math.max(.1, heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm * .004), scale) / grid.step)
  while (read < write) {
    const i = queue[read++], x = i % grid.width, y = Math.floor(i / grid.width)
    if (distance[i] >= clearance) continue
    for (const n of [x ? i - 1 : -1, x + 1 < grid.width ? i + 1 : -1, y ? i - grid.width : -1, y + 1 < grid.height ? i + grid.width : -1]) {
      if (n >= 0 && distance[n] > distance[i] + 1) { distance[n] = distance[i] + 1; queue[write++] = n }
    }
  }
  const interval = Math.round(drawingUnitsForMetres(settings.spacingMm / 1000, scale) / grid.step)
  for (const room of grid.rooms) {
    checkpoint()
    const usable = (i: number) => i >= 0 && grid.room[i] === room.id && !grid.obstacle[i] && !grid.loopObstacle[i] && distance[i] >= clearance
    const areaM2 = room.cells.filter(usable).length * drawingLengthMetres(grid.step, scale) ** 2
    const vertical = (room.maxY - room.minY > room.maxX - room.minX) !== rotated
    const axisMin = vertical ? room.minX : room.minY, axisMax = vertical ? room.maxX : room.maxY
    const runMin = vertical ? room.minY : room.minX, runMax = vertical ? room.maxY : room.maxX
    const key = (a: number, b: number) => vertical ? b * grid.width + a : a * grid.width + b
    // Split at changes in free-floor topology: never snake around an obstacle on a
    // succession of grid-cell-wide connectors. Each stable strip gets its own meander.
    const bands: number[][][][] = []
    let previous: number[][] | undefined
    for (let a = axisMin + clearance + (halfPitch ? Math.round(interval / 2) : 0); a <= axisMax - clearance; a += interval) {
      checkpoint()
      const row: number[][] = []
      let run: number[] = []
      for (let b = runMin; b <= runMax + 1; b++) {
        const i = key(a, b)
        if (b <= runMax && usable(i)) run.push(i)
        else { if (run.length >= interval * 2) row.push(run); run = [] }
      }
      const compatible = previous && previous.length === row.length && row.every((r, i) => {
        const p = previous![i], coordinate = (cell: number) => vertical ? Math.floor(cell / grid.width) : cell % grid.width
        return Math.abs(coordinate(p[0]) - coordinate(r[0])) <= interval / 2 &&
          Math.abs(coordinate(p.at(-1)!) - coordinate(r.at(-1)!)) <= interval / 2
      })
      if (!compatible) bands.push(row.map(() => []))
      for (const [i, cells] of row.entries()) bands.at(-1)![i].push(cells)
      previous = row
    }
    const roomJobs: CircuitJob[] = []
    const roomCenter = grid.point(room.cells[Math.floor(room.cells.length / 2)])
    const allowanceM = Math.min(55, 2 * drawingLengthMetres(Math.abs(roomCenter.x - manifold.x) + Math.abs(roomCenter.y - manifold.y), scale))
    const limits = heatingDesignLimits(settings.diameterMm, settings.design)
    const budgetM = Math.max(8, (Math.min(settings.diameterMm < 16 ? 70 : 90, limits.maxCircuitLengthM - limits.allowanceM) - allowanceM) * budgetFactor)
    for (const band of bands) for (const originalStrip of band) {
      const strip = originalStrip
      const pairs = Array.from({ length: Math.ceil(strip.length / 2) }, (_, pair) => strip.slice(pair * 2, pair * 2 + 2)
        .reduce((sum, cells) => sum + routeLength(cells, grid, scale) + settings.spacingMm / 1000, 0))
      const estimatedM = pairs.reduce((sum, length) => sum + length, 0), count = Math.min(pairs.length, Math.max(1, Math.ceil(estimatedM / budgetM)))
      const prefix = [0], cuts = new Set<number>()
      for (const length of pairs) prefix.push(prefix.at(-1)! + length)
      let previousCut = 0
      for (let group = 1; group < count; group++) {
        let best = previousCut + 1
        for (let candidate = best + 1; candidate <= pairs.length - (count - group); candidate++) {
          if (Math.abs(prefix[candidate] - estimatedM * group / count) < Math.abs(prefix[best] - estimatedM * group / count)) best = candidate
        }
        cuts.add(best * 2); previousCut = best
      }
      const probe = (reverse: boolean) => {
        let blocked = 0
        for (const row of [strip[0], strip.at(-1)!]) {
          const end = reverse ? row.at(-1)! : row[0], outward = reverse ? row.at(-1)! - row.at(-2)! : row[0] - row[1]
          for (let n = 1; n <= Math.ceil(drawingUnitsForMetres(limits.minBendRadiusMm * .002, scale) / grid.step); n++) {
            const cell = end + outward * n
            if (cell < 0 || cell >= size || grid.obstacle[cell]) blocked++
          }
        }
        return blocked
      }
      const mirrored = probe(true) < probe(false)
      let current: number[] = []
      const pitches = strip.slice(1).map((r, i) => drawingLengthMetres(Math.abs(vertical ? grid.point(r[0]).x - grid.point(strip[i][0]).x : grid.point(r[0]).y - grid.point(strip[i][0]).y), scale) * 1000)
      const finish = () => { if (current.length > 1) roomJobs.push({ cells: current, roomName: room.name, ...(room.roomKey ? { roomKey: room.roomKey } : {}), areaM2: 0,
        spacingMinMm: pitches.length ? Math.min(...pitches) : settings.spacingMm, spacingMaxMm: pitches.length ? Math.max(...pitches) : settings.spacingMm }); current = [] }
      for (const [row, cells] of strip.entries()) {
        if (cuts.has(row)) finish()
        const segment = Boolean(row % 2) !== mirrored ? [...cells].reverse() : cells
        if (current.length) {
          const protectedCells = new Set(occupied)
          for (const cell of segment.slice(1)) protectedCells.add(cell)
          const connection = routeHeating(grid, current.at(-1)!, segment[0], { roomId: room.id, occupied: protectedCells, checkpoint })
          if (!connection) finish()
          else { current.push(...connection.slice(1)); for (const cell of connection) occupied.add(cell) }
        }
        current.push(...(current.at(-1) === segment[0] ? segment.slice(1) : segment))
        for (const cell of segment) occupied.add(cell)
      }
      finish()
    }
    const total = roomJobs.reduce((sum, job) => sum + routeLength(job.cells, grid, scale), 0)
    for (const job of roomJobs) job.areaM2 = total ? areaM2 * routeLength(job.cells, grid, scale) / total : 0
    jobs.push(...roomJobs)
  }
  if (!jobs.length) throw new Error('Er blijft geen voldoende groot, vrij vloeroppervlak over bij deze legafstand.')
  return { jobs, occupied }
}

/** Join adjacent leg fields in series before assigning manifold ports. This preserves
 * obstacle-free strips without turning every strip into a separate hydraulic circuit. */
const mergeHeatingJobs = (grid: HeatingGrid, jobs: CircuitJob[], occupied: Set<number>, settings: AutomaticHeatingSettings, scale: DrawingScale, position: Point, budgetFactor: number, variant: number, budget: HeatingWorkBudget) => {
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale)
  const roomTimeout = new Error('Room merge budget exhausted')
  let lastProgress = 0, nextCoil = 0
  const checkpoint = () => {
    checkHeatingDeadline(budget)
    const now = Date.now()
    if (budget.roomDeadline !== undefined && now >= budget.roomDeadline) throw roomTimeout
    if (now - lastProgress >= 100) { budget.onProgress?.({ phase: 'circuits' }); lastProgress = now }
  }
  const shape = (cells: number[]) => {
    const id = ++nextCoil
    return createHeatingPipe(`merge-${id}`, openHeatingTurns(simplifyHeatingPath(cells.map(grid.point)), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
      { ...heatingDefaults('pipe', scale), ...settings, automatic: true, circuitId: `VV${id}`, pipeRole: 'loop' })
  }
  const geometries = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (coil: RectShape) => {
    let value = geometries.get(coil)
    if (!value) { value = heatingPipeGeometry(coil); geometries.set(coil, value) }
    return value
  }
  const cached = new WeakMap<CircuitJob, RectShape>()
  const coilFor = (job: CircuitJob) => {
    let value = cached.get(job)
    if (!value) { value = shape(job.cells); cached.set(job, value) }
    return value
  }
  const manifoldSize = heatingManifoldSize(MAX_HEATING_CIRCUITS, scale, grid.step)
  const leadMinimumM = (p: Point) => drawingLengthMetres(Math.hypot(
    Math.max(0, position.x - grid.step - p.x, p.x - position.x - manifoldSize.width - grid.step),
    Math.max(0, position.y - grid.step - p.y, p.y - position.y - manifoldSize.height - grid.step)), scale)
  const exitCache = new WeakMap<RectShape, RectShape[]>()
  const exitsFor = (coil: RectShape) => {
    let value = exitCache.get(coil)
    if (value) return value
    const points = geometryFor(coil).localPoints
    value = [0, 1].map((end) => {
      const p = end ? points.at(-1)! : points[0], near = end ? points.at(-2)! : points[1], length = Math.hypot(p.x - near.x, p.y - near.y)
      return createHeatingPipe(`exit-${coil.id}-${end}`, [p, { x: p.x + (p.x - near.x) / length * radius, y: p.y + (p.y - near.y) / length * radius }],
        { ...coil.heating!, pipeRole: end ? 'return' : 'supply' })
    })
    exitCache.set(coil, value); return value
  }
  const maxMerges = jobs.length - 1
  try {
    for (let pass = 0; pass < maxMerges; pass++) {
      checkpoint()
      const choices: { a: number; b: number; reverseA: boolean; reverseB: boolean; distance: number }[] = []
      for (let a = 0; a < jobs.length; a++) for (let b = a + 1; b < jobs.length; b++) {
        checkpoint()
        if (jobs[a].roomName !== jobs[b].roomName || grid.room[jobs[a].cells[0]] !== grid.room[jobs[b].cells[0]]) continue
        const loopM = drawingLengthMetres(geometryFor(coilFor(jobs[a])).length + geometryFor(coilFor(jobs[b])).length, scale)
        for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
          const from = grid.point(reverseA ? jobs[a].cells[0] : jobs[a].cells.at(-1)!), to = grid.point(reverseB ? jobs[b].cells.at(-1)! : jobs[b].cells[0])
          const inlet = grid.point(reverseA ? jobs[a].cells.at(-1)! : jobs[a].cells[0]), outlet = grid.point(reverseB ? jobs[b].cells[0] : jobs[b].cells.at(-1)!)
          // Bound each orientation using its actual exposed ends, rather than
          // assuming that both manifold leads end at the first point of field A.
          // Allow the fillets to shorten the two new corners by at most 4 radii.
          const connectorM = Math.max(0, drawingLengthMetres(Math.hypot(from.x - to.x, from.y - to.y) - 4 * radius, scale))
          if (loopM + connectorM + leadMinimumM(inlet) + leadMinimumM(outlet) + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) continue
          choices.push({ a, b, reverseA, reverseB, distance: Math.abs(from.x - to.x) + Math.abs(from.y - to.y) })
        }
      }
      choices.sort((a, b) => variant === 1 ? b.distance - a.distance : a.distance - b.distance)
      if (variant === 2 && choices.length > 4) choices.push(...choices.splice(0, 4))
      if (variant === 3) choices.sort((a, b) => a.a - b.a || b.b - a.b || a.distance - b.distance)
      let merged = false
      for (const choice of choices) {
        const a = choice.reverseA ? [...jobs[choice.a].cells].reverse() : jobs[choice.a].cells,
          b = choice.reverseB ? [...jobs[choice.b].cells].reverse() : jobs[choice.b].cells
        const mergeBlocked = new Set(occupied), reach = Math.ceil(radius / grid.step)
        for (const [j, job] of jobs.entries()) for (const endpoint of [0, 1]) {
          if ((j === choice.a && endpoint === (choice.reverseA ? 0 : 1)) || (j === choice.b && endpoint === (choice.reverseB ? 1 : 0))) continue
          const cells = job.cells, root = endpoint ? cells.at(-1)! : cells[0], direction = endpoint ? root - cells.at(-2)! : root - cells[1]
          for (let n = 1; n <= reach; n++) mergeBlocked.add(root + direction * n)
        }
        checkpoint()
        if (--budget.routes < 0) return false
        const connection = routeHeating(grid, a.at(-1)!, b[0], { roomId: grid.room[a[0]], occupied: mergeBlocked, radiusCells: Math.ceil(2 * radius / grid.step),
          startDirection: a.at(-1)! - a.at(-2)!, endDirection: b[1] - b[0], checkpoint })
        if (!connection) continue
        const cells = [...a, ...connection.slice(1), ...b.slice(1)], candidate = shape(cells)
        const p = grid.point(cells[0]), q = grid.point(cells.at(-1)!), leadM = leadMinimumM(p) + leadMinimumM(q)
        if (drawingLengthMetres(geometryFor(candidate).length, scale) + leadM + limits.allowanceM > limits.maxCircuitLengthM * budgetFactor) continue
        const geometry = geometryFor(candidate)
        if (geometry.pieces.some((piece) => {
          const n = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / grid.step))
          return Array.from({ length: n + 1 }, (_, j) => grid.index({ x: piece.a.x + (piece.b.x - piece.a.x) * j / n, y: piece.a.y + (piece.b.y - piece.a.y) * j / n }))
            .some((i) => i < 0 || grid.wall[i] || grid.obstacle[i] || grid.room[i] !== grid.room[a[0]])
        })) continue
        const others = jobs.flatMap((job, i) => i === choice.a || i === choice.b || grid.room[job.cells[0]] !== grid.room[a[0]] ? [] : [coilFor(job)])
        const candidateExits = exitsFor(candidate)
        const exits = [...candidateExits, ...others.flatMap(exitsFor)]
        // Only the new coil and its escape tails changed. Keep their self-checks
        // and comparisons with every other coil; do not re-check unchanged pairs.
        const audit = checkHeatingPlan([candidate, ...others, ...exits], [], settings.design, [], {
          focusPipeIds: new Set([candidate.id, ...candidateExits.map((exit) => exit.id)]), checkpoint, geometryFor, stopOnConflict: true
        })
        const conflict = audit.issues.find((issue) => issue.code === 'collision' || issue.code === 'bend')
        if (conflict) continue
        jobs[choice.a] = { ...jobs[choice.a], cells, areaM2: jobs[choice.a].areaM2 + jobs[choice.b].areaM2, spacingMinMm: Math.min(jobs[choice.a].spacingMinMm, jobs[choice.b].spacingMinMm), spacingMaxMm: Math.max(jobs[choice.a].spacingMaxMm, jobs[choice.b].spacingMaxMm) }
        jobs.splice(choice.b, 1)
        for (const cell of connection) occupied.add(cell)
        merged = true; break
      }
      if (!merged) break
    }
    return true
  } catch (error) {
    if (error === roomTimeout) return false
    throw error
  }
}

/** Plan complete circuits before checking manifold capacity. Temporary leg fields
 * are allowed to exceed that capacity: several can belong to one circuit. */
export const planHeatingCircuits = (grid: HeatingGrid, settings: AutomaticHeatingSettings, scale: DrawingScale, position: Point,
  { lengthPass = 0, mergeVariant = 0, budget = { routes: 600 } as HeatingWorkBudget, reservedForCoils = [] as readonly number[] } = {}) => {
  const fieldGrid = reservedForCoils.length ? { ...grid, obstacle: grid.obstacle.slice() } : grid
  for (const cell of reservedForCoils) fieldGrid.obstacle[cell] = 1
  const attempt = lengthPass * 8 + mergeVariant + 1
  budget.onProgress?.({ phase: 'circuits', attempt })
  const { jobs, occupied } = loopJobs(fieldGrid, settings, scale, position, Math.pow(.75, lengthPass), Math.floor(mergeVariant / 2) % 2 === 1, mergeVariant % 2 === 1,
    () => checkHeatingDeadline(budget))
  const initialFieldCount = jobs.length
  if (budget.routes <= 0) return { jobs, occupied, initialFieldCount, combiningFinished: false }
  const fieldsByRoom = roomsFarthestFirst(grid, jobs, position)
  budget.onProgress?.({ phase: 'circuits', attempt, fields: initialFieldCount, rooms: fieldsByRoom.length, completedRooms: 0 })
  const combined: CircuitJob[] = []
  let combiningFinished = true, completedRooms = 0
  for (const fields of fieldsByRoom) {
    checkHeatingDeadline(budget)
    // Merging cannot cross room boundaries. Solve each room independently and
    // reserve the global routing budget for the subsequent manifold connections.
    const routes = Math.min(600, Math.max(80, fields.length * 32))
    const report = () => budget.onProgress?.({ phase: 'circuits', attempt, fields: initialFieldCount, circuits: combined.length,
      rooms: fieldsByRoom.length, completedRooms, roomName: fields[0].roomName,
      remainingFields: fields.length, routeAttempts: routes - roomBudget.routes })
    const roomBudget: HeatingWorkBudget = { routes, deadline: budget.deadline,
      roomDeadline: Date.now() + (budget.roomTimeMs ?? 2500), onProgress: report }
    report()
    const variant = initialFieldCount > MAX_HEATING_CIRCUITS ? (mergeVariant < 4 ? 0 : 1) : (mergeVariant < 4 ? 1 : 0)
    combiningFinished = mergeHeatingJobs(grid, fields, occupied, settings, scale, position, Math.pow(.85, lengthPass), variant, roomBudget) && combiningFinished
    combined.push(...fields)
    completedRooms++
    report()
  }
  return { jobs: combined, occupied, initialFieldCount, combiningFinished }
}

export type AutomaticHeatingResult = { shapes: RectShape[]; rows: HeatingScheduleRow[]; tableOnSeparatePage: boolean; wallCrossings: number }

const generateHeatingAttempt = (scene: readonly Shape[], position: Point, settings: AutomaticHeatingSettings,
  scale: DrawingScale, nextId: () => string, pageArea: { x: number; y: number; width: number; height: number },
  lengthPass = 0, mergeVariant = 0, budget: HeatingWorkBudget = { routes: 600 }): AutomaticHeatingResult | { retry: { lengthPass: number; mergeVariant: number } } => {
  if (!Number.isFinite(settings.diameterMm) || settings.diameterMm < 6 || settings.diameterMm > 50 ||
    !Number.isFinite(settings.spacingMm) || settings.spacingMm < 50 || settings.spacingMm > 500) throw new Error('Controleer de buisdiameter en legafstand.')
  settings = { ...settings, design: sanitizeHeatingDesign(settings.design) }
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  // Inputs remain fixed throughout this search; only strip direction/phase and splitting
  // vary. Reuse room rasterisation while isolating each attempt's temporary obstacles.
  checkHeatingDeadline(budget)
  if (!budget.grid) budget.onProgress?.({ phase: 'rooms' })
  const template = budget.grid ??= buildHeatingGrid(scene, scale, settings.spacingMm, position, {
    pipeDiameterMm: settings.diameterMm, minBendRadiusMm: limits.minBendRadiusMm
  })
  const grid = { ...template, obstacle: template.obstacle.slice() }
  if (grid.obstacle[grid.index(position)]) throw new Error('De verdeler staat op een symbool. Kies een vrije positie.')
  const { width: reservedWidth, height: manifoldHeight } = heatingManifoldSize(MAX_HEATING_CIRCUITS, scale, grid.step)
  const heatOnly: number[] = []
  for (let i = 0; i < grid.obstacle.length; i++) {
    const p = grid.point(i)
    if (p.x >= position.x - grid.step && p.x <= position.x + reservedWidth && p.y >= position.y - grid.step && p.y < position.y + manifoldHeight - grid.step) grid.obstacle[i] = 1
    if (!grid.obstacle[i] && p.x >= position.x - grid.step && p.x <= position.x + reservedWidth &&
      p.y >= position.y + manifoldHeight - grid.step && p.y <= position.y + manifoldHeight + 4 * grid.step) { heatOnly.push(i) }
  }
  const { jobs, occupied, combiningFinished } = planHeatingCircuits(grid, settings, scale, position,
    { lengthPass, mergeVariant, budget, reservedForCoils: heatOnly })
  if (jobs.length > MAX_HEATING_CIRCUITS) {
    if (!combiningFinished) {
      if (mergeVariant < 7 && budget.routes > 0) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
      throw new Error('De planner kon de deelvlakken nog niet volledig tot kringen samenvoegen. Er is nog geen definitief aantal kringen bepaald.')
    }
    if (mergeVariant < 7 && budget.routes > 0) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
    throw new Error(`Deze automatische indeling komt na samenvoegen op ${jobs.length} kringen. De planner ondersteunt maximaal ${MAX_HEATING_CIRCUITS} kringen per verdeler.`)
  }
  // Keep ports in angular floor order; arbitrary room/band order forces crossing pairs at the manifold.
  const angle = (job: CircuitJob) => {
    const points = job.cells.map(grid.point), x = (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
      y = (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2
    return Math.atan2(y - position.y, x - position.x)
  }
  jobs.sort((a, b) => angle(b) - angle(a))

  const { width, height } = heatingManifoldSize(jobs.length, scale, grid.step)
  for (const shape of scene) {
    if (!isHeatingSymbolObstacle(shape)) continue
    const b = shapeBounds(shape)
    if (position.x < b.x + b.width && position.x + width > b.x && position.y < b.y + b.height && position.y + height > b.y) {
      throw new Error('De verdeler overlapt een symbool. Kies een vrije positie voor de verdeler.')
    }
  }
  const bottom = grid.point(grid.index({ x: position.x, y: position.y + height })).y
  const manifold: RectShape = { id: nextId(), kind: 'rect', start: position,
    end: { x: position.x + width, y: bottom }, strokeWidth: 2,
    heating: { ...heatingDefaults('manifold', scale), ...settings, automatic: true, circuits: jobs.length, name: 'Verdeler', points: [] } }
  const shapes: RectShape[] = [manifold], baseOccupied = new Set(occupied)
  const centreX = grid.point(grid.index({ x: position.x + grid.step * 2, y: bottom })).x
  const radius = drawingUnitsForMetres(limits.minBendRadiusMm / 1000, scale), radiusCells = Math.ceil(2 * radius / grid.step)
  const stemLength = Math.max(4, radiusCells + 1)
  const stems = Array.from({ length: jobs.length }, (_, i) => [centreX + i * grid.step * 3, centreX + (i * 3 + 1) * grid.step]
    .map((x, offset) => Array.from({ length: stemLength + (jobs.length * 2 - 1 - (i * 2 + offset)) * radiusCells }, (_, j) => grid.index({ x, y: bottom + j * grid.step }))))
  if (stems.some((pair) => pair.some((stem) => stem.some((cell) => cell < 0 || grid.obstacle[cell])))) {
    throw new Error('Er is onvoldoende vrije ruimte voor de aansluitingen onder de verdeler.')
  }
  for (const pair of stems) for (const stem of pair) for (const cell of stem) baseOccupied.add(cell)
  // The vertical connection apron has no sideways passages between neighbouring ports.
  // Keep routed bends below it, rather than letting A* squeeze back through the stem bundle.
  const apronBottom = Math.min(...stems.flat().map((stem) => grid.point(stem.at(-1)!).y))
  for (let i = 0; i < grid.obstacle.length; i++) {
    const p = grid.point(i)
    if (p.x >= position.x - radius && p.x <= position.x + width + radius && p.y >= position.y - grid.step && p.y < apronBottom) grid.obstacle[i] = 1
  }

  const routePoints = (cells: number[]) => cells.length === 1 ? [grid.point(cells[0]), grid.point(cells[0])] : simplifyHeatingPath(cells.map(grid.point))
  const stemCells = new Set(stems.flat(2))
  const escapes = jobs.map((job, index) => {
    const cells = job.cells, first = cells[0], last = cells.at(-1)!
    return [[stems[index][0].at(-1)!, grid.width], [stems[index][1].at(-1)!, grid.width],
      [first, first - cells[1]], [last, last - cells.at(-2)!]].map(([root, direction]) =>
        Array.from({ length: Math.ceil(radiusCells / 2) }, (_, n) => root + direction * (n + 1)))
  })
  for (const escape of escapes.flat()) for (const cell of escape) baseOccupied.add(cell)
  const ids = jobs.map(() => [nextId(), nextId(), nextId()])
  const common = jobs.map((job, index) => ({ ...heatingDefaults('pipe', scale), ...settings, automatic: true,
    circuitId: `VV${String(index + 1).padStart(2, '0')}`, roomName: job.roomName, ...(job.roomKey ? { roomKey: job.roomKey } : {}), spacingMinMm: job.spacingMinMm, spacingMaxMm: job.spacingMaxMm }))
  const coils = jobs.map((job, index) => {
    for (const offset of [0, 1]) manifold.heating!.points![2 * index + offset] = { x: (grid.point(stems[index][offset][0]).x - position.x) / width, y: 1 }
    return createHeatingPipe(ids[index][0], openHeatingTurns(routePoints(job.cells), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)),
      { ...common[index], name: common[index].circuitId, pipeRole: 'loop', servedAreaM2: job.areaM2 })
  })
  const geometries = new WeakMap<RectShape, ReturnType<typeof heatingPipeGeometry>>()
  const geometryFor = (pipe: RectShape) => {
    let value = geometries.get(pipe)
    if (!value) { value = heatingPipeGeometry(pipe); geometries.set(pipe, value) }
    return value
  }
  const checkpoint = () => checkHeatingDeadline(budget)
  const obstacles = scene.filter(isHeatingSymbolObstacle).map(shapeBounds)
  const wallAccess = {
    wallEntryPenalty: drawingUnitsForMetres(.7, scale) / grid.step,
    manifoldAccess: { point: { x: position.x + width / 2, y: bottom }, radius: drawingUnitsForMetres(1, scale),
      entryPenalty: drawingUnitsForMetres(.35, scale) / grid.step }
  }
  type Connection = { index: number; parts: RectShape[]; paths: number[][] }
  const pair = (index: number, reverse: boolean, returnFirst: boolean, blocked: Set<number>, completed: Connection[]): Connection | null => {
    const cells = reverse ? [...jobs[index].cells].reverse() : jobs[index].cells, first = cells[0], last = cells.at(-1)!
    const [aStem, bStem] = stems[index], firstDirection = cells[1] - first, lastDirection = last - cells.at(-2)!
    const localBlocked = new Set(blocked)
    for (const escape of escapes[index]) for (const cell of escape) if (!occupied.has(cell) && !stemCells.has(cell)) localBlocked.delete(cell)
    const aBlocked = new Set(localBlocked)
    const coilStartEscape = escapes[index][reverse ? 3 : 2], coilEndEscape = escapes[index][reverse ? 2 : 3]
    for (const cell of returnFirst ? [...escapes[index][0], ...coilStartEscape] : [...escapes[index][1], ...coilEndEscape]) aBlocked.add(cell)
    const aOptions = { ...wallAccess, allowWalls: true, radiusCells, occupied: aBlocked, checkpoint,
      startDirection: returnFirst ? lastDirection : grid.width, endDirection: returnFirst ? -grid.width : firstDirection }
    checkHeatingDeadline(budget)
    if (--budget.routes < 0) return null
    const a = returnFirst ? routeHeating(grid, last, bStem.at(-1)!, aOptions) : routeHeating(grid, aStem.at(-1)!, first, aOptions)
    if (!a) return null
    const bOptions = { ...wallAccess, allowWalls: true, radiusCells, occupied: new Set([...localBlocked, ...a]), checkpoint,
      startDirection: returnFirst ? grid.width : lastDirection, endDirection: returnFirst ? firstDirection : -grid.width }
    checkHeatingDeadline(budget)
    if (--budget.routes < 0) return null
    const b = returnFirst ? routeHeating(grid, aStem.at(-1)!, first, bOptions) : routeHeating(grid, last, bStem.at(-1)!, bOptions)
    if (!b) return null
    const supply = [...aStem.slice(0, -1), ...(returnFirst ? b : a)], returning = [...(returnFirst ? a : b), ...bStem.slice(0, -1).reverse()]
    const loop = reverse ? createHeatingPipe(ids[index][0], openHeatingTurns(routePoints(cells), radius, drawingUnitsForMetres(settings.diameterMm / 1000, scale)), coils[index].heating!) : coils[index]
    const parts = [loop, createHeatingPipe(ids[index][1], routePoints(supply), { ...common[index], name: `${common[index].circuitId} aanvoer`, pipeRole: 'supply' }),
      createHeatingPipe(ids[index][2], routePoints(returning), { ...common[index], name: `${common[index].circuitId} retour`, pipeRole: 'return' })]
    if (parts.reduce((sum, part) => sum + drawingLengthMetres(geometryFor(part).length, scale), 0) + limits.allowanceM > limits.maxCircuitLengthM + .05) return null
    const geometry = checkHeatingPlan([...coils.filter((_, i) => i !== index && !completed.some((c) => c.index === i)), ...completed.flatMap((c) => c.parts), ...parts], [], settings.design, obstacles,
      { focusPipeIds: new Set(parts.map((part) => part.id)), checkpoint, geometryFor, stopOnConflict: true })
    if (geometry.issues.some((issue) => ['collision', 'bend', 'obstacle'].includes(issue.code))) return null
    return { index, parts, paths: [supply, returning] }
  }
  // Backtrack whole pairs when a greedy connection blocks the next circuit.
  // Validation checks the rendered curves, not just orthogonal grid centre lines.
  budget.onProgress?.({ phase: 'connections', circuits: jobs.length, completedCircuits: 0, attempt: lengthPass * 8 + mergeVariant + 1 })
  let attempts = 0, furthestConnection = 0
  const failed = new Set<string>()
  const jobIndex = new Map(jobs.map((job, index) => [job, index]))
  const byDistance = roomsFarthestFirst(grid, jobs, position).flatMap((room) => room.map((job) => jobIndex.get(job)!))
  const ascending = jobs.map((_, index) => index)
  let connections: Connection[] | null = null
  for (const order of [byDistance, ascending, [...ascending].reverse()]) {
    // Retry only the current and preceding room. Do not revisit all the completed
    // rooms whenever one new connection fails: that search grows exponentially.
    let roomNumber = -1, previousRoom = -1, furthestRoom = 0
    const roomNumbers = order.map((index) => {
      const room = grid.room[jobs[index].cells[0]]
      if (room !== previousRoom) { roomNumber++; previousRoom = room }
      return roomNumber
    })
    const search = (offset: number, blocked: Set<number>, completed: Connection[], decisions: string): Connection[] | null => {
      checkHeatingDeadline(budget)
      if (completed.length > furthestConnection) {
        furthestConnection = completed.length
        budget.onProgress?.({ phase: 'connections', circuits: jobs.length, completedCircuits: completed.length,
          roomName: jobs[order[Math.min(offset, order.length - 1)]].roomName, attempt: lengthPass * 8 + mergeVariant + 1 })
      }
      if (offset === order.length) return [...completed]
      furthestRoom = Math.max(furthestRoom, roomNumbers[offset])
      if (failed.has(decisions) || budget.routes <= 0) return null
      const index = order[offset]
      for (const reverse of [true, false]) for (const returnFirst of [false, true]) {
        if (roomNumbers[offset] < furthestRoom - 1 || ++attempts > 240) return null
        const connection = pair(index, reverse, returnFirst, blocked, completed)
        if (!connection) continue
        // Mutate and undo the occupied mask instead of retaining a full copy of
        // every completed route at each level of the search tree.
        const added: number[] = []
        for (const path of connection.paths) for (const cell of path) if (!blocked.has(cell)) { blocked.add(cell); added.push(cell) }
        completed.push(connection)
        const result = search(offset + 1, blocked, completed, `${decisions}/${index}:${+reverse}${+returnFirst}`)
        completed.pop()
        for (const cell of added) blocked.delete(cell)
        if (result) return result
      }
      failed.add(decisions)
      return null
    }
    attempts = 0
    // A decision prefix uniquely determines deterministic routes; storing all
    // their cell coordinates in a fingerprint wastes memory without adding state.
    failed.clear()
    connections = search(0, baseOccupied, [], '')
    if (connections) break
  }
  if (!connections && budget.routes <= 0) throw new Error('Geen passende aansluiting gevonden binnen deze indeling. Kies een vrijere verdelerpositie of verdeel het grondplan over meerdere verdelers.')
  if (!connections && mergeVariant < 7) return { retry: { lengthPass, mergeVariant: mergeVariant + 1 } }
  if (!connections && lengthPass < 3) return { retry: { lengthPass: lengthPass + 1, mergeVariant: 0 } }
  if (!connections) throw new Error('Geen kruisingsvrije aansluitingen met deze buigradius gevonden. Kies een vrijere verdelerpositie of verdeel het plan over meer verdelers.')
  let wallCrossings = 0
  for (const connection of connections) {
    shapes.push(...connection.parts)
    for (const path of connection.paths) {
      let insideWall = false
      for (const cell of path) {
        const crossing = Boolean(grid.wall[cell] && !grid.door[cell])
        if (crossing && !insideWall) {
          const p = grid.point(cell)
          shapes.push({ id: nextId(), kind: 'rect', start: { x: p.x - 4, y: p.y - 4 }, end: { x: p.x + 4, y: p.y + 4 }, variant: 'circle',
            fill: 'white', stroke: '#b42318', strokeWidth: 1, generationKey: `heating-penetration:${common[connection.index].circuitId}:${wallCrossings++}` })
        }
        insideWall = crossing
      }
    }
  }
  let rows = heatingSchedule(shapes)
  if (lengthPass < 3 && rows.some((row) => (row.cutM ?? row.totalM) > limits.maxCircuitLengthM + .05)) {
    return { retry: { lengthPass: lengthPass + 1, mergeVariant: 0 } }
  }
  budget.onProgress?.({ phase: 'checks', circuits: rows.length })
  const audit = checkHeatingPlan([...scene, ...shapes], rows, settings.design,
    scene.filter(isHeatingSymbolObstacle).map(shapeBounds), { checkpoint, geometryFor })
  rows = rows.map((row) => ({ ...row, checkMessages: audit.issues.filter((issue) => issue.circuits.includes(row.id)).map((issue) => issue.message) }))
  manifold.heating!.audit = audit; manifold.heating!.rows = rows
  for (const shape of shapes) if (shape.heating?.pipeRole === 'loop') shape.heating.checks = audit.issues.filter((issue) => issue.circuits.includes(shape.heating!.circuitId!))
  const maxRows = Math.max(1, Math.floor((1384 - heatingTableSize(0).height) / HEATING_TABLE_ROW_HEIGHT))
  const tableSize = heatingTableSize(rows.length)
  const collisions = [...scene.filter((shape) => !shape.hidden && shape.kind !== 'image'), ...shapes].map(shapeBounds)
  const candidates = [
    { x: pageArea.x + pageArea.width - tableSize.width, y: pageArea.y + pageArea.height - tableSize.height },
    { x: pageArea.x, y: pageArea.y + pageArea.height - tableSize.height },
    { x: pageArea.x + pageArea.width - tableSize.width, y: pageArea.y },
    { x: pageArea.x, y: pageArea.y }
  ]
  const fits = rows.length <= maxRows && candidates.find((p) => p.x >= pageArea.x && p.y >= pageArea.y && p.x + tableSize.width <= pageArea.x + pageArea.width &&
    p.y + tableSize.height <= pageArea.y + pageArea.height && !collisions.some((b) => p.x < b.x + b.width + 24 && p.x + tableSize.width > b.x - 24 &&
      p.y < b.y + b.height + 24 && p.y + tableSize.height > b.y - 24))
  const tablePosition = fits || { x: 80, y: 80 }
  shapes.push(...createHeatingScheduleTables(rows, { ...heatingDefaults('table', scale), ...settings, name: 'Kringentabel', audit }, nextId, tablePosition))
  return { shapes, rows, tableOnSeparatePage: !fits, wallCrossings }
}


/** Each unsuccessful layout is released before the next variant starts. Recursive
 * retries would retain its grid overlays, paths and search sets on the call stack. */
export const generateAutomaticHeatingPlan = (scene: readonly Shape[], position: Point, settings: AutomaticHeatingSettings,
  scale: DrawingScale, nextId: () => string, pageArea: { x: number; y: number; width: number; height: number },
  lengthPass = 0, mergeVariant = 0, budget: HeatingWorkBudget = { routes: 600 }): AutomaticHeatingResult => {
  for (;;) {
    const result = generateHeatingAttempt(scene, position, settings, scale, nextId, pageArea, lengthPass, mergeVariant, budget)
    if (!('retry' in result)) return result
    lengthPass = result.retry.lengthPass
    mergeVariant = result.retry.mergeVariant
  }
}
