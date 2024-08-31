import { createContext } from '@lit/context'
import type { Projects } from '../types.js'

export type { Projects }

export const projectsContext = createContext<Projects>('projects')
