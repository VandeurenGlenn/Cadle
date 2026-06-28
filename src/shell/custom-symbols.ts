import type { Catalog, JsonValue } from './../types.js'
import { customCatalogStore } from '../api/catalog.js'
/**
 * User-imported SVG symbols are persisted to @leofcoin/storage and merged
 * into the live catalog as catalog sections grouped by folder/category.
 */

export type CustomCatalogSymbol = {
  folder?: string
  category: string
  kind?: string
  name: string
  path: string
  metadata?: Record<string, JsonValue>
}

export type CustomCatalogCategory = {
  folder?: string
  name: string
}

const LEGACY_STORAGE_KEY = 'cadle.customSymbols'
const SYMBOLS_STORAGE_KEY = 'custom-symbols'
const FOLDERS_STORAGE_KEY = 'custom-catalog-folders'
const CATEGORIES_STORAGE_KEY = 'custom-catalog-categories'
const decoder = new TextDecoder()

let symbolsCache: CustomCatalogSymbol[] = []
let foldersCache: string[] = []
let categoriesCache: CustomCatalogCategory[] = []
let initialized = false
let initializingPromise: Promise<void> | null = null

const toFolderValue = (value: unknown) => {
  const folder = typeof value === 'string' ? value.trim() : ''
  return folder || undefined
}

const sanitizeSymbol = (input: unknown): CustomCatalogSymbol | null => {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  const category = typeof candidate.category === 'string' ? candidate.category.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!category || !name || !path) return null

  const kind = typeof candidate.kind === 'string' ? candidate.kind.trim() : ''
  const metadata =
    candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
      ? (candidate.metadata as Record<string, JsonValue>)
      : undefined
  return {
    folder: toFolderValue(candidate.folder),
    category,
    kind: kind || category,
    name,
    path,
    metadata
  }
}

const sanitizeFolder = (input: unknown) => {
  if (typeof input !== 'string') return null
  const folder = input.trim()
  return folder || null
}

const sanitizeCategory = (input: unknown): CustomCatalogCategory | null => {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!name) return null
  return {
    folder: toFolderValue(candidate.folder),
    name
  }
}

const parseSymbolList = (source: string): CustomCatalogSymbol[] => {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => sanitizeSymbol(item)).filter((item): item is CustomCatalogSymbol => Boolean(item))
  } catch {
    return []
  }
}

const parseFolderList = (source: string): string[] => {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) return []
    const next: string[] = []
    const seen = new Set<string>()
    for (const folder of parsed) {
      const sanitized = sanitizeFolder(folder)
      if (!sanitized || seen.has(sanitized)) continue
      seen.add(sanitized)
      next.push(sanitized)
    }
    return next
  } catch {
    return []
  }
}

const categoryKey = (category: CustomCatalogCategory) => `${category.folder ?? ''}::${category.name}`

const parseCategoryList = (source: string): CustomCatalogCategory[] => {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) return []
    const next: CustomCatalogCategory[] = []
    const seen = new Set<string>()
    for (const category of parsed) {
      const sanitized = sanitizeCategory(category)
      if (!sanitized) continue
      const key = categoryKey(sanitized)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(sanitized)
    }
    return next
  } catch {
    return []
  }
}

