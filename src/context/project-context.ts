import {createContext} from '@lit-labs/context';
import { Object } from 'fabric';
// import type {Logger} from 'my-logging-library';
// export type {Logger} from 'my-logging-library';

declare type Page = {
  creationTime: EpochTimeStamp,
  name: string,
  schema: {
    version: string,
    objects: []
  }
}

declare type Project = {
  creationTime: EpochTimeStamp
  pages: Page[]
}

export type { Project, Page }

export const projectContext = createContext<Project>('project');