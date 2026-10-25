import type { Shape } from '../../editor/model/types.js'
import type { ElectricalProjectProfile, ProjectCircuitSpecification } from '../../types.js'
import { analyzeCircuits } from '../circuit-analysis.js'
import {
  appendOneWireFamilyOffset,
  normalizeOneWireFamilyKey,
  oneWireRailSpanForAnchors,
  ONE_WIRE_LAYOUT_VERSION,
  packOneWireFamilyBounds,
  planOneWireLayout,
  type OneWireFamilyBounds,
  type OneWireFamilyDemand
} from '../layout/onewire-layout-plan.js'
import {
  isOneWireRailShape,
  partitionOneWireRegenerationShapes,
  reconcileGeneratedOneWire
} from '../layout/onewire-regeneration.js'

export class OneWireController {
  readonly layoutVersion = ONE_WIRE_LAYOUT_VERSION

  analyze(
    shapes: readonly Shape[],
    profile?: ElectricalProjectProfile,
    circuitSpecifications?: Record<string, ProjectCircuitSpecification>
  ) {
    return analyzeCircuits(shapes, profile, circuitSpecifications)
  }

  plan(families: readonly OneWireFamilyDemand[], usableWidth: number, usableHeight: number) {
    return planOneWireLayout(families, { usableWidth, usableHeight })
  }

  packFamilies(families: readonly OneWireFamilyBounds[], centerX: number) {
    return packOneWireFamilyBounds(families, centerX)
  }

  appendFamilyOffset(newFamilyMinX: number, occupiedMaxX: number) {
    return appendOneWireFamilyOffset(newFamilyMinX, occupiedMaxX)
  }

  railSpanForAnchors(
    anchorXs: readonly number[],
    existingSpan?: { startX: number; endX: number },
    preserveExisting = false
  ) {
    return oneWireRailSpanForAnchors(anchorXs, existingSpan, preserveExisting)
  }

  familyKey(value: string | null) {
    return normalizeOneWireFamilyKey(value)
  }

  isRail(shape: Shape | null) {
    return isOneWireRailShape(shape)
  }

  partitionRegenerationShapes(shapes: readonly Shape[]) {
    return partitionOneWireRegenerationShapes(shapes)
  }

  reconcile(previous: readonly Shape[], fresh: readonly Shape[]) {
    return reconcileGeneratedOneWire(previous, fresh)
  }
}
