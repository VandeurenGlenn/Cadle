import { createContext } from '@lit-labs/context'

declare type Catalog = {
  category: string
  symbols: {
    name: string
    path: string
    metadata?: Record<string, unknown>
  }[]
}[]

export type { Catalog }

export const catalogContext = createContext<Catalog>('catalog')
