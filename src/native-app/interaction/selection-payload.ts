import type { Shape } from '../../native-draw/types.js'
import { shapeBounds } from '../../native-draw/model.js'
import { listEditableSymbolTextFields } from '../symbol-svg-cache.js'
import { electricalMetadataFromCatalog, type ElectricalDeviceMetadata } from '../../native-draw/electrical.js'

export type NativeSelectionSymbolTextField = {
  key: string
  label: string
  value: string
}

export type NativeSelectionShapePayload = {
  id: string
  kind: string
  text?: string
  path?: string
  symbolTextFields?: NativeSelectionSymbolTextField[]
  electrical?: ElectricalDeviceMetadata
  bindingId?: string
  bindingLabelOffset?: { x: number; y: number }
  name?: string
  canFlip?: boolean
  flipSide?: boolean
  flipX?: boolean
  flipY?: boolean
  rotation?: number
  scale?: number
  fill?: string
  stroke?: string
  canSetStrokeWidth?: boolean
  strokeWidth?: number
  fontFamily?: string
  letterSpacing?: number
  x?: number
  y?: number
}

const defaultStrokeWidthForShape = (shape: Shape): number | null => {
  switch (shape.kind) {
    case 'wall':
      return 12
    case 'line':
      return 2
    case 'door':
      return 3.5
    case 'window':
      return 12
    case 'gate':
      return 3.5
    case 'rect':
      return 2
    case 'text':
      return 1
    case 'symbol':
      return 1
    case 'image':
      return 1
    default:
      return null
  }
}

export type NativeSelectionChangedPayload = {
  selectionCount: number
  shape?: NativeSelectionShapePayload
}

