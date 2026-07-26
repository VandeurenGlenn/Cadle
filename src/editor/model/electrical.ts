export type ElectricalRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'
export type ElectricalCircuitType = 'lighting' | 'sockets' | 'motor' | 'mixed' | 'other'
export type ElectricalPhaseConfiguration =
  | 'single-phase'
  | 'three-phase'
  | 'L1+N'
  | 'L2+N'
  | 'L3+N'
  | 'L1+L2+L3+N'
export type ElectricalCableType = 'VOB' | 'XVB' | 'XVB-Cca' | 'XGB' | 'XGB-Cca' | 'EXVB' | 'other'
export type ElectricalCableInstallation =
  | 'conduit'
  | 'conduit-recessed'
  | 'without-conduit'
  | 'on-wall'
  | 'recessed'
  | 'underground'

export type ElectricalDeviceMetadata = {
  role: ElectricalRole
  oneWireEligible: boolean
  circuitType?: ElectricalCircuitType
  ratedCurrentA?: number
  breakerCurrentA?: number
  poles?: number
  phaseConfiguration?: ElectricalPhaseConfiguration
  cableSectionMm2?: number
  cableConductors?: number
  cableType?: ElectricalCableType
  cableInstallation?: ElectricalCableInstallation
  breakerCurve?: 'B' | 'C' | 'D' | 'other'
  rcdSensitivityMa?: number
  rcdType?: 'AC' | 'A' | 'F' | 'B' | 'other'
  boardId?: string
  railId?: string
  notes?: string
}

const finitePositive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

const deviceSearchText = (name: string, path: string): string => `${name} ${path}`.toLowerCase()

export const isEarthingDevice = (name: string, path: string): boolean =>
  /\b(earthing|earth|grounding|ground|aarding|equipotential)\b/.test(deviceSearchText(name, path))

export const isDistributionBoardDevice = (name: string, path: string): boolean =>
  /\b(distribution.?board|switchboard|panelboard|board|bord|verdeelbord|verdeelkast|schakelkast|electrical.?cabinet|distribution.?panel)\b/.test(
    deviceSearchText(name, path)
  )

export const inferElectricalRole = (name: string, path: string): ElectricalRole => {
  const searchable = deviceSearchText(name, path)
  if (isEarthingDevice(name, path)) return 'neutral'
  if (isDistributionBoardDevice(name, path)) return 'junction'
  if (/protection|automaat|breaker|fuse|differential|rcd/.test(searchable)) return 'protection'
  if (/switch|schakel|drukknop|push.?button|contactor|relais|relay/.test(searchable)) return 'switch'
  if (/junction|lasdoos|connection box/.test(searchable)) return 'junction'
  if (
    /socket|outlet|stopcontact|consumption|lighting|lamp|light|spot|motor|heater|boiler|load|inverter|omvormer|photovolta|\bpv\b|solar/.test(
      searchable
    )
  ) {
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
    cableConductors: finitePositive(explicit.cableConductors),
    cableType:
      explicit.cableType === 'VOB' ||
      explicit.cableType === 'XVB' ||
      explicit.cableType === 'XVB-Cca' ||
      explicit.cableType === 'XGB' ||
      explicit.cableType === 'XGB-Cca' ||
      explicit.cableType === 'EXVB' ||
      explicit.cableType === 'other'
        ? explicit.cableType
        : undefined,
    cableInstallation:
      explicit.cableInstallation === 'conduit' ||
      explicit.cableInstallation === 'conduit-recessed' ||
      explicit.cableInstallation === 'without-conduit' ||
      explicit.cableInstallation === 'on-wall' ||
      explicit.cableInstallation === 'recessed' ||
      explicit.cableInstallation === 'underground'
        ? explicit.cableInstallation
        : undefined,
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
    cableConductors: finitePositive(raw.cableConductors),
    cableType:
      raw.cableType === 'VOB' ||
      raw.cableType === 'XVB' ||
      raw.cableType === 'XVB-Cca' ||
      raw.cableType === 'XGB' ||
      raw.cableType === 'XGB-Cca' ||
      raw.cableType === 'EXVB' ||
      raw.cableType === 'other'
        ? raw.cableType
        : undefined,
    cableInstallation:
      raw.cableInstallation === 'conduit' ||
      raw.cableInstallation === 'conduit-recessed' ||
      raw.cableInstallation === 'without-conduit' ||
      raw.cableInstallation === 'on-wall' ||
      raw.cableInstallation === 'recessed' ||
      raw.cableInstallation === 'underground'
        ? raw.cableInstallation
        : undefined,
    breakerCurve: raw.breakerCurve === 'B' || raw.breakerCurve === 'C' || raw.breakerCurve === 'D' || raw.breakerCurve === 'other' ? raw.breakerCurve : undefined,
    rcdSensitivityMa: finitePositive(raw.rcdSensitivityMa),
    rcdType: raw.rcdType === 'AC' || raw.rcdType === 'A' || raw.rcdType === 'F' || raw.rcdType === 'B' || raw.rcdType === 'other' ? raw.rcdType : undefined,
    boardId: typeof raw.boardId === 'string' ? raw.boardId.trim() || undefined : undefined,
    railId: typeof raw.railId === 'string' ? raw.railId.trim() || undefined : undefined,
    notes: typeof raw.notes === 'string' ? raw.notes.trim() || undefined : undefined
  }
}
