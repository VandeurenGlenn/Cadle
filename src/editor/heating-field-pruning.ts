import type { HeatingGrid } from './heating-routing.js'
import type { HeatingSpiralField } from './heating-spiral.js'
import { openHeatingTurns } from './heating-spiral.js'
import { simplifyHeatingPath } from './heating-routing.js'
import { createHeatingPipe, heatingDefaults } from './heating-plan.js'
import { measureHeatingCoverage, heatingWallDistances } from './heating-coverage.js'
import { drawingUnitsForMetres, type DrawingScale } from './layout/drawing-scale.js'
import { heatingDesignLimits, type HeatingDesignInputs } from './heating-design.js'

/** Joining native rooms opens door thresholds for connections. A tiny laying
 * field on that threshold is not an extra heated room. Remove it only when an
 * independent measurement proves that no eligible floor cell loses coverage. */
export const pruneRedundantHeatingFields = (grid: HeatingGrid, fields: HeatingSpiralField[], settings: {
  diameterMm: number; spacingMm: number; edgeMm?: number; design?: HeatingDesignInputs
}, scale: DrawingScale, checkpoint: () => void) => {
  if (fields.length < 2) return
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const pipes = fields.map((field, i) => createHeatingPipe(`field-prune-${i}`, openHeatingTurns(field.points ?? simplifyHeatingPath(field.cells.map(grid.point)), radius,
    drawingUnitsForMetres(settings.diameterMm / 1000, scale)), { ...heatingDefaults('pipe', scale), ...settings, automatic: true, pipeRole: 'loop', circuitId: `field-${i}` }))
  let baseline = measureHeatingCoverage(grid, pipes, scale, settings.spacingMm, settings.edgeMm, checkpoint, false)
  for (let i = fields.length - 1; i >= 0; i--) {
    checkpoint()
    // Owning the nearest cells does not prove a short field is necessary: a
    // neighbouring tube can cover those same cells within the laying radius.
    if ((baseline.areaByCircuit.get(pipes[i].heating!.circuitId!) ?? 0) > .5) continue
    const remaining = pipes.filter((_, index) => index !== i)
    const measured = measureHeatingCoverage(grid, remaining, scale, settings.spacingMm, settings.edgeMm, checkpoint, false)
    if (measured.coverage.rooms.some((room, index) => room.gapM2 > baseline.coverage.rooms[index].gapM2 + 1e-9)) continue
    fields.splice(i, 1); pipes.splice(i, 1); baseline = measured
  }
}


/** Defer tiny boundary remnants beside a planned feed bundle. They are not
 * additional circuits: the actual supply/return geometry is measured against
 * the unchanged native floor after routing, including these strips. */
export const deferHeatingFeedRemnants = (grid: HeatingGrid, fields: HeatingSpiralField[], spacingMm: number,
  scale: DrawingScale, checkpoint: () => void) => {
  if (!grid.feedReservation) return
  const distance = heatingWallDistances({ ...grid, wall: grid.feedReservation })
  const pitch = drawingUnitsForMetres(spacingMm / 1000, scale) / grid.step
  for (let i = fields.length - 1; i >= 0; i--) {
    checkpoint()
    const field = fields[i]
    if (field.cells.length * grid.step > drawingUnitsForMetres(4, scale) || field.areaM2 > .5) continue
    if (field.cells.every((cell) => distance[cell] * grid.step <= drawingUnitsForMetres(1, scale)) &&
      field.cells.some((cell) => distance[cell] <= pitch)) fields.splice(i, 1)
  }
}
