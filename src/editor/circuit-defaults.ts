import type { ElectricalCircuitType } from '../editor/model/electrical.js'

export type CircuitDefaults = {
  breakerCurrentA: number
  cableSectionMm2: number
  cableConductors: number
  hasProtectiveConductor: true
  cableType: 'VOB'
  cableInstallation: 'conduit-recessed'
  poles: number
  phaseConfiguration: 'single-phase'
  breakerCurve: 'C'
  boardId: 'main'
  railId: 'rail-1'
}

export const defaultHasProtectiveConductor = (cableConductors?: number): boolean =>
  cableConductors !== 4

export const circuitDefaults = (circuitType?: ElectricalCircuitType | string): CircuitDefaults => {
  const higherLoad = circuitType === 'sockets' || circuitType === 'motor' || circuitType === 'mixed'
  return {
    breakerCurrentA: higherLoad ? 20 : 16,
    cableSectionMm2: higherLoad ? 2.5 : 1.5,
    cableConductors: 3,
    hasProtectiveConductor: true,
    cableType: 'VOB',
    cableInstallation: 'conduit-recessed',
    poles: 2,
    phaseConfiguration: 'single-phase',
    breakerCurve: 'C',
    boardId: 'main',
    railId: 'rail-1'
  }
}
