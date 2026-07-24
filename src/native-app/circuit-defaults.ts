import type { ElectricalCircuitType } from '../native-draw/electrical.js'

export type CircuitDefaults = {
  breakerCurrentA: number
  cableSectionMm2: number
  poles: number
  phaseConfiguration: 'single-phase'
  breakerCurve: 'C'
  boardId: 'main'
  railId: 'rail-1'
}

export const circuitDefaults = (circuitType?: ElectricalCircuitType | string): CircuitDefaults => {
  const higherLoad = circuitType === 'sockets' || circuitType === 'motor' || circuitType === 'mixed'
  return {
    breakerCurrentA: higherLoad ? 20 : 16,
    cableSectionMm2: higherLoad ? 2.5 : 1.5,
    poles: 2,
    phaseConfiguration: 'single-phase',
    breakerCurve: 'C',
    boardId: 'main',
    railId: 'rail-1'
  }
}
