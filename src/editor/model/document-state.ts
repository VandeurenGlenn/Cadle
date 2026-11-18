import { isDrawingScale, type DrawingScale } from '../layout/drawing-scale.js'
import type { Project, UUID } from '../../types.js'
import { sanitizeShapes } from './model.js'
import type { PaperPreset, Shape } from './types.js'

export type NativeDocumentState = {
  version: 1 | 2
  oneWireLayoutVersion?: number
  paperLayoutVersion?: number
  drawingScale?: DrawingScale
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

  const oneWireLayoutVersion =
    typeof candidate.oneWireLayoutVersion === 'number' &&
    Number.isInteger(candidate.oneWireLayoutVersion) &&
    candidate.oneWireLayoutVersion >= 0
      ? candidate.oneWireLayoutVersion
      : undefined

  return {
    version: candidate.version === 2 ? 2 : 1,
    ...(typeof oneWireLayoutVersion === 'number' ? { oneWireLayoutVersion } : {}),
    ...(candidate.paperLayoutVersion === 1 ? { paperLayoutVersion: 1 } : {}),
    ...(isDrawingScale(candidate.drawingScale) ? { drawingScale: candidate.drawingScale } : {}),
    shapes: sanitizeShapes(candidate.shapes),
    selectedId: null,
    paperPreset: candidate.paperPreset,
    printMargin: candidate.printMargin,
    worldWidth: candidate.worldWidth,
    worldHeight: candidate.worldHeight
  }
}

const parseNativeFromSchema = (schema: unknown): NativeDocumentState | null => {
  const direct = asNativeState(schema)
  if (direct) return direct
  if (!schema || typeof schema !== 'object') return null
  const candidate = schema as { payload?: unknown; objects?: unknown[] }
  const payloadState = asNativeState(candidate.payload)
  if (payloadState) return payloadState
  if (!Array.isArray(candidate.objects)) return null
  for (const object of candidate.objects) {
    const objectState = asNativeState(object)
    if (objectState) return objectState
    if (!object || typeof object !== 'object') continue
    const wrapper = object as { kind?: unknown; payload?: unknown }
    if (wrapper.kind === 'cadle-native-svg-document') {
      const state = asNativeState(wrapper.payload)
      if (state) return state
    }
  }
  return null
}

export const nativeStateForProjectPage = (project: Project, pageKey: string): NativeDocumentState | null => {
  const page = project.pages?.[pageKey]
  return page ? parseNativeFromSchema(page.schema) : null
}
