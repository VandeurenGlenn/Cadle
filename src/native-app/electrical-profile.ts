import type { ElectricalProjectProfile } from '../types.js'

export const DEFAULT_AREI_PROFILE: ElectricalProjectProfile = {
  standard: 'AREI',
  edition: 'Book 1 (current edition)',
  supplyVoltageV: 230,
  phaseConfiguration: 'single-phase',
  earthingSystem: 'unknown',
  defaultPoles: 2
}

export const normalizeElectricalProfile = (
  profile: ElectricalProjectProfile | undefined
): ElectricalProjectProfile => ({
  standard: 'AREI',
  edition: profile?.edition?.trim() || DEFAULT_AREI_PROFILE.edition,
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
      : DEFAULT_AREI_PROFILE.defaultPoles
})
