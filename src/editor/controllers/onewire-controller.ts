import type { Shape } from '../../editor/model/types.js'
import type { ElectricalProjectProfile } from '../../types.js'
import { analyzeCircuits } from '../circuit-analysis.js'
import { planOneWireLayout, type OneWireFamilyDemand } from '../layout/onewire-layout-plan.js'
import { reconcileGeneratedOneWire } from '../layout/onewire-regeneration.js'

export class OneWireController {
  analyze(shapes: readonly Shape[], profile?: ElectricalProjectProfile) {
    return analyzeCircuits(shapes, profile)
  }

  plan(families: readonly OneWireFamilyDemand[], usableWidth: number, usableHeight: number) {
    return planOneWireLayout(families, { usableWidth, usableHeight })
  }

  reconcile(previous: readonly Shape[], fresh: readonly Shape[]) {
    return reconcileGeneratedOneWire(previous, fresh)
  }
}
