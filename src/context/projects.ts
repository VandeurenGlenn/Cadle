import {createContext} from '@lit-labs/context';
// import type {Logger} from 'my-logging-library';
// export type {Logger} from 'my-logging-library';

declare type Projects = string[]

export type { Projects }

export const projectsContext = createContext<Projects>('projects');