import type { ElectricalProjectProfile } from '../types.js'

export const DEFAULT_AREI_PROFILE: ElectricalProjectProfile = {
  standard: 'AREI',
  edition: 'Book 1 (current edition)',
  distributor: '',
  supplyConfiguration: '1x230V+N',
  supplyVoltageV: 230,
  phaseConfiguration: 'single-phase',
  earthingSystem: 'unknown',
  defaultPoles: 2,
  boards: [{
    id: 'main',
    name: 'Main distribution board',
    rails: [{ id: 'rail-1', name: 'Rail 1' }]
  }]
}

export const normalizeElectricalProfile = (
  profile: ElectricalProjectProfile | undefined
): ElectricalProjectProfile => ({
  standard: 'AREI',
  edition: profile?.edition?.trim() || DEFAULT_AREI_PROFILE.edition,
  distributor: profile?.distributor?.trim() || '',
  supplyConfiguration:
    profile?.supplyConfiguration === '3x230V' ||
    profile?.supplyConfiguration === '3x400V+N' ||
    profile?.supplyConfiguration === 'other'
      ? profile.supplyConfiguration
      : '1x230V+N',
  supplyVoltageV:
    typeof profile?.supplyVoltageV === 'number' && profile.supplyVoltageV > 0
      ? profile.supplyVoltageV
      : DEFAULT_AREI_PROFILE.supplyVoltageV,
  phaseConfiguration:
    profile?.phaseConfiguration === 'three-phase' ? 'three-phase' : 'single-phase',
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
})
