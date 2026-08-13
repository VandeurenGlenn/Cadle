import { circuitDefaults, defaultHasProtectiveConductor } from '../../../editor/circuit-defaults.js'
import {
  defaultManufacturerForDevice,
  neutralPositionForManufacturer
} from '../../../editor/model/electrical.js'
import type { SelectionShapeElectrical } from './selection-model.js'

const deviceRole = (value: string | undefined) =>
  value === 'protection' || value === 'switch' || value === 'load' || value === 'junction' || value === 'neutral'
    ? value
    : 'neutral'

const deviceCircuitType = (value: string | undefined) =>
  value === 'lighting' || value === 'sockets' || value === 'motor' || value === 'mixed' || value === 'other'
    ? value
    : undefined

export const effectiveSelectionElectrical = (
  source: SelectionShapeElectrical | null,
  symbolName: string,
  symbolPath: string
): SelectionShapeElectrical => {
  const electrical = source ?? {}
  const defaults = circuitDefaults(electrical.circuitType)
  const cableConductors = electrical.cableConductors ?? defaults.cableConductors
  const manufacturer = electrical.manufacturer
    ?? defaultManufacturerForDevice(
      deviceRole(electrical.role),
      deviceCircuitType(electrical.circuitType),
      symbolName,
      symbolPath
    )
  return {
    ...electrical,
    manufacturer,
    neutralPosition: electrical.neutralPosition ?? neutralPositionForManufacturer(manufacturer),
    breakerCurrentA: electrical.breakerCurrentA ?? defaults.breakerCurrentA,
    cableSectionMm2: electrical.cableSectionMm2 ?? defaults.cableSectionMm2,
    cableConductors,
    hasProtectiveConductor:
      electrical.hasProtectiveConductor ?? defaultHasProtectiveConductor(cableConductors),
    cableType: electrical.cableType ?? defaults.cableType,
    cableInstallation: electrical.cableInstallation ?? defaults.cableInstallation,
    showCableInstallation: electrical.showCableInstallation ?? true,
    poles: electrical.poles ?? defaults.poles,
    phaseConfiguration: electrical.phaseConfiguration ?? defaults.phaseConfiguration,
    showPhaseLabel: electrical.showPhaseLabel ?? true,
    breakerCurve: electrical.breakerCurve ?? defaults.breakerCurve,
    boardId: electrical.boardId ?? defaults.boardId,
    railId: electrical.railId ?? defaults.railId
  }
}