const readLegacySymbols = (): CustomCatalogSymbol[] => {
  try {
    return parseSymbolList(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

const writeLegacySymbols = (symbols: CustomCatalogSymbol[]) => {
  localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(symbols))
}

const readPersistedSymbols = async (): Promise<CustomCatalogSymbol[]> => {
  try {
    const encoded = (await customCatalogStore.get(SYMBOLS_STORAGE_KEY)) as Uint8Array | undefined
    if (!encoded) return []
    return parseSymbolList(decoder.decode(encoded))
  } catch {
    return []
  }
}

const readPersistedFolders = async (): Promise<string[]> => {
  try {
    const encoded = (await customCatalogStore.get(FOLDERS_STORAGE_KEY)) as Uint8Array | undefined
    if (!encoded) return []
    return parseFolderList(decoder.decode(encoded))
  } catch {
    return []
  }
}

const readPersistedCategories = async (): Promise<CustomCatalogCategory[]> => {
  try {
    const encoded = (await customCatalogStore.get(CATEGORIES_STORAGE_KEY)) as Uint8Array | undefined
    if (!encoded) return []
    return parseCategoryList(decoder.decode(encoded))
  } catch {
    return []
  }
}

const persistSymbols = async (symbols: CustomCatalogSymbol[]) => {
  await customCatalogStore.put(SYMBOLS_STORAGE_KEY, JSON.stringify(symbols))
}

const persistStructure = async () => {
  await customCatalogStore.put(FOLDERS_STORAGE_KEY, JSON.stringify(foldersCache))
  await customCatalogStore.put(CATEGORIES_STORAGE_KEY, JSON.stringify(categoriesCache))
}

const ensureCategory = (name: string, folder?: string) => {
  const candidate: CustomCatalogCategory = {
    folder: toFolderValue(folder),
    name: name.trim()
  }
  if (!candidate.name) return
  const key = categoryKey(candidate)
  if (categoriesCache.some((entry) => categoryKey(entry) === key)) return
  categoriesCache = [...categoriesCache, candidate]
}

const deriveStructureFromSymbols = (symbols: CustomCatalogSymbol[]) => {
  const folders = new Set<string>()
  const categories = new Map<string, CustomCatalogCategory>()
  for (const symbol of symbols) {
    const folder = toFolderValue(symbol.folder)
    if (folder) folders.add(folder)
    const category: CustomCatalogCategory = {
      folder,
      name: symbol.category
    }
    categories.set(categoryKey(category), category)
  }

  foldersCache = [...folders].sort((left, right) => left.localeCompare(right))
  categoriesCache = [...categories.values()].sort((left, right) => {
    const leftFolder = left.folder ?? ''
    const rightFolder = right.folder ?? ''
    if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
    return left.name.localeCompare(right.name)
  })
}

const mergeStructureFromSymbols = (symbols: CustomCatalogSymbol[]) => {
  const folders = new Set<string>(foldersCache)
  const categories = new Map<string, CustomCatalogCategory>(
    categoriesCache.map((entry) => [categoryKey(entry), { ...entry }])
  )
  for (const symbol of symbols) {
    const folder = toFolderValue(symbol.folder)
    if (folder) folders.add(folder)
    const category: CustomCatalogCategory = {
      folder,
      name: symbol.category
    }
    categories.set(categoryKey(category), category)
  }

  foldersCache = [...folders].sort((left, right) => left.localeCompare(right))
  categoriesCache = [...categories.values()].sort((left, right) => {
    const leftFolder = left.folder ?? ''
    const rightFolder = right.folder ?? ''
    if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
    return left.name.localeCompare(right.name)
  })
}

export async function ensureCustomCatalogLoaded(): Promise<void> {
  if (initialized) return
  if (initializingPromise) return initializingPromise

  initializingPromise = (async () => {
    const persisted = await readPersistedSymbols()
    if (persisted.length > 0) {
      symbolsCache = persisted
    } else {
      const legacy = readLegacySymbols()
      symbolsCache = legacy
      if (legacy.length > 0) {
        await persistSymbols(legacy)
        writeLegacySymbols(legacy)
      }
    }

    const persistedFolders = await readPersistedFolders()
    const persistedCategories = await readPersistedCategories()
    if (persistedFolders.length === 0 && persistedCategories.length === 0) {
      deriveStructureFromSymbols(symbolsCache)
      if (foldersCache.length > 0 || categoriesCache.length > 0) {
        await persistStructure()
      }
    } else {
      foldersCache = persistedFolders
      categoriesCache = persistedCategories
    }

    initialized = true
  })()

  await initializingPromise
}

export function getStoredCustomSymbols(): CustomCatalogSymbol[] {
  return symbolsCache.map((symbol) => ({
    ...symbol,
    metadata: symbol.metadata ? { ...symbol.metadata } : undefined
  }))
}

export async function setStoredCustomSymbols(symbols: CustomCatalogSymbol[]): Promise<void> {
  await ensureCustomCatalogLoaded()
  const normalized = symbols
    .map((item) => sanitizeSymbol(item))
    .filter((item): item is CustomCatalogSymbol => Boolean(item))
  symbolsCache = normalized
  mergeStructureFromSymbols(symbolsCache)
  await persistSymbols(normalized)
  await persistStructure()
  writeLegacySymbols(normalized)
}

export function getStoredCustomFolders(): string[] {
  return [...foldersCache]
}

export function getStoredCustomCategories(): CustomCatalogCategory[] {
  return categoriesCache.map((entry) => ({ ...entry }))
}

export async function createCustomCatalogFolder(folderName: string): Promise<void> {
  await ensureCustomCatalogLoaded()
  const folder = folderName.trim()
  if (!folder || foldersCache.includes(folder)) return
  foldersCache = [...foldersCache, folder].sort((left, right) => left.localeCompare(right))
  await persistStructure()
}

export async function renameCustomCatalogFolder(currentName: string, nextName: string): Promise<void> {
  await ensureCustomCatalogLoaded()
  const source = currentName.trim()
  const target = nextName.trim()
  if (!source || !target || source === target || foldersCache.includes(target)) return
  foldersCache = foldersCache.map((folder) => (folder === source ? target : folder))
  symbolsCache = symbolsCache.map((symbol) => ({
    ...symbol,
    folder: symbol.folder === source ? target : symbol.folder
  }))
  categoriesCache = categoriesCache.map((entry) => ({
    ...entry,
    folder: entry.folder === source ? target : entry.folder
  }))
  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export async function deleteCustomCatalogFolder(folderName: string): Promise<void> {
  await ensureCustomCatalogLoaded()
  const target = folderName.trim()
  if (!target) return
  foldersCache = foldersCache.filter((folder) => folder !== target)
  symbolsCache = symbolsCache.map((symbol) => ({
    ...symbol,
    folder: symbol.folder === target ? undefined : symbol.folder
  }))
  categoriesCache = categoriesCache.map((entry) => ({
    ...entry,
    folder: entry.folder === target ? undefined : entry.folder
  }))
  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export async function createCustomCatalogCategory(categoryName: string, folder?: string): Promise<void> {
  await ensureCustomCatalogLoaded()
  const name = categoryName.trim()
  const normalizedFolder = toFolderValue(folder)
  if (!name) return
  ensureCategory(name, normalizedFolder)
  if (normalizedFolder && !foldersCache.includes(normalizedFolder)) {
    foldersCache = [...foldersCache, normalizedFolder].sort((left, right) => left.localeCompare(right))
  }

  await persistStructure()
}

export async function renameCustomCatalogCategory(
  currentName: string,
  nextName: string,
  folder?: string
): Promise<void> {
  await ensureCustomCatalogLoaded()
  const sourceName = currentName.trim()
  const targetName = nextName.trim()
  const normalizedFolder = toFolderValue(folder)
  if (!sourceName || !targetName || sourceName === targetName) return
  const sourceKey = `${normalizedFolder ?? ''}::${sourceName}`
  const targetKey = `${normalizedFolder ?? ''}::${targetName}`
  if (categoriesCache.some((entry) => categoryKey(entry) === targetKey)) return
  categoriesCache = categoriesCache.map((entry) => {
    if (categoryKey(entry) !== sourceKey) return entry
    return {
      ...entry,
      name: targetName
    }
  })
  symbolsCache = symbolsCache.map((symbol) => {
    if ((symbol.folder ?? '') !== (normalizedFolder ?? '')) return symbol
    if (symbol.category !== sourceName) return symbol
    return {
      ...symbol,
      category: targetName
    }
  })
  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export async function deleteCustomCatalogCategory(categoryName: string, folder?: string): Promise<void> {
  await ensureCustomCatalogLoaded()
  const targetName = categoryName.trim()
  const normalizedFolder = toFolderValue(folder)
  if (!targetName) return
  categoriesCache = categoriesCache.filter(
    (entry) => entry.name !== targetName || (entry.folder ?? '') !== (normalizedFolder ?? '')
  )
  symbolsCache = symbolsCache.map((symbol) => {
    if ((symbol.folder ?? '') !== (normalizedFolder ?? '')) return symbol
    if (symbol.category !== targetName) return symbol
    return {
      ...symbol,
      category: 'My Symbols'
    }
  })
  ensureCategory('My Symbols', normalizedFolder)
  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export async function moveCustomCatalogCategory(
  categoryName: string,
  fromFolder: string | undefined,
  toFolder: string | undefined
): Promise<void> {
  await ensureCustomCatalogLoaded()
  const name = categoryName.trim()
  const sourceFolder = toFolderValue(fromFolder)
  const targetFolder = toFolderValue(toFolder)
  if (!name) return
  if ((sourceFolder ?? '') === (targetFolder ?? '')) return

  const sourceKey = `${sourceFolder ?? ''}::${name}`
  const targetKey = `${targetFolder ?? ''}::${name}`
  const sourceExists = categoriesCache.some((entry) => categoryKey(entry) === sourceKey)
  const targetExists = categoriesCache.some((entry) => categoryKey(entry) === targetKey)
  if (!sourceExists || targetExists) return

  categoriesCache = categoriesCache.map((entry) => {
    if (categoryKey(entry) !== sourceKey) return entry
    return {
      ...entry,
      folder: targetFolder
    }
  })

  symbolsCache = symbolsCache.map((symbol) => {
    if ((symbol.folder ?? '') !== (sourceFolder ?? '')) return symbol
    if (symbol.category !== name) return symbol
    return {
      ...symbol,
      folder: targetFolder
    }
  })

  if (targetFolder && !foldersCache.includes(targetFolder)) {
    foldersCache = [...foldersCache, targetFolder].sort((left, right) => left.localeCompare(right))
  }

  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export async function moveCustomCatalogSymbol(
  symbolName: string,
  symbolPath: string,
  fromCategory: string,
  fromFolder: string | undefined,
  toCategory: string,
  toFolder: string | undefined
): Promise<void> {
  await ensureCustomCatalogLoaded()
  const name = symbolName.trim()
  const path = symbolPath.trim()
  const sourceCategory = fromCategory.trim()
  const targetCategory = toCategory.trim()
  const sourceFolder = toFolderValue(fromFolder)
  const targetFolder = toFolderValue(toFolder)
  if (!name || !path || !sourceCategory || !targetCategory) return
  if (sourceCategory === targetCategory && (sourceFolder ?? '') === (targetFolder ?? '')) return

  let moved = false
  symbolsCache = symbolsCache.map((symbol) => {
    if (moved) return symbol
    if (symbol.name !== name || symbol.path !== path) return symbol
    if (symbol.category !== sourceCategory) return symbol
    if ((symbol.folder ?? '') !== (sourceFolder ?? '')) return symbol
    moved = true
    return {
      ...symbol,
      category: targetCategory,
      folder: targetFolder
    }
  })

  if (!moved) return
  ensureCategory(targetCategory, targetFolder)
  if (targetFolder && !foldersCache.includes(targetFolder)) {
    foldersCache = [...foldersCache, targetFolder].sort((left, right) => left.localeCompare(right))
  }

  await persistSymbols(symbolsCache)
  await persistStructure()
  writeLegacySymbols(symbolsCache)
}

export function getCustomCatalogSections(): Catalog {
  const symbols = getStoredCustomSymbols()
  const grouped = new Map<string, Catalog[number]>()

  for (const symbol of symbols) {
    const folder = toFolderValue(symbol.folder)
    const key = `${folder ?? ''}::${symbol.category}`
    const bucket = grouped.get(key) ?? {
      folder,
      category: symbol.category,
      symbols: []
    }
    bucket.symbols.push({
      kind: symbol.kind ?? symbol.category,
      name: symbol.name,
      path: symbol.path,
      folder,
      metadata: symbol.metadata
    })
    grouped.set(key, bucket)
  }

  for (const category of categoriesCache) {
    const folder = toFolderValue(category.folder)
    const key = `${folder ?? ''}::${category.name}`
    if (grouped.has(key)) continue
    grouped.set(key, {
      folder,
      category: category.name,
      symbols: []
    })
  }
  return [...grouped.values()].sort((left, right) => {
    const leftFolder = left.folder ?? ''
    const rightFolder = right.folder ?? ''
    if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
    return left.category.localeCompare(right.category)
  })
}
