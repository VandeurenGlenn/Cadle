import { cloneShape, shapeBounds } from '../../editor/model/model.js'
import type { LineShape, Point, Shape } from '../../editor/model/types.js'
import { bindingLabelOffset, type BindingLabelSide } from '../layout/symbol-layout.js'
import { translateShape } from './shape-transforms.js'
import { GRID_SIZE } from '../constants.js'
import {
  inferCircuitType,
  inferElectricalRole,
  phaseConfigurationLabel,
  neutralPositionForManufacturer,
  rcdTypeLabel,
  shouldShowPhaseLabel,
  type ElectricalDeviceMetadata
} from '../../editor/model/electrical.js'

const phaseLabel = phaseConfigurationLabel

export type SelectionPropertyUpdate = {
  text?: string
  symbolTextOverrides?: Record<string, string>
  bindingId?: string
  roomName?: string
  bindingLabelSide?: BindingLabelSide | 'auto'
  rotation?: number
  scale?: number
  flipX?: boolean
  flipY?: boolean
  fill?: string
  stroke?: string
  strokeWidth?: number
  busbarLength?: number
  fontFamily?: string
  letterSpacing?: number
  x?: number
  y?: number
  electrical?: Partial<{ [K in keyof ElectricalDeviceMetadata]: ElectricalDeviceMetadata[K] | null }>
}

export type SelectionUpdateContext = {
  selectedIds: ReadonlySet<string>
  selectedId: string | null
  groupedSelection: boolean
}

const isLineShape = (shape: Shape): shape is LineShape =>
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

const shapeRotation = (shape: Shape): number => {
  if (isLineShape(shape)) {
    if (typeof shape.rotation === 'number') return shape.rotation
    return ((Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x) * 180) / Math.PI + 360) % 360
  }
  return 'rotation' in shape && typeof shape.rotation === 'number' ? shape.rotation : 0
}

const rotatePointAround = (point: Point, center: Point, deltaDegrees: number): Point => {
  const radians = (deltaDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  }
}

const rotateShapeAround = (shape: Shape, center: Point, deltaDegrees: number): Shape => {
  const rotation = (((shapeRotation(shape) + deltaDegrees) % 360) + 360) % 360
  if (isLineShape(shape)) {
    return {
      ...shape,
      start: rotatePointAround(shape.start, center, deltaDegrees),
      end: rotatePointAround(shape.end, center, deltaDegrees),
      rotation
    }
  }
  if (shape.kind === 'rect') {
    const width = Math.abs(shape.end.x - shape.start.x)
    const height = Math.abs(shape.end.y - shape.start.y)
    const currentCenter = {
      x: (shape.start.x + shape.end.x) / 2,
      y: (shape.start.y + shape.end.y) / 2
    }
    const nextCenter = rotatePointAround(currentCenter, center, deltaDegrees)
    return {
      ...shape,
      start: { x: nextCenter.x - width / 2, y: nextCenter.y - height / 2 },
      end: { x: nextCenter.x + width / 2, y: nextCenter.y + height / 2 },
      rotation
    }
  }
  return {
    ...shape,
    position: rotatePointAround(shape.position, center, deltaDegrees),
    rotation
  }
}

const mirrorPointAround = (point: Point, center: Point, axis: 'X' | 'Y'): Point =>
  axis === 'X' ? { x: center.x * 2 - point.x, y: point.y } : { x: point.x, y: center.y * 2 - point.y }

