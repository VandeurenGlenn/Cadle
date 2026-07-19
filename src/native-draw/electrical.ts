export type ElectricalRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'
export type ElectricalCircuitType = 'lighting' | 'sockets' | 'motor' | 'mixed' | 'other'
export type ElectricalPhaseConfiguration = 'single-phase' | 'three-phase'

export type ElectricalDeviceMetadata = {
  role: ElectricalRole
  oneWireEligible: boolean
  circuitType?: ElectricalCircuitType
  ratedCurrentA?: number
  poles?: number
  phaseConfiguration?: ElectricalPhaseConfiguration
  cableSectionMm2?: number
}

const finitePositive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

export const inferElectricalRole = (name: string, path: string): ElectricalRole => {
  const searchable = `${name} ${path}`.toLowerCase()
  if (/protection|automaat|breaker|fuse|differential|rcd/.test(searchable)) return 'protection'
  if (/switch|schakel|drukknop|push.?button|contactor|relais|relay/.test(searchable)) return 'switch'
  if (/junction|lasdoos|connection box/.test(searchable)) return 'junction'
  if (/socket|outlet|stopcontact|consumption|lighting|lamp|light|motor|heater|boiler|load/.test(searchable)) {
    return 'load'
  }
  return 'neutral'
}

export const inferCircuitType = (name: string, path: string): ElectricalCircuitType => {
  const searchable = `${name} ${path}`.toLowerCase()
  if (/socket|outlet|stopcontact/.test(searchable)) return 'sockets'
  if (/motor/.test(searchable)) return 'motor'
  if (/lighting|lamp|light|spot/.test(searchable)) return 'lighting'
  return 'other'
}

export const electricalMetadataFromCatalog = (
  metadata: Record<string, unknown> | undefined,
  name: string,
  path: string
): ElectricalDeviceMetadata => {
  const explicit =
    metadata?.electrical && typeof metadata.electrical === 'object'
      ? (metadata.electrical as Record<string, unknown>)
      : metadata ?? {}
  const candidateRole = explicit.role ?? explicit.bindingRole
  const role: ElectricalRole =
    candidateRole === 'switch' ||
    candidateRole === 'load' ||
    candidateRole === 'protection' ||
    candidateRole === 'junction' ||
    candidateRole === 'neutral'
      ? candidateRole
      : inferElectricalRole(name, path)
  const candidateType = explicit.circuitType
  const circuitType: ElectricalCircuitType =
    candidateType === 'lighting' ||
    candidateType === 'sockets' ||
    candidateType === 'motor' ||
    candidateType === 'mixed' ||
    candidateType === 'other'
      ? candidateType
      : inferCircuitType(name, path)
  const phaseConfiguration =
    explicit.phaseConfiguration === 'three-phase' ? 'three-phase' : explicit.phaseConfiguration === 'single-phase' ? 'single-phase' : undefined

  return {
    role,
    circuitType,
    oneWireEligible: explicit.oneWireEligible !== false && (role !== 'neutral' || explicit.oneWireEligible === true),
    ratedCurrentA: finitePositive(explicit.ratedCurrentA),
    poles: finitePositive(explicit.poles),
    phaseConfiguration,
    cableSectionMm2: finitePositive(explicit.cableSectionMm2)
  }
}

export const sanitizeElectricalMetadata = (value: unknown): ElectricalDeviceMetadata | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const role = raw.role
  if (role !== 'switch' && role !== 'load' && role !== 'protection' && role !== 'junction' && role !== 'neutral') {
    return undefined
  }
  const circuitType = raw.circuitType
  return {
    role,
    oneWireEligible: raw.oneWireEligible !== false,
    circuitType:
      circuitType === 'lighting' ||
      circuitType === 'sockets' ||
      circuitType === 'motor' ||
      circuitType === 'mixed' ||
      circuitType === 'other'
        ? circuitType
        : undefined,
    ratedCurrentA: finitePositive(raw.ratedCurrentA),
    poles: finitePositive(raw.poles),
    phaseConfiguration:
      raw.phaseConfiguration === 'single-phase' || raw.phaseConfiguration === 'three-phase'
        ? raw.phaseConfiguration
        : undefined,
    cableSectionMm2: finitePositive(raw.cableSectionMm2)
  }
}
