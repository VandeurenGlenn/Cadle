// Independent, read-only verification against the original architectural scene.
// node --import tsx scripts/audit-heating-drawing.mjs original.json generated.json
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { sanitizeShapes, shapeBounds } from '../src/editor/model/model.ts'
import { heatingSchedule } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { buildHeatingGrid, heatingCurveWallConflict, heatingSourceRoom } from '../src/editor/heating-routing.ts'
import { heatingInternalWallCells } from '../src/editor/heating-wall-policy.ts'
import { heatingDoorSymbolThreshold, heatingObstacleBounds, isHeatingDoorSymbol } from '../src/editor/heating-openings.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { measureHeatingCoverage, heatingRoomKey } from '../src/editor/heating-coverage.ts'
import { segmentDistance } from '../src/editor/heating-distance.ts'

const flags = new Set(process.argv.slice(4))
const coverageEdge = [...flags].find((flag) => flag.startsWith('--coverage-edge='))
const coverageEdgeMm = coverageEdge ? Number(coverageEdge.slice('--coverage-edge='.length)) : undefined
if (process.argv.length < 4 || [...flags].some((flag) => flag !== '--require-coverage' && flag !== '--strict-clearance' && flag !== coverageEdge) ||
  coverageEdgeMm !== undefined && (!Number.isFinite(coverageEdgeMm) || coverageEdgeMm < 0 || coverageEdgeMm > 1000))
  throw new Error('Use original.json generated.json [--require-coverage] [--strict-clearance] [--coverage-edge=0..1000]')
const bytes = readFileSync(process.argv[2]), original = JSON.parse(bytes)
const generated = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const scene = sanitizeShapes(original.shapes ?? original), shapes = sanitizeShapes(generated.shapes ?? generated)
const generatedById = new Map(shapes.map((shape) => [shape.id, shape]))
const originalDrawingProblems = scene.flatMap((shape) => !generatedById.has(shape.id)
  ? [{ id: shape.id, reason: 'original-shape-missing' }] : !isDeepStrictEqual(shape, generatedById.get(shape.id))
    ? [{ id: shape.id, reason: 'original-shape-changed' }] : [])
const pipes = shapes.filter((shape) => shape.heating?.kind === 'pipe')
const owner = shapes.find((shape) => shape.heating?.kind === 'manifold')
if (!owner || !pipes.length) throw new Error('A generated manifold position and pipes are required.')
const scale = original.drawingScale ?? 100, source = owner.start, settings = owner.heating
const grid = buildHeatingGrid(scene, scale, settings.spacingMm, source,
  { pipeDiameterMm: settings.diameterMm, minBendRadiusMm: settings.design?.minBendRadiusMm ?? settings.diameterMm * 5 })
const sourceRoom = heatingSourceRoom(grid, source)?.id
const rows = heatingSchedule(pipes), problems = []
const geometry = new Map(pipes.map((pipe) => [pipe, heatingPipeGeometry(pipe)]))
const obstacles = heatingObstacleBounds(scene, shapeBounds)
// Inspect physical tubes without a manifold exemption, then independently
// check continuity/length/capacity with the actual manifold metadata present.
const strictTubeClearance = flags.has('--strict-clearance')
const audit = checkHeatingPlan(pipes, [], settings.design, obstacles, { strictTubeClearance })
const scheduleAudit = checkHeatingPlan(shapes, rows, settings.design, obstacles, { strictTubeClearance })
const errors = [...audit.issues, ...scheduleAudit.issues].filter((issue, i, all) => issue.severity === 'error' &&
  all.findIndex((other) => JSON.stringify(other) === JSON.stringify(issue)) === i)
const permittedWallCells = heatingInternalWallCells(grid, scale)
const markers = shapes.filter((shape) => shape.generationKey?.startsWith('heating-penetration:')).map((shape) => ({
  x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 }))
