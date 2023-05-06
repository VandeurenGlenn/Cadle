import {createContext} from '@lit-labs/context';

declare type Catalog = {
  category: string,
  symbols: {name: string, path: string}[]
}[]

export type { Catalog }

export const catalogContext = createContext<Catalog>('catalog');