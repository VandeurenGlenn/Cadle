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

export type Projects = { [uuid: UUID]: string }

export type HistoryAction = {
  type: 'add' | 'remove' | 'modify'
  object: FabricObject
  prevState?: any
  newState?: any
}
