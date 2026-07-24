import { cloneShape, shapeBounds } from '../../native-draw/model.js'
import type { Point, Shape } from '../../native-draw/types.js'
import { bindingLabelOffset, type BindingLabelSide } from '../layout/symbol-layout.js'
import { translateShape } from './shape-transforms.js'

export type SelectionPropertyUpdate = {
  text?: string
  symbolTextOverrides?: Record<string, string>
  bindingId?: string
  bindingLabelSide?: BindingLabelSide | 'auto'
  rotation?: number
  scale?: number
  flipX?: boolean
  flipY?: boolean
  fill?: string
  stroke?: string
  strokeWidth?: number
  fontFamily?: string
  letterSpacing?: number
  x?: number
  y?: number
}

export type SelectionUpdateContext = {
  selectedIds: ReadonlySet<string>
  selectedId: string | null
  groupedSelection: boolean
}

const isLineShape = (shape: Shape) =>
  shape.kind === 'wall' ||
  shape.kind === 'line' ||
  shape.kind === 'door' ||
  shape.kind === 'window' ||
  shape.kind === 'gate'

const selectionCenter = (shapes: readonly Shape[], targetIds: ReadonlySet<string>): Point | null => {
  if (targetIds.size < 2) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of shapes) {
    if (!targetIds.has(shape.id)) continue
    const bounds = shapeBounds(shape)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null
}

const normalizedBindingId = (payload: SelectionPropertyUpdate): string | undefined => {
  if (!('bindingId' in payload) || typeof payload.bindingId !== 'string') return undefined
  const value = payload.bindingId.trim().toUpperCase()
  return value && value !== 'UNDEFINED' && value !== 'NULL' ? value : undefined
}

const applyProperties = (
  shape: Shape,
  payload: SelectionPropertyUpdate,
  center: Point | null,
  bindingId: string | undefined,
  context: SelectionUpdateContext
): Shape => {
  const updated = cloneShape(shape) as Shape & { fill?: string }
  if ('bindingId' in payload) {
    if (bindingId && (!context.groupedSelection || shape.id === context.selectedId)) updated.bindingId = bindingId
    else delete updated.bindingId
  }

  if (payload.bindingLabelSide === 'auto') delete updated.bindingLabelOffset
  else if (payload.bindingLabelSide) updated.bindingLabelOffset = bindingLabelOffset(updated, payload.bindingLabelSide)

  if (typeof payload.rotation === 'number') {
    const angle = ((payload.rotation % 360) + 360) % 360
    if (isLineShape(updated)) {
      const line = updated as Extract<Shape, { start: Point; end: Point }>
      const radians = (angle * Math.PI) / 180
      const centerX = (line.start.x + line.end.x) / 2
      const centerY = (line.start.y + line.end.y) / 2
      const half = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) / 2
      line.start = { x: centerX - Math.cos(radians) * half, y: centerY - Math.sin(radians) * half }
      line.end = { x: centerX + Math.cos(radians) * half, y: centerY + Math.sin(radians) * half }
      line.rotation = angle
    } else if (updated.kind === 'symbol' || updated.kind === 'image' || updated.kind === 'text' || updated.kind === 'rect') {
      updated.rotation = angle
    }
  }

  if (typeof payload.scale === 'number') {
    const nextScale = Math.max(0.1, Math.min(20, payload.scale))
    if (updated.kind === 'symbol' || updated.kind === 'text') updated.scale = nextScale
    else if (updated.kind === 'rect' || isLineShape(updated)) {
      const scalable = updated as Extract<Shape, { start: Point; end: Point }> & { scale?: number }
      const currentScale = typeof scalable.scale === 'number' && Number.isFinite(scalable.scale) ? scalable.scale : 1
      const factor = nextScale / currentScale
      const ownCenterX = (scalable.start.x + scalable.end.x) / 2
      const ownCenterY = (scalable.start.y + scalable.end.y) / 2
      const centerX = updated.kind === 'rect' ? ownCenterX : (center?.x ?? ownCenterX)
      const centerY = updated.kind === 'rect' ? ownCenterY : (center?.y ?? ownCenterY)
      scalable.start = {
        x: centerX + (scalable.start.x - centerX) * factor,
        y: centerY + (scalable.start.y - centerY) * factor
      }
      scalable.end = {
        x: centerX + (scalable.end.x - centerX) * factor,
        y: centerY + (scalable.end.y - centerY) * factor
      }
      scalable.scale = nextScale
    }
  }

  for (const axis of ['X', 'Y'] as const) {
    const property = `flip${axis}` as 'flipX' | 'flipY'
    const value = payload[property]
    if (typeof value !== 'boolean') continue
    if (isLineShape(updated)) {
      const line = updated as Extract<Shape, { start: Point; end: Point }>
      if (axis === 'X') {
        const centerX = (line.start.x + line.end.x) / 2
        line.start = { x: centerX * 2 - line.start.x, y: line.start.y }
        line.end = { x: centerX * 2 - line.end.x, y: line.end.y }
      } else {
        const centerY = (line.start.y + line.end.y) / 2
        line.start = { x: line.start.x, y: centerY * 2 - line.start.y }
        line.end = { x: line.end.x, y: centerY * 2 - line.end.y }
      }
    }
    if (value) updated[property] = true
    else delete updated[property]
  }

  if (typeof payload.fill === 'string') {
    if (payload.fill) updated.fill = payload.fill
    else delete updated.fill
  }
  if (typeof payload.stroke === 'string') {
    if (payload.stroke) updated.stroke = payload.stroke
    else delete updated.stroke
  }
  if (typeof payload.strokeWidth === 'number') updated.strokeWidth = Math.max(0.5, Math.min(40, payload.strokeWidth))
  if (typeof payload.text === 'string' && updated.kind === 'text') updated.text = payload.text
  if (typeof payload.fontFamily === 'string' && updated.kind === 'text') {
    if (payload.fontFamily) updated.fontFamily = payload.fontFamily
    else delete updated.fontFamily
  }
  if (typeof payload.letterSpacing === 'number' && updated.kind === 'text') updated.letterSpacing = payload.letterSpacing

  if (payload.symbolTextOverrides && updated.kind === 'symbol') {
    const entries = Object.entries(payload.symbolTextOverrides)
      .filter(([key, value]) => Boolean(key.trim()) && Boolean(value.trim()))
      .map(([key, value]) => [key.trim(), value] as const)
    if (entries.length) updated.symbolTextOverrides = Object.fromEntries(entries)
    else delete updated.symbolTextOverrides
  }

  if (typeof payload.x !== 'number' && typeof payload.y !== 'number') return updated
  const bounds = shapeBounds(updated)
  const currentX = bounds.x + bounds.width / 2
  const currentY = bounds.y + bounds.height / 2
  return translateShape(
    updated,
    (typeof payload.x === 'number' ? payload.x : currentX) - currentX,
    (typeof payload.y === 'number' ? payload.y : currentY) - currentY
  )
}

export const updateSelectionProperties = (
  shapes: readonly Shape[],
  payload: SelectionPropertyUpdate,
  context: SelectionUpdateContext
): Shape[] | null => {
  const targetIds = context.selectedIds.size
    ? new Set(context.selectedIds)
    : context.selectedId
      ? new Set([context.selectedId])
      : new Set<string>()
  if (!targetIds.size) return null

  const center = selectionCenter(shapes, targetIds)
  const bindingId = normalizedBindingId(payload)
  let changed = false
  const next = shapes.map((shape) => {
    if (!targetIds.has(shape.id)) return shape
    changed = true
    return applyProperties(shape, payload, center, bindingId, context)
  })
  return changed ? next : null
}
