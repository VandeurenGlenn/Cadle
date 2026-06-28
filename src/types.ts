export type UUID = `${string}-${string}-${string}-${string}-${string}`

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

export type ProjectInput = {
  name: string
  installer: {
    name: string
    lastname: string
  }
  company: string
  address: {
    street: string
    number: string
    postalCode: string
  }
}

export interface Project extends ProjectInput {
  creationTime: EpochTimeStamp
  uuid: UUID
  pages: {
    [uuid: string]: {
      creationTime: EpochTimeStamp
      name: string
      schema: { version: string; objects: object[] }
      order?: number
    }
  }
}

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
