import type { Catalog } from '../types.js'
import { customCatalogStore } from '../api/catalog.js'

export type CatalogSymbolOverride = {
  path: string
  name?: string
  disabled?: boolean
}

const SYMBOL_OVERRIDES_STORAGE_KEY = 'catalog-symbol-overrides'
const decoder = new TextDecoder()

let symbolOverridesCache: CatalogSymbolOverride[] = []
let initialized = false
let initializingPromise: Promise<void> | null = null

const sanitizeSymbolOverride = (input: unknown): CatalogSymbolOverride | null => {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path) return null
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const disabled = candidate.disabled === true
  if (!name && !disabled) return null
  return {
    path,
    name: name || undefined,
    disabled: disabled || undefined
  }
}

const parseSymbolOverrideList = (source: string): CatalogSymbolOverride[] => {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) return []
    const next: CatalogSymbolOverride[] = []
    const seen = new Set<string>()
    for (const override of parsed) {
      const sanitized = sanitizeSymbolOverride(override)
      if (!sanitized || seen.has(sanitized.path)) continue
      seen.add(sanitized.path)
      next.push(sanitized)
    }
    return next
  } catch {
    return []
  }
}

const readPersistedSymbolOverrides = async (): Promise<CatalogSymbolOverride[]> => {
  try {
    const encoded = (await customCatalogStore.get(SYMBOL_OVERRIDES_STORAGE_KEY)) as Uint8Array | undefined
    if (!encoded) return []
    return parseSymbolOverrideList(decoder.decode(encoded))
  } catch {
    return []
  }
}

const persistSymbolOverrides = async () => {
  await customCatalogStore.put(SYMBOL_OVERRIDES_STORAGE_KEY, JSON.stringify(symbolOverridesCache))
}

export async function ensureCatalogSymbolOverridesLoaded(): Promise<void> {
  if (initialized) return
  if (initializingPromise) return initializingPromise
  initializingPromise = readPersistedSymbolOverrides().then((overrides) => {
    symbolOverridesCache = overrides
    initialized = true
  })
  return initializingPromise
}

export function getStoredCatalogSymbolOverrides(): CatalogSymbolOverride[] {
  return symbolOverridesCache.map((entry) => ({ ...entry }))
}

export async function setStoredCatalogSymbolOverride(
  path: string,
  override: Omit<CatalogSymbolOverride, 'path'>
): Promise<void> {
  await ensureCatalogSymbolOverridesLoaded()
  const normalizedPath = path.trim()
  if (!normalizedPath) return
  const normalized: CatalogSymbolOverride = {
    path: normalizedPath,
    name: typeof override.name === 'string' && override.name.trim() ? override.name.trim() : undefined,
    disabled: override.disabled === true || undefined
  }
  symbolOverridesCache = symbolOverridesCache.filter((entry) => entry.path !== normalizedPath)
  if (normalized.name || normalized.disabled) {
    symbolOverridesCache = [...symbolOverridesCache, normalized].sort((left, right) =>
      left.path.localeCompare(right.path)
    )
  }
  await persistSymbolOverrides()
}

export function applyCatalogSymbolOverrides(catalog: Catalog): Catalog {
  if (symbolOverridesCache.length === 0) return catalog
  const overrides = new Map(symbolOverridesCache.map((entry) => [entry.path, entry]))
  return catalog
    .map((section) => ({
      ...section,
      symbols: section.symbols.flatMap((symbol) => {
        const override = overrides.get(symbol.path)
        if (override?.disabled) return []
        return [
          {
            ...symbol,
            name: override?.name ?? symbol.name
          }
        ]
      })
    }))
    .filter((section) => section.symbols.length > 0)
}