export const createNativeSelectionChangedPayload = (
  selectedShape: Shape | null,
  selectedIdsCount: number,
  options?: {
    kindOverride?: string
    bindingIdOverride?: string
    electricalOverride?: ElectricalDeviceMetadata
    hideSymbolTextFields?: boolean
  }
): NativeSelectionChangedPayload => {
  const selectionCount = selectedIdsCount > 0 ? selectedIdsCount : selectedShape ? 1 : 0
  if (selectionCount !== 1 || !selectedShape) {
    return {
      selectionCount,
      shape: undefined
    }
  }

  const kind =
    options?.kindOverride ??
    (selectedShape.kind === 'rect' && selectedShape.variant ? selectedShape.variant : selectedShape.kind)

  const shapePayload: NativeSelectionShapePayload = {
    id: selectedShape.id,
    kind
  }
  if (selectedShape.kind === 'text') shapePayload.text = selectedShape.text
  if (selectedShape.kind === 'symbol') {
    shapePayload.path = selectedShape.path
    const sourceElectrical = options?.electricalOverride ?? selectedShape.electrical ?? electricalMetadataFromCatalog(undefined, selectedShape.name, selectedShape.path)
    if (sourceElectrical.oneWireEligible || selectedShape.bindingId) {
      const socketOrMotor = sourceElectrical.circuitType === 'sockets' || sourceElectrical.circuitType === 'motor' || sourceElectrical.circuitType === 'mixed'
      shapePayload.electrical = {
        ...sourceElectrical,
        breakerCurrentA: sourceElectrical.breakerCurrentA ?? (socketOrMotor ? 20 : 16),
        cableSectionMm2: sourceElectrical.cableSectionMm2 ?? (socketOrMotor ? 2.5 : 1.5),
        poles: sourceElectrical.poles ?? 2,
        phaseConfiguration: sourceElectrical.phaseConfiguration ?? 'single-phase',
        breakerCurve: sourceElectrical.breakerCurve ?? 'C',
        boardId: sourceElectrical.boardId ?? 'main',
        railId: sourceElectrical.railId ?? 'rail-1'
      }
    }
    const isProtectionSymbol = /automaat|breaker|protection devices/i.test(`${selectedShape.name} ${selectedShape.path}`)
    const editableFields = options?.hideSymbolTextFields || isProtectionSymbol ? [] : listEditableSymbolTextFields(selectedShape.path)
    if (editableFields.length) {
      const overrides = selectedShape.symbolTextOverrides ?? {}
      shapePayload.symbolTextFields = editableFields.map((field) => ({
        ...field,
        value: overrides[field.key] ?? field.value
      }))
    }
  }
  if (options?.bindingIdOverride) shapePayload.bindingId = options.bindingIdOverride
  else if ('bindingId' in selectedShape && selectedShape.bindingId) shapePayload.bindingId = selectedShape.bindingId
  if ('bindingLabelOffset' in selectedShape && selectedShape.bindingLabelOffset) {
    shapePayload.bindingLabelOffset = { ...selectedShape.bindingLabelOffset }
  }
  if (selectedShape.kind === 'symbol' || selectedShape.kind === 'image') shapePayload.name = selectedShape.name
  if (selectedShape.kind === 'door' || selectedShape.kind === 'gate') {
    shapePayload.canFlip = true
    shapePayload.flipSide = selectedShape.flipSide ?? false
  }
  // Always include rotation for shapes that support it so the pane always shows the control.
  if (
    selectedShape.kind === 'symbol' ||
    selectedShape.kind === 'image' ||
    selectedShape.kind === 'text' ||
    selectedShape.kind === 'rect'
  ) {
    shapePayload.rotation = typeof selectedShape.rotation === 'number' ? selectedShape.rotation : 0
    shapePayload.flipX = selectedShape.flipX === true
    shapePayload.flipY = selectedShape.flipY === true
  }
  if (
    selectedShape.kind === 'wall' ||
    selectedShape.kind === 'line' ||
    selectedShape.kind === 'door' ||
    selectedShape.kind === 'window' ||
    selectedShape.kind === 'gate'
  ) {
    const dx = selectedShape.end.x - selectedShape.start.x
    const dy = selectedShape.end.y - selectedShape.start.y
    const geometricRotation = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
    shapePayload.rotation = typeof selectedShape.rotation === 'number' ? selectedShape.rotation : geometricRotation
    shapePayload.flipX = selectedShape.flipX === true
    shapePayload.flipY = selectedShape.flipY === true
  }
  if (selectedShape.kind === 'symbol' || selectedShape.kind === 'text' || selectedShape.kind === 'rect') {
    shapePayload.scale = typeof selectedShape.scale === 'number' ? selectedShape.scale : 1
  }
  if (
    selectedShape.kind === 'wall' ||
    selectedShape.kind === 'line' ||
    selectedShape.kind === 'door' ||
    selectedShape.kind === 'window' ||
    selectedShape.kind === 'gate'
  ) {
    shapePayload.scale = typeof selectedShape.scale === 'number' ? selectedShape.scale : 1
  }
  if ('fill' in selectedShape) shapePayload.fill = typeof selectedShape.fill === 'string' ? selectedShape.fill : ''
  if ('stroke' in selectedShape)
    shapePayload.stroke = typeof selectedShape.stroke === 'string' ? selectedShape.stroke : ''
  const defaultStrokeWidth = defaultStrokeWidthForShape(selectedShape)
  if (defaultStrokeWidth !== null) {
    shapePayload.canSetStrokeWidth = true
    shapePayload.strokeWidth =
      typeof selectedShape.strokeWidth === 'number' ? selectedShape.strokeWidth : defaultStrokeWidth
  }
  if (selectedShape.kind === 'text') {
    if ('fontFamily' in selectedShape && typeof selectedShape.fontFamily === 'string') {
      shapePayload.fontFamily = selectedShape.fontFamily
    }
    if ('letterSpacing' in selectedShape && typeof selectedShape.letterSpacing === 'number') {
      shapePayload.letterSpacing = selectedShape.letterSpacing
    }
  }
  const bounds = shapeBounds(selectedShape)
  shapePayload.x = bounds.x + bounds.width / 2
  shapePayload.y = bounds.y + bounds.height / 2

  return {
    selectionCount,
    shape: shapePayload
  }
}
