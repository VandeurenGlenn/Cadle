import type { Catalog, JsonValue } from './../types.js'
/**
 * User-imported SVG symbols are persisted to `localStorage` and merged into
 * the live catalog as catalog sections grouped by category.
 */

export type CustomCatalogSymbol = {
  category: string
  name: string
  path: string
  metadata?: Record<string, JsonValue>
}

const STORAGE_KEY = 'cadle.customSymbols'

export function getStoredCustomSymbols(): CustomCatalogSymbol[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as CustomCatalogSymbol[]
  } catch {
    return []
  }
}

export function setStoredCustomSymbols(symbols: CustomCatalogSymbol[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols))
}

export function getCustomCatalogSections(): Catalog {
  const symbols = getStoredCustomSymbols()
  const grouped = new Map<string, Catalog[number]['symbols']>()

  for (const symbol of symbols) {
    const bucket = grouped.get(symbol.category) ?? []
    bucket.push({ name: symbol.name, path: symbol.path, metadata: symbol.metadata })
    grouped.set(symbol.category, bucket)
  }
  return [...grouped.entries()].map(([category, entries]) => ({
    category,
    symbols: entries
  }))
}
