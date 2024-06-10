export type ProjectInput =  {
  
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
  pages: {
    [uuid: string]: {
      creationTime: EpochTimeStamp
      name: string
      schema: {version: string, objects: object[]}
    }    
  }
}

export type Projects = {[uuid: `${string}-${string}-${string}-${string}-${string}`]: Project}