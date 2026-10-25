export const DEFAULT_SYMBOL_STROKE_WIDTH = 0.65
export const MIN_SYMBOL_STROKE_WIDTH = 0.1
export const MAX_SYMBOL_STROKE_WIDTH = 3

export const symbolStrokeWidthForViewBox = (
  viewBox: string,
  renderedSize: number,
  renderedStrokeWidth: number
): number => {
  const dimensions = viewBox.trim().split(/[\s,]+/).map(Number)
  if (
    dimensions.length !== 4 ||
    dimensions.some((value) => !Number.isFinite(value)) ||
    dimensions[2] <= 0 ||
    dimensions[3] <= 0 ||
    !Number.isFinite(renderedSize) ||
    renderedSize <= 0
  ) {
    return renderedStrokeWidth
  }
  return renderedStrokeWidth * (Math.max(dimensions[2], dimensions[3]) / renderedSize)
}

const STORAGE_KEY = 'cadle-symbol-stroke-width'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export const normalizeSymbolStrokeWidth = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SYMBOL_STROKE_WIDTH
  return Math.max(MIN_SYMBOL_STROKE_WIDTH, Math.min(MAX_SYMBOL_STROKE_WIDTH, parsed))
}

export const readSymbolStrokeWidth = (storage: StorageReader = localStorage): number => {
  try {
    const stored = storage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_SYMBOL_STROKE_WIDTH : normalizeSymbolStrokeWidth(stored)
  } catch {
    return DEFAULT_SYMBOL_STROKE_WIDTH
  }
}

export const writeSymbolStrokeWidth = (value: number, storage: StorageWriter = localStorage): number => {
  const normalized = normalizeSymbolStrokeWidth(value)
  try {
    storage.setItem(STORAGE_KEY, String(normalized))
  } catch {
    // The normalized in-memory value remains usable when storage is unavailable.
  }
  return normalized
}
