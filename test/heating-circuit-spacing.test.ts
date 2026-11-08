import test from 'node:test'
import assert from 'node:assert/strict'
import { generateAutomaticHeatingPlan } from '../src/editor/automatic-heating-plan.ts'
import { sanitizeHeating, heatingDefaults } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import type { Shape, RectShape } from '../src/editor/model/types.ts'

const area = { x: 80, y: 80, width: 2216, height: 1384 }
test('per-circuit spacing is bounded and survives saving', () => {
  const data = sanitizeHeating({ ...heatingDefaults('manifold'), circuitSpacingMm: { VV01: 150, VV02: 125, VV24: 200, VV25: 100, VV03: Infinity, VV04: 0, bad: 100 } })!
  assert.deepEqual(data.circuitSpacingMm, { VV01: 150, VV02: 125, VV24: 200 })
  assert.deepEqual(sanitizeHeating(JSON.parse(JSON.stringify(data)))!.circuitSpacingMm, data.circuitSpacingMm)
})
test('changing one circuit from 100 to 150 changes its actual geometry and retains all other paths', () => {
  const shapes: Shape[] = []
  for (const x of [400, 680]) {
    const p = [{ x, y: 400 }, { x: x + 240, y: 400 }, { x: x + 240, y: 640 }, { x, y: 640 }]
    shapes.push(...p.map((start, i): Shape => ({ id: `w${x}-${i}`, kind: 'wall', start, end: p[(i + 1) % 4] })), { id: `door-${x}`, kind: 'door', start: { x: x + 80, y: 400 }, end: { x: x + 160, y: 400 } })
  }
  let id = 0
  const point = { x: 180, y: 280 }, settings = { diameterMm: 16, spacingMm: 100, capacity: 12 }
  const original = generateAutomaticHeatingPlan(shapes, point, settings, 100, () => `base-${id++}`, area)
  const owner = original.shapes.find((s) => s.heating?.kind === 'manifold')!, selected = original.rows[0].id
  const reflowCircuit = original.shapes.filter((s) => s.heating?.kind === 'pipe' && s.heating.circuitId === selected)
  const preserved = original.shapes.filter((s) => s.heating?.kind === 'pipe' && s.heating.circuitId !== selected)
  assert.ok(preserved.length)
  const geometry = (pipes: RectShape[]) => pipes.map((p) => JSON.stringify([p.id, p.start, p.end, p.heating!.points]))
  const before = geometry(preserved), newSettings = { ...settings, circuitSpacingMm: { [selected]: 150 } }
  const result = generateAutomaticHeatingPlan(shapes, point, newSettings, 100, () => `changed-${id++}`, area, 0, 0, { routes: 600, preserved, existingManifold: owner, reflowCircuit })
  assert.equal(result.rows.length, original.rows.length)
  assert.equal(result.rows.find((r) => r.id === selected)!.spacingMm, 150)
  assert.ok(result.rows.find((r) => r.id === selected)!.loopM < original.rows.find((r) => r.id === selected)!.loopM)
  assert.deepEqual(geometry(result.shapes.filter((s) => s.heating?.kind === 'pipe' && s.heating.circuitId !== selected)), before)
  assert.equal(result.shapes[0].heating!.spacingMm, 100)
  assert.equal(result.shapes[0].heating!.circuitSpacingMm![selected], 150)
  assert.equal(result.shapes[0].heating!.audit!.errors, 0)
  assert.ok(result.shapes.filter((s) => s.heating?.kind === 'pipe').every((p) => heatingPipeGeometry(p).bends.every((b) => b.radiusMm >= 79.9)))
})