const feeds = pipes.filter((pipe) => pipe.heating.pipeRole !== 'loop')
const openings = scene.flatMap((shape) => {
  if (shape.hidden) return []
  const threshold = isHeatingDoorSymbol(shape) ? heatingDoorSymbolThreshold(shape) :
    shape.kind === 'door' || shape.kind === 'gate' ? shape : undefined
  return threshold ? [{ id: shape.id, start: threshold.start, end: threshold.end }] : []
})
const solidWalls = scene.flatMap((shape) => {
  if (shape.hidden || shape.kind !== 'wall') return []
  const { start, end } = shape, width = (shape.strokeWidth ?? 6) / 2
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
  if (!length) return []
  const at = (p) => ((p.x - start.x) * dx + (p.y - start.y) * dy) / length
  const across = (p) => Math.abs((p.x - start.x) * dy - (p.y - start.y) * dx) / length
  const point = (d) => ({ x: start.x + d / length * dx, y: start.y + d / length * dy })
  const gaps = openings.filter((door) => across(door.start) <= width && across(door.end) <= width)
    .map(({ start: a, end: b }) => [Math.max(0, Math.min(at(a), at(b))), Math.min(length, Math.max(at(a), at(b)))])
    .filter(([a, b]) => a < b).sort((a, b) => a[0] - b[0])
  const segments = []
  let through = 0
  for (const [a, b] of [...gaps, [length, length]]) {
    if (a > through) segments.push({ a: point(through), b: point(a), width })
    through = Math.max(through, b)
  }
  return segments
})
const separation = (a, b, c, d) => {
  const x = b.x - a.x, y = b.y - a.y, u = d.x - c.x, v = d.y - c.y
  const det = x * v - y * u
  if (Math.abs(det) > 1e-10) {
    const t = ((c.x - a.x) * v - (c.y - a.y) * u) / det, s = ((c.x - a.x) * y - (c.y - a.y) * x) / det
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0
  }
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b))
}
const wallClearanceMm = (pipe) => {
  let clearance = Infinity
  for (const piece of geometry.get(pipe).pieces) for (const segment of solidWalls)
    clearance = Math.min(clearance, separation(piece.a, piece.b, segment.a, segment.b) - segment.width)
  return clearance === Infinity ? undefined : +Math.max(0, clearance * scale / 8 - pipe.heating.diameterMm / 2).toFixed(1)
}
const crossesOpening = (curve, opening) => {
  const dx = opening.end.x - opening.start.x, dy = opening.end.y - opening.start.y
  const length2 = dx * dx + dy * dy
  if (length2 === 0 || !curve.pieces.length) return false
  const side = (p) => dx * (p.y - opening.start.y) - dy * (p.x - opening.start.x)
  const onUsableOpening = (p) => {
    const along = (p.x - opening.start.x) * dx + (p.y - opening.start.y) * dy
    return along > 0 && along < length2 && Boolean(grid.door[grid.index(p)])
  }
  // Samples can land exactly on a threshold. Count them only when the tube
  // continues onto the opposite side, so touching it is not a passage.
  let previous, sign = 0, onThreshold = false, reachedOpening = false
  for (const p of [curve.pieces[0].a, ...curve.pieces.map((piece) => piece.b)]) {
    const offset = side(p)
    if (Math.abs(offset) < 1e-7) {
      onThreshold = true
      reachedOpening ||= onUsableOpening(p)
      continue
    }
    if (sign && Math.sign(offset) !== sign) {
      if (onThreshold && reachedOpening) return true
      if (!onThreshold) {
        const from = side(previous), t = from / (from - offset)
        if (onUsableOpening({ x: previous.x + t * (p.x - previous.x), y: previous.y + t * (p.y - previous.y) })) return true
      }
    }
    previous = p
    sign = Math.sign(offset)
    onThreshold = reachedOpening = false
  }
  return false
}
const feedChecks = new Map()

// Recompute coverage from the original architecture and actual rounded tubes.
// Saved owner metadata must not hide an omitted room or retain stale coverage
// after a loop has been improved without changing its feeds.
const coverageGrid = { ...grid, rooms: grid.rooms.filter((room) =>
  !settings.excludedRoomKeys?.includes(heatingRoomKey(room)) && (settings.heatSourceRoom !== false || room.id !== sourceRoom)) }
