import {createContext} from '@lit-labs/context';
// import type {Logger} from 'my-logging-library';
// export type {Logger} from 'my-logging-library';

declare type Project = {
  pages: string[],
  symbols: {
    category: string,
    symbols: string[]
  }[]
}

export type { Project }

export const projectContext = createContext<Project>('project');