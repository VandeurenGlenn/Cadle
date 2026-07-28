export type UUID = `${string}-${string}-${string}-${string}-${string}`

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

export type ElectricalProjectProfile = {
  standard: 'AREI'
  edition: string
  distributor: string
  supplyConfiguration: '1x230V+N' | '3x230V' | '3x400V+N' | 'other'
  supplyVoltageV: number
  phaseConfiguration: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  earthingSystem: 'TT' | 'TN' | 'IT' | 'unknown'
  defaultPoles: number
  boards?: ElectricalBoard[]
}

export type ElectricalBoard = {
  id: string
  name: string
  parentBoardId?: string
  rails: Array<{ id: string; name: string }>
  mainDifferential?: DifferentialProtection
  additionalDifferentials?: DifferentialProtection[]
}

export type DifferentialProtection = {
  id: string
  ratedCurrentA: number
  sensitivityMa: number
  poles: number
  type?: 'AC' | 'A' | 'F' | 'B' | 'other'
}

export type OneWireTopologyPlan = {
  version: 1
  incomingCable?: {
    conductors: number
    sectionMm2: number
    cableType: 'VOB' | 'XVB' | 'XVB-Cca' | 'XGB' | 'XGB-Cca' | 'EXVB' | 'other'
  }
  mainDifferential?: {
    ratedCurrentA: number
    sensitivityMa: number
  }
  residualBreaker: boolean
  solar: boolean
  consumers: boolean
  solarPlacement?: 'parallel-after-main-differential'
}

export type ProjectCircuitSpecification = {
  circuitType?: 'lighting' | 'sockets' | 'motor' | 'mixed' | 'other'
  breakerCurrentA?: number
  cableSectionMm2?: number
  cableConductors?: number
  hasProtectiveConductor?: boolean
  cableType?: 'none' | 'VOB' | 'XVB' | 'XVB-Cca' | 'XGB' | 'XGB-Cca' | 'EXVB' | 'other'
  cableInstallation?: 'conduit' | 'conduit-recessed' | 'without-conduit' | 'on-wall' | 'recessed' | 'underground'
  showCableInstallation?: boolean
  poles?: number
  phaseConfiguration?: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  showPhaseLabel?: boolean
  breakerCurve?: 'B' | 'C' | 'D' | 'other'
  rcdSensitivityMa?: number
  rcdType?: 'AC' | 'A' | 'F' | 'B' | 'other'
  boardId?: string
  railId?: string
  notes?: string
}

export type ProjectInput = {
  name: string
  logoUrl?: string
  logoColor?: string
  logoScale?: number
  logoX?: number
  logoY?: number
  installerSignatureUrl?: string
  customerSignatureUrl?: string
  customer: {
    name: string
    lastname: string
  }
  installer: {
    name: string
    lastname: string
    btw?: string
  }
  company: string
  address: {
    street: string
    number: string
    postalCode: string
    city: string
  }
  eanCode?: string
  mainFuseA?: number
  electricalProfile?: ElectricalProjectProfile
  circuitSpecifications?: Record<string, ProjectCircuitSpecification>
  oneWirePrompt?: string
  oneWireTopology?: OneWireTopologyPlan
}

export interface Project extends ProjectInput {
  creationTime: EpochTimeStamp
  uuid: UUID
  pages: {
    [uuid: string]: {
      creationTime: EpochTimeStamp
      name: string
      pageType?: PageType
      schema: { version: string; objects: object[] }
      order?: number
    }
  }
}

export type PageType = 'groundplan' | 'onewire'

export type Projects = [string, string][]

export type HistoryAction = {
  type:
    | 'add'
    | 'remove'
    | 'modify'
    | 'move'
    | 'flipX'
    | 'flipY'
    | 'rotate-up'
    | 'rotate-down'
    | 'scale-down'
    | 'scale-up'
    | 'move-left'
    | 'move-right'
  objects?: unknown[]
  object?: unknown
  item?: unknown
  prevState?: JsonValue
  newState?: JsonValue
}

export declare type Catalog = {
  category: string
  folder?: string
  symbols: {
    kind: string
    name: string
    path: string
    folder?: string
    metadata?: Record<string, JsonValue>
  }[]
}[]
