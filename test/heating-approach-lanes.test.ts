import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shiftHeatingApproachLanes } from '../src/editor/heating-approach-lanes.ts'
import { createHeatingPipe } from '../src/editor/heating-pipe.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { checkHeatingPlan } from '../src/editor/heating-checks.ts'
import { buildHeatingGrid, heatingCurveWallConflict } from '../src/editor/heating-routing.ts'
import { heatingInternalWallCells } from '../src/editor/heating-wall-policy.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'

for (const shortLaunch of [false, true]) for (const occupiedHints of [false, true]) test(`a shared approach clears its source lanes (launch S ${shortLaunch}, lane hints ${occupiedHints})`, () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/heating-approach-lane-conflict.json', import.meta.url), 'utf8'))
  const scene = sanitizeShapes(fixture.scene), grid = buildHeatingGrid(scene, 100, 100, fixture.source,
    { pipeDiameterMm: 16, minBendRadiusMm: 80 }), walls = heatingInternalWallCells(grid, 100)
  const room = grid.room[grid.index(fixture.source)], obstacles = fixture.obstacles
  const make = (points, id, circuitId) => createHeatingPipe(id, points, {
    ...fixture.coils[0].heating, pipeRole: 'supply', circuitId })
  const fixed = [...fixture.coils, ...fixture.fixed.map((pipe, i) => make(pipe.points, `accepted-${i}`, pipe.circuitId))]
  const pair = (points) => points.map((p, i) => make(p, `candidate-${i}`, fixture.circuitId))
  const audit = (pipes) => checkHeatingPlan([...fixed, ...pipes], [], { maxCircuitLengthM: 120 }, obstacles)
  const original = fixture.pair.map((points, i) => {
    if (!shortLaunch) return structuredClone(points)
    const launch = fixture.sourceLaunch[i], dx = points[0].x - launch[2].x, dy = points[0].y - launch[0].y
    return [...launch.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })), ...structuredClone(points.slice(1))]
  })
  const untouched = structuredClone(original)
  assert.ok(audit(pair(original)).errors > 0)
  assert.ok(pair(original).every((pipe) => heatingPipeGeometry(pipe).bends.every((bend) => bend.radiusMm >= 79.9)))
  let evaluations = 0
  const shifted = shiftHeatingApproachLanes(original, 100, {
    occupied: occupiedHints ? fixture.fixed.map((pipe) => pipe.points) : undefined, separationMm: 20,
    checkpoint() {}, sourceEnd: (p) => grid.room[grid.index(p)] === room && Math.hypot(p.x - fixture.source.x, p.y - fixture.source.y) <= 120,
    valid(points) {
      evaluations++
      const candidates = pair(points)
      return candidates.every((pipe) => {
        const geometry = heatingPipeGeometry(pipe)
        return geometry.bends.every((bend) => bend.radiusMm >= 79.9) &&
          !heatingCurveWallConflict(grid, geometry.pieces, { allowWalls: true, permittedWallCells: walls })
      }) && !audit(candidates).errors
    }
  })
  assert.ok(shifted, 'two independent one-axis moves could not clear this source-door conflict')
  assert.equal(audit(pair(shifted)).errors, 0)
  assert.ok(evaluations <= (occupiedHints ? 1200 : 192))
  assert.deepEqual(original, untouched, 'candidate exploration leaves the prepared route untouched')
  assert.deepEqual(shifted.map((p) => p.at(-1)), original.map((p) => p.at(-1)), 'the coil joints remain fixed')
})
