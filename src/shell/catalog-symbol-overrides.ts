import type { Catalog } from '../types.js'
import { customCatalogStore } from '../api/catalog.js'

export type CatalogSymbolOverride = {
  path: string
  name?: string
  disabled?: boolean
  defaultScale?: number
  defaultRotation?: number
  defaultFill?: string
  defaultStroke?: string
  defaultStrokeWidth?: number
  defaultFlipX?: boolean
  defaultFlipY?: boolean
}

export type CatalogSymbolStyleDefaults = {
  scale?: number
  rotation?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  flipX?: boolean
  flipY?: boolean
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
  const defaultScale =
    typeof candidate.defaultScale === 'number' && Number.isFinite(candidate.defaultScale)
      ? Math.max(0.1, Math.min(20, candidate.defaultScale))
      : undefined
  const defaultRotation =
    typeof candidate.defaultRotation === 'number' && Number.isFinite(candidate.defaultRotation)
      ? ((candidate.defaultRotation % 360) + 360) % 360
      : undefined
  const defaultFill =
    typeof candidate.defaultFill === 'string' && candidate.defaultFill.trim() ? candidate.defaultFill : undefined
  const defaultStroke =
    typeof candidate.defaultStroke === 'string' && candidate.defaultStroke.trim() ? candidate.defaultStroke : undefined
  const defaultStrokeWidth =
    typeof candidate.defaultStrokeWidth === 'number' && Number.isFinite(candidate.defaultStrokeWidth)
      ? Math.max(0.5, Math.min(40, candidate.defaultStrokeWidth))
      : undefined
  const defaultFlipX = candidate.defaultFlipX === true ? true : undefined
  const defaultFlipY = candidate.defaultFlipY === true ? true : undefined

  if (
    !name &&
    !disabled &&
    typeof defaultScale !== 'number' &&
    typeof defaultRotation !== 'number' &&
    !defaultFill &&
    !defaultStroke &&
    typeof defaultStrokeWidth !== 'number' &&
    !defaultFlipX &&
    !defaultFlipY
  ) {
    return null
  }
  return {
    path,
    name: name || undefined,
    disabled: disabled || undefined,
    defaultScale,
    defaultRotation,
    defaultFill,
    defaultStroke,
    defaultStrokeWidth,
    defaultFlipX,
    defaultFlipY
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
    disabled: override.disabled === true || undefined,
    defaultScale:
      typeof override.defaultScale === 'number' && Number.isFinite(override.defaultScale)
        ? Math.max(0.1, Math.min(20, override.defaultScale))
        : undefined,
    defaultRotation:
      typeof override.defaultRotation === 'number' && Number.isFinite(override.defaultRotation)
        ? ((override.defaultRotation % 360) + 360) % 360
        : undefined,
    defaultFill:
      typeof override.defaultFill === 'string' && override.defaultFill.trim() ? override.defaultFill.trim() : undefined,
    defaultStroke:
      typeof override.defaultStroke === 'string' && override.defaultStroke.trim()
        ? override.defaultStroke.trim()
        : undefined,
    defaultStrokeWidth:
      typeof override.defaultStrokeWidth === 'number' && Number.isFinite(override.defaultStrokeWidth)
        ? Math.max(0.5, Math.min(40, override.defaultStrokeWidth))
        : undefined,
    defaultFlipX: override.defaultFlipX === true || undefined,
    defaultFlipY: override.defaultFlipY === true || undefined
  }
  symbolOverridesCache = symbolOverridesCache.filter((entry) => entry.path !== normalizedPath)
  if (
    normalized.name ||
    normalized.disabled ||
    typeof normalized.defaultScale === 'number' ||
    typeof normalized.defaultRotation === 'number' ||
    normalized.defaultFill ||
    normalized.defaultStroke ||
    typeof normalized.defaultStrokeWidth === 'number' ||
    normalized.defaultFlipX ||
    normalized.defaultFlipY
  ) {
    symbolOverridesCache = [...symbolOverridesCache, normalized].sort((left, right) =>
      left.path.localeCompare(right.path)
    )
  }
  await persistSymbolOverrides()
}

export function getCatalogSymbolStyleDefaults(path: string): CatalogSymbolStyleDefaults | undefined {
  const normalizedPath = path.trim()
  if (!normalizedPath) return undefined
  const override = symbolOverridesCache.find((entry) => entry.path === normalizedPath)
  if (!override) return undefined
  const defaults: CatalogSymbolStyleDefaults = {
    scale: override.defaultScale,
    rotation: override.defaultRotation,
    fill: override.defaultFill,
    stroke: override.defaultStroke,
    strokeWidth: override.defaultStrokeWidth,
    flipX: override.defaultFlipX,
    flipY: override.defaultFlipY
  }
  if (
    typeof defaults.scale !== 'number' &&
    typeof defaults.rotation !== 'number' &&
    !defaults.fill &&
    !defaults.stroke &&
    typeof defaults.strokeWidth !== 'number' &&
    !defaults.flipX &&
    !defaults.flipY
  ) {
    return undefined
  }
  return defaults
}

export async function setStoredCatalogSymbolStyleDefaults(
  path: string,
  defaults: CatalogSymbolStyleDefaults
): Promise<void> {
  await ensureCatalogSymbolOverridesLoaded()
  const normalizedPath = path.trim()
  if (!normalizedPath) return
  const existing = symbolOverridesCache.find((entry) => entry.path === normalizedPath)
  await setStoredCatalogSymbolOverride(normalizedPath, {
    name: existing?.name,
    disabled: existing?.disabled,
    defaultScale: defaults.scale,
    defaultRotation: defaults.rotation,
    defaultFill: defaults.fill,
    defaultStroke: defaults.stroke,
    defaultStrokeWidth: defaults.strokeWidth,
    defaultFlipX: defaults.flipX,
    defaultFlipY: defaults.flipY
  })
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
