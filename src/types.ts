import { FabricObject } from 'fabric'

export type UUID = `${string}-${string}-${string}-${string}-${string}`

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
    }
  }
}

export type Projects = [string, string][]

export type HistoryAction = {
  type: 'add' | 'remove' | 'modify' | 'move'
  objects: FabricObject[]
  object?: FabricObject
  item?: FabricObject
  prevState?: any
  newState?: any
}

export declare type Catalog = {
  category: string
  symbols: {
    name: string
    path: string
    metadata?: Record<string, unknown>
  }[]
}[]
