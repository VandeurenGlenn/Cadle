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
import { heatingObstacleBounds } from '../src/editor/heating-openings.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { measureHeatingCoverage, heatingRoomKey } from '../src/editor/heating-coverage.ts'

if (process.argv.length < 4 || process.argv.length > 5 || process.argv.length === 5 && process.argv[4] !== '--require-coverage')
  throw new Error('Use original.json generated.json [--require-coverage]')
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
const audit = checkHeatingPlan(pipes, [], settings.design, obstacles)
const scheduleAudit = checkHeatingPlan([...pipes, owner], rows, settings.design, obstacles)
const errors = [...audit.issues, ...scheduleAudit.issues].filter((issue, i, all) => issue.severity === 'error' &&
  all.findIndex((other) => JSON.stringify(other) === JSON.stringify(issue)) === i)
const permittedWallCells = heatingInternalWallCells(grid, scale)
const markers = shapes.filter((shape) => shape.generationKey?.startsWith('heating-penetration:')).map((shape) => ({
  x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 }))
const feeds = pipes.filter((pipe) => pipe.heating.pipeRole !== 'loop')
// Recompute coverage from the original architecture and actual rounded tubes.
// Saved owner metadata must not hide an omitted room or retain stale coverage
// after a loop has been improved without changing its feeds.
const coverageGrid = { ...grid, rooms: grid.rooms.filter((room) =>
  !settings.excludedRoomKeys?.includes(heatingRoomKey(room)) && (settings.heatSourceRoom !== false || room.id !== sourceRoom)) }
const coverage = measureHeatingCoverage(coverageGrid, pipes, scale, settings.spacingMm, settings.edgeMm ?? 100, () => {}, false).coverage
const coverageProblems = coverage.rooms.filter((room) => room.gapM2 > Math.max(.05, room.eligibleM2 * .02))
for (const pipe of pipes) {
  const curve = geometry.get(pipe)
  const wall = heatingCurveWallConflict(grid, curve.pieces, { allowWalls: true, permittedWallCells })
  if (wall) problems.push({ circuit: pipe.heating.circuitId, reason: 'forbidden-wall', point: wall })
  for (const piece of curve.pieces) {
    const steps = Math.max(1, Math.ceil(Math.hypot(piece.b.x - piece.a.x, piece.b.y - piece.a.y) / (grid.step / 2)))
    for (let i = 0; i <= steps; i++) {
      const p = { x: piece.a.x + (piece.b.x - piece.a.x) * i / steps, y: piece.a.y + (piece.b.y - piece.a.y) * i / steps }
      const cell = grid.index(p)
      if (cell >= 0 && grid.wall[cell] && !grid.door[cell] &&
        !markers.some((marker) => Math.hypot(marker.x - p.x, marker.y - p.y) <= 200 * 8 / scale)) {
        problems.push({ circuit: pipe.heating.circuitId, reason: 'unmarked-wall-passage', point: p }); break
      }
    }
  }
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
  minimumBendRadiusMm: Math.min(...[...geometry.values()].flatMap((curve) => curve.bends.map((bend) => bend.radiusMm))),
  originalShapes: scene.length, originalDrawingProblems,
  geometryErrors: errors.length, geometryIssues: errors, nativeSceneProblems: problems, wallPassages: markers.length,
  sourceEnds: feeds.length, maximumDrawnCircuitM: Math.max(...rows.map((row) => row.totalM)),
  maximumCuttingLengthM: Math.max(...rows.map((row) => row.cutM ?? row.totalM)),
  cuttingReserveM: settings.design?.allowanceM ?? 0, designReviews: owner.heating.audit?.issues.filter((issue) => issue.severity === 'review') ?? [] }
result.coverage = { rooms: coverage.rooms, gapM2: coverage.rooms.reduce((sum, room) => sum + room.gapM2, 0),
  eligibleM2: coverage.rooms.reduce((sum, room) => sum + room.eligibleM2, 0), roomsRequiringReview: coverageProblems.map((room) => room.key) }
console.log(JSON.stringify(result, null, 2))
if (originalDrawingProblems.length || errors.length || problems.length || process.argv.includes('--require-coverage') && coverageProblems.length) process.exitCode = 1
