import type { ElectricalProjectProfile } from '../types.js'

type SupplyConfiguration = ElectricalProjectProfile['supplyConfiguration']
type PhaseConfiguration = ElectricalProjectProfile['phaseConfiguration']

const isPhaseConfiguration = (value: unknown): value is PhaseConfiguration =>
  value === 'single-phase' ||
  value === 'three-phase' ||
  value === 'L1+N' ||
  value === 'L2+N' ||
  value === 'L3+N' ||
  value === 'L1+L2+L3+N'

export const phaseConfigurationForSupply = (
  supplyConfiguration: SupplyConfiguration,
  phaseConfiguration?: PhaseConfiguration
): PhaseConfiguration => {
  if (supplyConfiguration === '1x230V+N') {
    return phaseConfiguration === 'L2+N' || phaseConfiguration === 'L3+N' ? phaseConfiguration : 'L1+N'
  }
  if (supplyConfiguration === '3x230V') return 'three-phase'
  if (supplyConfiguration === '3x400V+N') return 'L1+L2+L3+N'
  return isPhaseConfiguration(phaseConfiguration) ? phaseConfiguration : DEFAULT_AREI_PROFILE.phaseConfiguration
}

export const DEFAULT_AREI_PROFILE: ElectricalProjectProfile = {
  standard: 'AREI',
  edition: 'Book 1 (current edition)',
  distributor: '',
  supplyConfiguration: '1x230V+N',
  supplyVoltageV: 230,
  phaseConfiguration: 'single-phase',
  earthingSystem: 'unknown',
  defaultPoles: 2,
  boards: [
    {
      id: 'main',
      name: 'Main distribution board',
      rails: [{ id: 'rail-1', name: 'Rail 1' }]
    }
  ]
}

export const normalizeElectricalProfile = (profile: ElectricalProjectProfile | undefined): ElectricalProjectProfile => {
  const supplyConfiguration: SupplyConfiguration =
    profile?.supplyConfiguration === '3x230V' ||
    profile?.supplyConfiguration === '3x400V+N' ||
    profile?.supplyConfiguration === 'other'
      ? profile.supplyConfiguration
      : '1x230V+N'
  return {
    standard: 'AREI',
    edition: profile?.edition?.trim() || DEFAULT_AREI_PROFILE.edition,
    distributor: profile?.distributor?.trim() || '',
    supplyConfiguration,
    supplyVoltageV:
      typeof profile?.supplyVoltageV === 'number' && profile.supplyVoltageV > 0
        ? profile.supplyVoltageV
        : DEFAULT_AREI_PROFILE.supplyVoltageV,
    phaseConfiguration: phaseConfigurationForSupply(supplyConfiguration, profile?.phaseConfiguration),
    earthingSystem:
      profile?.earthingSystem === 'TT' || profile?.earthingSystem === 'TN' || profile?.earthingSystem === 'IT'
        ? profile.earthingSystem
        : 'unknown',
    defaultPoles:
      typeof profile?.defaultPoles === 'number' && profile.defaultPoles > 0
        ? profile.defaultPoles
        : DEFAULT_AREI_PROFILE.defaultPoles,
    boards: profile?.boards?.length
      ? profile.boards.map((board) => ({
          ...board,
          rails: board.rails?.length ? board.rails.map((rail) => ({ ...rail })) : [{ id: 'rail-1', name: 'Rail 1' }],
          mainDifferential: board.mainDifferential ? { ...board.mainDifferential } : undefined,
          additionalDifferentials: board.additionalDifferentials?.map((item) => ({ ...item }))
        }))
      : DEFAULT_AREI_PROFILE.boards?.map((board) => ({ ...board, rails: board.rails.map((rail) => ({ ...rail })) }))
  }
}
