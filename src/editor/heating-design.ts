export type HeatingDesignInputs = {
  product?: string
  minBendRadiusMm?: number
  maxCircuitLengthM?: number
  allowanceM?: number
  deltaTK?: number
  roomHeatLoadsW?: Record<string, number>
  pipeWallMm?: number
  roughnessMm?: number
  fluidTemperatureC?: number
  localLossK?: number
  downwardDesignWm2?: number
  maxVelocityMs?: number
  manifoldKv?: number
  availablePressureKpa?: number
  coveringThicknessMm?: number
  coveringLambda?: number
  screedCoverMm?: number
  screedLambda?: number
  insulationThicknessMm?: number
  insulationLambda?: number
  minimumInsulationR?: number
  supplyTemperatureC?: number
  roomTemperatureC?: number
  surfaceLimitC?: number
  belowTemperatureC?: number
  systemOutputWm2?: number
  systemReference?: string
  systemOutputBasis?: string
}

export const sanitizeHeatingDesign = (value: unknown): HeatingDesignInputs | undefined => {
  if (!value || typeof value !== 'object') return
  const raw = value as Record<string, unknown>, result: HeatingDesignInputs = {}
  if (typeof raw.product === 'string' && raw.product.trim()) result.product = raw.product.trim().slice(0, 160)
  for (const key of ['systemReference', 'systemOutputBasis'] as const) if (typeof raw[key] === 'string' && raw[key].trim()) result[key] = raw[key].trim().slice(0, key === 'systemReference' ? 160 : 2000)
  for (const [key, min, max] of [['pipeWallMm', .1, 15], ['roughnessMm', 0, 1], ['fluidTemperatureC', 10, 80], ['localLossK', 0, 1000], ['downwardDesignWm2', 0, 1000], ['maxVelocityMs', .05, 3], ['manifoldKv', .01, 20], ['availablePressureKpa', .1, 300],
    ['coveringThicknessMm', 0, 200], ['coveringLambda', .01, 10], ['screedCoverMm', 0, 300], ['screedLambda', .01, 10], ['insulationThicknessMm', 0, 500], ['insulationLambda', .01, 1], ['minimumInsulationR', 0, 20],
    ['supplyTemperatureC', 10, 80], ['roomTemperatureC', 5, 35], ['surfaceLimitC', 10, 40], ['belowTemperatureC', -30, 35], ['systemOutputWm2', 0, 300], ['minBendRadiusMm', 10, 1000], ['maxCircuitLengthM', 20, 300], ['allowanceM', 0, 30], ['deltaTK', 1, 20]] as const) {
    const number = raw[key]
    if (typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max) result[key] = number
  }
  if (raw.roomHeatLoadsW && typeof raw.roomHeatLoadsW === 'object') {
    result.roomHeatLoadsW = Object.fromEntries(Object.entries(raw.roomHeatLoadsW).filter(([name, watts]) =>
      name.trim() && typeof watts === 'number' && Number.isFinite(watts) && watts >= 0 && watts <= 100_000).slice(0, 100))
  }
  return Object.keys(result).length ? result : undefined
}

/** Defaults are visible planning assumptions; product limits must come from the selected pipe. */
export const heatingDesignLimits = (diameterMm: number, design?: HeatingDesignInputs) => ({
  minBendRadiusMm: design?.minBendRadiusMm ?? diameterMm * 5,
  maxCircuitLengthM: design?.maxCircuitLengthM ?? 100,
  allowanceM: design?.allowanceM ?? 0,
  deltaTK: design?.deltaTK ?? 5
})


/** A manufacturer's declared output is valid only for the geometry and construction entered with it. */
export const heatingOutputBasis = (diameterMm: number, spacingMm: number, design?: HeatingDesignInputs): string => JSON.stringify([
  diameterMm, spacingMm, design?.pipeWallMm ?? null, design?.product ?? '', design?.systemReference ?? '', design?.supplyTemperatureC ?? 35, design?.deltaTK ?? 5, design?.roomTemperatureC ?? 20,
  design?.coveringThicknessMm ?? null, design?.coveringLambda ?? null, design?.screedCoverMm ?? null, design?.screedLambda ?? null,
  design?.insulationThicknessMm ?? null, design?.insulationLambda ?? null, design?.surfaceLimitC ?? 29
])