const evaluationEdge = coverageEdgeMm ?? settings.edgeMm ?? 100
const coverage = measureHeatingCoverage(coverageGrid, pipes, scale, settings.spacingMm, evaluationEdge, () => {}, false).coverage
const coverageProblems = coverage.rooms.filter((room) => room.gapM2 > Math.max(.05, room.eligibleM2 * .02))
for (const pipe of pipes) {
  const curve = geometry.get(pipe)
  const wall = heatingCurveWallConflict(grid, curve.pieces, { allowWalls: true, permittedWallCells })
  if (wall) problems.push({ circuit: pipe.heating.circuitId, reason: 'forbidden-wall', point: wall })
  const usedMarkers = new Set()
  for (const piece of curve.pieces) {
    const steps = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (grid.step / 2)))
    for (let i = 0; i <= steps; i++) {
      const p = { x: piece.a.x + (piece.b.x - piece.a.x) * i / steps, y: piece.a.y + (piece.b.y - piece.a.y) * i / steps }
      const cell = grid.index(p)
      if (cell < 0 || !grid.wall[cell] || grid.door[cell]) continue
      const match = markers.findIndex((marker) => Math.hypot(marker.x - p.x, marker.y - p.y) <= 200 * 8 / scale)
      if (match < 0) {
        problems.push({ circuit: pipe.heating.circuitId, reason: 'unmarked-wall-passage', point: p }); break
      }
      usedMarkers.add(match)
    }
  }
  if (pipe.heating.pipeRole !== 'loop') feedChecks.set(pipe, {
    role: pipe.heating.pipeRole,
    doorIds: openings.filter((opening) => crossesOpening(curve, opening)).map((opening) => opening.id),
    wallPassages: [...usedMarkers].map((index) => markers[index]),
  })
}
for (const pipe of feeds) {
  const points = geometry.get(pipe).points, p = pipe.heating.pipeRole === 'supply' ? points[0] : points.at(-1)
  const cell = grid.index(p)
  if (!sourceRoom || cell < 0 || grid.room[cell] !== sourceRoom || Math.hypot(p.x - source.x, p.y - source.y) > 1500 * 8 / scale + .01)
    problems.push({ circuit: pipe.heating.circuitId, reason: 'source-end-outside-source-room', point: p })
}
for (const row of rows) {
  const roles = pipes.filter((pipe) => pipe.heating.circuitId === row.id).map((pipe) => pipe.heating.pipeRole).sort()
  if (JSON.stringify(roles) !== JSON.stringify(['loop', 'return', 'supply'])) problems.push({ circuit: row.id, reason: 'incomplete-circuit', roles })
}
const result = { sourceSha256: createHash('sha256').update(bytes).digest('hex'), circuits: rows.length,
  pipeDiametersMm: [...new Set(pipes.map((pipe) => pipe.heating.diameterMm))],
  nominalSpacingsMm: [...new Set(pipes.map((pipe) => pipe.heating.spacingMm))],
  designWallSetbackMm: settings.edgeMm,
  loopWallClearanceMm: Object.fromEntries(pipes.filter((pipe) => pipe.heating.pipeRole === 'loop')
    .map((pipe) => [pipe.heating.circuitId, wallClearanceMm(pipe)])),
  minimumBendRadiusMm: Math.min(...[...geometry.values()].flatMap((curve) => curve.bends.map((bend) => bend.radiusMm))),
  originalShapes: scene.length, originalDrawingProblems,
  strictTubeClearance, geometryErrors: errors.length, geometryIssues: errors, nativeSceneProblems: problems, wallPassages: markers.length,
  sourceEnds: feeds.length, maximumDrawnCircuitM: Math.max(...rows.map((row) => row.totalM)),
  maximumCuttingLengthM: Math.max(...rows.map((row) => row.cutM ?? row.totalM)),
  circuitChecks: rows.map((row) => ({
    id: row.id, room: row.room, loopM: row.loopM, supplyM: row.supplyM, returnM: row.returnM, cutM: row.cutM ?? row.totalM,
    connections: feeds.filter((pipe) => pipe.heating.circuitId === row.id).map((pipe) => feedChecks.get(pipe)),
  })),
  cuttingReserveM: settings.design?.allowanceM ?? 0, designReviews: owner.heating.audit?.issues.filter((issue) => issue.severity === 'review') ?? [] }
result.coverage = { evaluationEdgeMm: evaluationEdge, rooms: coverage.rooms, gapM2: coverage.rooms.reduce((sum, room) => sum + room.gapM2, 0),
  eligibleM2: coverage.rooms.reduce((sum, room) => sum + room.eligibleM2, 0), roomsRequiringReview: coverageProblems.map((room) => room.key) }
console.log(JSON.stringify(result, null, 2))
if (originalDrawingProblems.length || errors.length || problems.length || flags.has('--require-coverage') && coverageProblems.length) process.exitCode = 1