const mirrorShapeAround = (shape: Shape, center: Point, axis: 'X' | 'Y'): Shape => {
  const property = `flip${axis}` as 'flipX' | 'flipY'
  if (isLineShape(shape)) {
    const start = mirrorPointAround(shape.start, center, axis)
    const end = mirrorPointAround(shape.end, center, axis)
    const rotation = ((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI + 360) % 360
    return {
      ...shape,
      start,
      end,
      rotation,
      ...(shape.kind === 'door' || shape.kind === 'gate' ? { flipSide: !shape.flipSide || undefined } : {}),
      [property]: !shape[property] || undefined
    }
  }
  if (shape.kind === 'rect') {
    const width = Math.abs(shape.end.x - shape.start.x)
    const height = Math.abs(shape.end.y - shape.start.y)
    const currentCenter = {
      x: (shape.start.x + shape.end.x) / 2,
      y: (shape.start.y + shape.end.y) / 2
    }
    const nextCenter = mirrorPointAround(currentCenter, center, axis)
    return {
      ...shape,
      start: { x: nextCenter.x - width / 2, y: nextCenter.y - height / 2 },
      end: { x: nextCenter.x + width / 2, y: nextCenter.y + height / 2 },
      [property]: !shape[property] || undefined
    }
  }
  return {
    ...shape,
    position: mirrorPointAround(shape.position, center, axis),
    [property]: !shape[property] || undefined
  }
}

const normalizedBindingId = (payload: SelectionPropertyUpdate): string | undefined => {
  if (!('bindingId' in payload) || typeof payload.bindingId !== 'string') return undefined
  const value = payload.bindingId.trim().toUpperCase()
  return value && value !== 'UNDEFINED' && value !== 'NULL' ? value : undefined
}

const isSharedLightingPointSelection = (shapes: readonly Shape[], targetIds: ReadonlySet<string>): boolean => {
  let hasSwitch = false
  let hasLightingLoad = false
  for (const shape of shapes) {
    if (!targetIds.has(shape.id)) continue
    if (shape.kind !== 'symbol' && shape.kind !== 'image') return false
    const inferredRole = inferElectricalRole(shape.name, shape.path)
    const role =
      shape.kind === 'symbol' && shape.electrical?.role && shape.electrical.role !== 'neutral'
        ? shape.electrical.role
        : inferredRole
    const circuitType =
      shape.kind === 'symbol'
        ? (shape.electrical?.circuitType ?? inferCircuitType(shape.name, shape.path))
        : inferCircuitType(shape.name, shape.path)
    if (role === 'switch') hasSwitch = true
    else if (role === 'load' && circuitType === 'lighting') hasLightingLoad = true
    else return false
  }
  return hasSwitch && hasLightingLoad
}

const sequentialBindingIds = (
  shapes: readonly Shape[],
  targetIds: ReadonlySet<string>,
  bindingId: string | undefined,
  groupedSelection: boolean
): Map<string, string> | null => {
  if (!bindingId || groupedSelection || targetIds.size < 2) return null
  if (isSharedLightingPointSelection(shapes, targetIds)) {
    return new Map(shapes.filter((shape) => targetIds.has(shape.id)).map((shape) => [shape.id, bindingId]))
  }
  const match = /^(.*?)(\d+)?$/.exec(bindingId)
  const prefix = match?.[1] || bindingId
  const start = match?.[2] ? Number(match[2]) : 1
  const result = new Map<string, string>()
  let index = 0
  // Document order is stable and matches the drawing's stacking order.
  for (const shape of shapes) {
    if (!targetIds.has(shape.id)) continue
    result.set(shape.id, `${prefix}${start + index}`)
    index += 1
  }
  return result
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
  if ('roomName' in payload && updated.kind === 'wall' && updated.groupId?.startsWith('room-')) {
    const roomName = typeof payload.roomName === 'string' ? payload.roomName.trim() : ''
    if (roomName) updated.roomName = roomName
    else delete updated.roomName
  }

  if (payload.bindingLabelSide === 'auto') delete updated.bindingLabelOffset
  else if (payload.bindingLabelSide) updated.bindingLabelOffset = bindingLabelOffset(updated, payload.bindingLabelSide)

  if (typeof payload.rotation === 'number' && (!context.groupedSelection || center === null)) {
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
    } else if (
      updated.kind === 'symbol' ||
      updated.kind === 'image' ||
      updated.kind === 'text' ||
      updated.kind === 'rect'
    ) {
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
    if (context.groupedSelection && center !== null) continue
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
      line.rotation = ((Math.atan2(line.end.y - line.start.y, line.end.x - line.start.x) * 180) / Math.PI + 360) % 360
      if (line.kind === 'door' || line.kind === 'gate') line.flipSide = !line.flipSide || undefined
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
  if (
    typeof payload.busbarLength === 'number' &&
    updated.kind === 'line' &&
    updated.groupId?.startsWith('onewire-kamrail-')
  ) {
    const dx = updated.end.x - updated.start.x
    const dy = updated.end.y - updated.start.y
    const currentLength = Math.hypot(dx, dy)
    if (currentLength > 0) {
      const nextLength = Math.max(GRID_SIZE * 4, Math.round(payload.busbarLength / GRID_SIZE) * GRID_SIZE)
      const half = nextLength / 2
      const centerX = (updated.start.x + updated.end.x) / 2
      const centerY = (updated.start.y + updated.end.y) / 2
      const ux = dx / currentLength
      const uy = dy / currentLength
      updated.start = { x: centerX - ux * half, y: centerY - uy * half }
      updated.end = { x: centerX + ux * half, y: centerY + uy * half }
    }
  }
  if (typeof payload.text === 'string' && updated.kind === 'text') updated.text = payload.text
  if (typeof payload.fontFamily === 'string' && updated.kind === 'text') {
    if (payload.fontFamily) updated.fontFamily = payload.fontFamily
    else delete updated.fontFamily
  }
  if (typeof payload.letterSpacing === 'number' && updated.kind === 'text')
    updated.letterSpacing = payload.letterSpacing

  if (payload.symbolTextOverrides && updated.kind === 'symbol') {
    const entries = Object.entries(payload.symbolTextOverrides)
      .filter(([key, value]) => Boolean(key.trim()) && Boolean(value.trim()))
      .map(([key, value]) => [key.trim(), value] as const)
    if (entries.length) updated.symbolTextOverrides = Object.fromEntries(entries)
    else delete updated.symbolTextOverrides
  }

  if (payload.electrical && updated.kind === 'symbol') {
    const electrical = { ...(updated.electrical ?? { role: 'neutral' as const, oneWireEligible: true }) }
    for (const [key, value] of Object.entries(payload.electrical)) {
      if (value === null || value === undefined) delete (electrical as Record<string, unknown>)[key]
      else (electrical as Record<string, unknown>)[key] = value
    }
    updated.electrical = electrical
    if (/automaat|breaker|protection devices/i.test(`${updated.name} ${updated.path}`)) {
      const isResidualBreaker = /residual-current|differential|differentieel|\brcd\b/i.test(
        `${updated.name} ${updated.path}`
      )
      const showProtectionPhase =
        shouldShowPhaseLabel(electrical.poles, electrical.showPhaseLabel) && Boolean(electrical.phaseConfiguration)
      updated.symbolTextOverrides = {
        ...(updated.symbolTextOverrides ?? {}),
        ...(typeof electrical.poles === 'number' ? { poles: `${electrical.poles}P` } : {}),
        phase: showProtectionPhase
          ? phaseLabel(
              electrical.phaseConfiguration as NonNullable<typeof electrical.phaseConfiguration>,
              electrical.neutralPosition ?? neutralPositionForManufacturer(electrical.manufacturer) ?? 'right'
            )
          : '',
        'rated-current':
          typeof electrical.breakerCurrentA === 'number'
            ? `${!isResidualBreaker && electrical.breakerCurve ? electrical.breakerCurve : ''}${electrical.breakerCurrentA}A`
            : '',
        ...(isResidualBreaker
          ? {
              'residual-current':
                typeof electrical.rcdSensitivityMa === 'number' ? `${electrical.rcdSensitivityMa}mA` : '',
              'rcd-type': rcdTypeLabel(electrical.rcdType)
            }
          : {})
      }
    }
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
  const primaryShape = shapes.find((shape) => shape.id === context.selectedId && targetIds.has(shape.id))
  const groupedRotation =
    context.groupedSelection && center && primaryShape && typeof payload.rotation === 'number'
      ? payload.rotation - shapeRotation(primaryShape)
      : null
  const groupedMirrorAxes =
    center && primaryShape && context.groupedSelection
      ? (['X', 'Y'] as const).filter((axis) => {
          const property = `flip${axis}` as 'flipX' | 'flipY'
          return typeof payload[property] === 'boolean' && payload[property] !== (primaryShape[property] === true)
        })
      : []
  const bindingId = normalizedBindingId(payload)
  const bindingIds = sequentialBindingIds(shapes, targetIds, bindingId, context.groupedSelection)
  let changed = false
  const next = shapes.map((shape) => {
    if (!targetIds.has(shape.id)) return shape
    changed = true
    return applyProperties(shape, payload, center, bindingIds?.get(shape.id) ?? bindingId, context)
  })
  if (!changed) return null
  if (!center) return next
  let transformed =
    groupedRotation === null
      ? next
      : next.map((shape) => (targetIds.has(shape.id) ? rotateShapeAround(shape, center, groupedRotation) : shape))
  for (const axis of groupedMirrorAxes) {
    transformed = transformed.map((shape) => (targetIds.has(shape.id) ? mirrorShapeAround(shape, center, axis) : shape))
  }
  return transformed
}
