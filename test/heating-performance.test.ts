import assert from 'node:assert/strict'
import test from 'node:test'
import { heatingHydraulics, heatingFloor, heatingWater } from '../src/editor/heating-performance.ts'
import { heatingOutputBasis, sanitizeHeatingDesign } from '../src/editor/heating-design.ts'
import { createHeatingPipe, heatingDefaults, heatingSchedule, heatingScheduleCSV, presentHeatingTables } from '../src/editor/heating-plan.ts'
import { sanitizeShapes } from '../src/editor/model/model.ts'
import type { RectShape } from '../src/editor/model/types.ts'

const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`)

test('matches Hagen–Poiseuille for laminar flow and uses the Darcy rather than Fanning factor', () => {
  const h = heatingHydraulics(16, 80, .1, { pipeWallMm: 2, fluidTemperatureC: 35 })!
  const mu = .7191 / 1000, q = .1 / 60000, expectedPa = 128 * mu * 80 * q / (Math.PI * .012 ** 4)
  close(h.pipeKpa, expectedPa / 1000)
  close(h.frictionFactor, 64 / h.reynolds)
  close(heatingHydraulics(16, 80, .2, { pipeWallMm: 2, fluidTemperatureC: 35 })!.pipeKpa, h.pipeKpa * 2)
  assert.equal(h.complete, false)
  assert.equal(h.transition, false)
})

test('solves turbulent Colebrook, includes local and full manifold losses, and flags transition', () => {
  const design = { pipeWallMm: 2, fluidTemperatureC: 35, roughnessMm: .007, localLossK: 10, manifoldKv: .5 }
  const h = heatingHydraulics(16, 90, 4, design)!
  assert.ok(h.reynolds > 4000)
  const residual = 1 / Math.sqrt(h.frictionFactor) + 2 * Math.log10(.000007 / (3.7 * .012) + 2.51 / (h.reynolds * Math.sqrt(h.frictionFactor)))
  close(residual, 0, 1e-8)
  close(h.manifoldKpa!, (.24 / .5) ** 2 * 100 * .994)
  close(h.totalKpa, h.pipeKpa + h.localKpa + h.manifoldKpa!)
  assert.equal(h.complete, true)
  assert.ok(heatingHydraulics(16, 90, 4, { ...design, pipeWallMm: 3 })!.pipeKpa > h.pipeKpa)
  assert.ok(heatingHydraulics(16, 90, 4, { ...design, fluidTemperatureC: 20 })!.pipeKpa > h.pipeKpa)
  assert.equal(heatingHydraulics(16, 90, 1.3, design)!.transition, true)
  assert.equal(heatingHydraulics(16, 90, 1, { pipeWallMm: 8 }), undefined)
  assert.equal(heatingHydraulics(16, 90, 1), undefined)
  assert.equal(heatingWater(9), undefined)
  close(heatingWater(35)!.densityKgM3, 994)
})

test('calculates floor resistances and surface demand while bounding, not certifying, system capacity', () => {
  const design = { coveringThicknessMm: 10, coveringLambda: .2, screedCoverMm: 45, screedLambda: 1.4,
    insulationThicknessMm: 60, insulationLambda: .035, supplyTemperatureC: 35, deltaTK: 5, roomTemperatureC: 20, belowTemperatureC: 10 }
  const floor = heatingFloor(10, 500, 16, 150, design)
  close(floor.coveringR!, .05)
  close(floor.screedR!, .045 / 1.4)
  close(floor.insulationR!, .06 / .035)
  assert.ok(floor.requiredSurfaceC! > 24 && floor.requiredSurfaceC! < 26)
  assert.ok(floor.upperBoundWm2! > 50 && floor.upperBoundWm2! < 120)
  assert.ok(floor.minimumPlaneC! > floor.requiredSurfaceC!)
  assert.ok(heatingFloor(10, 500, 16, 150, { ...design, coveringThicknessMm: 40 }).upperBoundWm2! < floor.upperBoundWm2!)
  assert.ok(heatingFloor(10, 500, 16, 150, { ...design, surfaceLimitC: 22 }).upperBoundWm2! < 25)
  close(floor.downwardUpperWm2!, (32.5 - 10) / (.06 / .035))
  assert.equal(heatingFloor(10, 500, 16, 150).upperBoundWm2, undefined)
  assert.equal(floor.systemOutputWm2, undefined)
})

test('invalidates manufacturer output when its reference or relevant design conditions change', () => {
  const design = { product: '16×2', pipeWallMm: 2, systemReference: 'Fabrikant tabel A', systemOutputWm2: 70, coveringThicknessMm: 10, coveringLambda: .2 }
  const confirmed = { ...design, systemOutputBasis: heatingOutputBasis(16, 150, design) }
  assert.equal(heatingFloor(10, 500, 16, 150, confirmed).systemOutputWm2, 70)
  for (const changed of [{ ...confirmed, deltaTK: 7 }, { ...confirmed, coveringThicknessMm: 20 }, { ...confirmed, systemReference: 'Andere tabel' }]) {
    const floor = heatingFloor(10, 500, 16, 150, changed)
    assert.equal(floor.systemOutputWm2, undefined)
    assert.equal(floor.outputStale, true)
  }
  assert.equal(heatingFloor(10, 500, 16, 200, confirmed).outputStale, true)
})

test('balances parallel circuits against the critical circuit and persists results for tables and CSV', () => {
  const design = { pipeWallMm: 2, fluidTemperatureC: 35, roughnessMm: .007, localLossK: 10, manifoldKv: .5,
    availablePressureKpa: 15, roomHeatLoadsW: { Living: 500 }, deltaTK: 5, allowanceM: 3, downwardDesignWm2: 20 }
  const manifold: RectShape = { id: 'm', kind: 'rect', start: { x: 0, y: 200 }, end: { x: 120, y: 264 }, heating: { ...heatingDefaults('manifold'), automatic: true, design } }
  const pipes = [30, 60].map((m, i) => createHeatingPipe(`pipe-${i}`, [{ x: 0, y: 100 * i }, { x: m * 80, y: 100 * i }],
    { ...heatingDefaults('pipe'), circuitId: `VV0${i + 1}`, roomName: 'Living', pipeRole: 'loop', servedAreaM2: 5 }))
  const rows = heatingSchedule([manifold, ...pipes]), [a, b] = rows.map((r) => r.hydraulics!)
  assert.ok(b.totalKpa > a.totalKpa)
  close(a.balanceKpa!, 15 - a.totalKpa)
  close(b.balanceKpa!, 15 - b.totalKpa)
  close(a.totalKpa + a.balanceKpa!, 15)
  close(b.totalKpa + b.balanceKpa!, 15)
  const minimumHead = heatingSchedule([{ ...manifold, heating: { ...manifold.heating!, design: { ...design, availablePressureKpa: undefined } } }, ...pipes])
  close(minimumHead[0].hydraulics!.balanceKpa!, b.totalKpa - a.totalKpa)
  close(minimumHead[1].hydraulics!.balanceKpa!, 0)
  close(a.pumpMarginKpa!, 15 - b.totalKpa)
  assert.ok(a.targetKv! > 0)
  const withoutDownward = heatingSchedule([{ ...manifold, heating: { ...manifold.heating!, design: { ...design, downwardDesignWm2: 0 } } }, ...pipes])
  close(rows[0].flowLmin / withoutDownward[0].flowLmin, 1.4)
  const table: RectShape = { id: 't', kind: 'rect', start: { x: 0, y: 0 }, end: { x: 1320, y: 700 }, heating: { ...heatingDefaults('table'), rows } }
  const restored = sanitizeShapes(JSON.parse(JSON.stringify([table])))[0]
  close(restored.heating!.rows![0].hydraulics!.totalKpa, a.totalKpa)
  assert.ok(heatingScheduleCSV(rows).includes('Extra smoordruk kPa'))
  const live = presentHeatingTables([{ ...manifold, heating: { ...manifold.heating!, design: { ...design, availablePressureKpa: .1 } } }, ...pipes])
  assert.ok(live[0].heating!.audit!.issues.some((i) => i.code === 'pump-head' && i.severity === 'error'))
  assert.equal(sanitizeHeatingDesign({ pipeWallMm: -1, belowTemperatureC: -10 })!.belowTemperatureC, -10)
})
