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
  phaseConfiguration: 'single-phase' | 'three-phase'
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

export type ProjectInput = {
  name: string
  logoUrl?: string
  logoColor?: string
  logoScale?: number
  logoX?: number
  logoY?: number
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
