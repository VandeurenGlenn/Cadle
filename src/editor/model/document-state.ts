import type { UUID } from '../../types.js'
import { sanitizeShapes } from './model.js'
import type { PaperPreset, Shape } from './types.js'

export type NativeDocumentState = {
  version: 1
  shapes: Shape[]
  selectedId: UUID | null
  paperPreset: PaperPreset
  printMargin: number
  worldWidth: number
  worldHeight: number
}

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export const asNativeState = (value: unknown): NativeDocumentState | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NativeDocumentState>
  if (!Array.isArray(candidate.shapes)) return null
  if (!isFinitePositive(candidate.worldWidth)) return null
  if (!isFinitePositive(candidate.worldHeight)) return null
  if (!isFiniteNonNegative(candidate.printMargin)) return null
  if (
    candidate.paperPreset !== 'a4-portrait' &&
    candidate.paperPreset !== 'a4-landscape' &&
    candidate.paperPreset !== 'a3-portrait' &&
    candidate.paperPreset !== 'a3-landscape'
  ) {
    return null
  }

  return {
    version: 1,
    shapes: sanitizeShapes(candidate.shapes),
    selectedId: null,
    paperPreset: candidate.paperPreset,
    printMargin: candidate.printMargin,
    worldWidth: candidate.worldWidth,
    worldHeight: candidate.worldHeight
  }
}
