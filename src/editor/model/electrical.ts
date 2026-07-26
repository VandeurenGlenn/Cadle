export type ElectricalRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'
export type ElectricalCircuitType = 'lighting' | 'sockets' | 'motor' | 'mixed' | 'other'
export type ElectricalPhaseConfiguration =
  | 'single-phase'
  | 'three-phase'
  | 'L1+N'
  | 'L2+N'
  | 'L3+N'
  | 'L1+L2+L3+N'

export type ElectricalDeviceMetadata = {
  role: ElectricalRole
  oneWireEligible: boolean
  circuitType?: ElectricalCircuitType
  ratedCurrentA?: number
  breakerCurrentA?: number
  poles?: number
  phaseConfiguration?: ElectricalPhaseConfiguration
  cableSectionMm2?: number
  breakerCurve?: 'B' | 'C' | 'D' | 'other'
  rcdSensitivityMa?: number
  rcdType?: 'AC' | 'A' | 'F' | 'B' | 'other'
  boardId?: string
  railId?: string
  notes?: string
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
    typeof explicit.phaseConfiguration === 'string' &&
    ['single-phase', 'three-phase', 'L1+N', 'L2+N', 'L3+N', 'L1+L2+L3+N'].includes(explicit.phaseConfiguration)
      ? explicit.phaseConfiguration as ElectricalPhaseConfiguration
      : undefined

  return {
    role,
    circuitType,
    oneWireEligible: explicit.oneWireEligible !== false && (role !== 'neutral' || explicit.oneWireEligible === true),
    ratedCurrentA: finitePositive(explicit.ratedCurrentA),
    breakerCurrentA: finitePositive(explicit.breakerCurrentA),
    poles: finitePositive(explicit.poles),
    phaseConfiguration,
    cableSectionMm2: finitePositive(explicit.cableSectionMm2),
    breakerCurve:
      explicit.breakerCurve === 'B' || explicit.breakerCurve === 'C' || explicit.breakerCurve === 'D' || explicit.breakerCurve === 'other'
        ? explicit.breakerCurve
        : undefined,
    rcdSensitivityMa: finitePositive(explicit.rcdSensitivityMa),
    rcdType:
      explicit.rcdType === 'AC' || explicit.rcdType === 'A' || explicit.rcdType === 'F' || explicit.rcdType === 'B' || explicit.rcdType === 'other'
        ? explicit.rcdType
        : undefined,
    boardId: typeof explicit.boardId === 'string' ? explicit.boardId.trim() || undefined : undefined,
    railId: typeof explicit.railId === 'string' ? explicit.railId.trim() || undefined : undefined,
    notes: typeof explicit.notes === 'string' ? explicit.notes.trim() || undefined : undefined
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
    breakerCurrentA: finitePositive(raw.breakerCurrentA),
    poles: finitePositive(raw.poles),
    phaseConfiguration:
      typeof raw.phaseConfiguration === 'string' &&
      ['single-phase', 'three-phase', 'L1+N', 'L2+N', 'L3+N', 'L1+L2+L3+N'].includes(raw.phaseConfiguration)
        ? raw.phaseConfiguration as ElectricalPhaseConfiguration
        : undefined,
    cableSectionMm2: finitePositive(raw.cableSectionMm2),
    breakerCurve: raw.breakerCurve === 'B' || raw.breakerCurve === 'C' || raw.breakerCurve === 'D' || raw.breakerCurve === 'other' ? raw.breakerCurve : undefined,
    rcdSensitivityMa: finitePositive(raw.rcdSensitivityMa),
    rcdType: raw.rcdType === 'AC' || raw.rcdType === 'A' || raw.rcdType === 'F' || raw.rcdType === 'B' || raw.rcdType === 'other' ? raw.rcdType : undefined,
    boardId: typeof raw.boardId === 'string' ? raw.boardId.trim() || undefined : undefined,
    railId: typeof raw.railId === 'string' ? raw.railId.trim() || undefined : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() || undefined : undefined
  }
}
