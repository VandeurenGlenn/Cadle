import type { Shape } from '../../editor/model/types.js'
import { shapeBounds } from '../../editor/model/model.js'
import { getCachedSymbolSvg, listEditableSymbolTextFields } from '../symbol-svg-cache.js'
import { symbolTextFieldsFor } from '../symbol-metadata.js'
import { connectionSegments, CONNECTION_NAMES, type ElectricalConnection } from '../model/electrical-connection.js'
import { renderedSymbolScale } from '../model/symbol-scale.js'
import { heatingLayout, type HeatingData, type HeatingLayout } from '../heating-plan.js'
import { DEFAULT_SYMBOL_STROKE_WIDTH } from '../../preferences/symbol-stroke-width.js'
import { electricalMetadataFromCatalog, type ElectricalDeviceMetadata } from '../../editor/model/electrical.js'

export type NativeSelectionSymbolTextField = {
  key: string
  label: string
  value: string
}

export type NativeSelectionShapePayload = {
  roomLabel?: import('../room-labels.js').RoomLabelData
  heating?: HeatingData
  heatingLayout?: HeatingLayout
  dimensions?: { drawingScale?: number | null; length?: number; width?: number; height?: number; strokeWidth?: number }
  connection?: ElectricalConnection
  id: string
  kind: string
  text?: string
  path?: string
  symbolTextFields?: NativeSelectionSymbolTextField[]
  electrical?: ElectricalDeviceMetadata
  circuitPropertiesEditable?: boolean
  bindingId?: string
  bindingLabelOffset?: { x: number; y: number }
  name?: string
  isRoom?: boolean
  roomName?: string
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
  busbarLength?: number
  fontFamily?: string
  letterSpacing?: number
  x?: number
  y?: number
}

const defaultStrokeWidthForShape = (shape: Shape): number | null => {
  switch (shape.kind) {
    case 'wall':
      return 8
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
  canConvertToRoom?: boolean
  shape?: NativeSelectionShapePayload
}

export const createNativeSelectionChangedPayload = (
  selectedShape: Shape | null,
  selectedIdsCount: number,
  options?: {
    kindOverride?: string
    bindingIdOverride?: string
    electricalOverride?: ElectricalDeviceMetadata
    circuitPropertiesEditable?: boolean
    hideSymbolTextFields?: boolean
    canConvertToRoom?: boolean
    drawingScale?: number | null
    symbolStrokeWidthPreference?: number
  }
): NativeSelectionChangedPayload => {
  const selectionCount = selectedIdsCount > 0 ? selectedIdsCount : selectedShape ? 1 : 0
  if (selectionCount !== 1 || !selectedShape) {
    return {
      selectionCount,
      canConvertToRoom: options?.canConvertToRoom === true,
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
  if (selectedShape.kind === 'rect' && selectedShape.heating) {
    shapePayload.heating = selectedShape.heating
    shapePayload.heatingLayout = heatingLayout(selectedShape)
    shapePayload.name = selectedShape.heating.kind === 'zone' ? 'Verwarmingszone' : selectedShape.heating.kind === 'pipe' ? 'Verwarmingsbuis' : 'Verdeler'
  }
  if (selectedShape.kind === 'line' && selectedShape.connection) {
    shapePayload.connection = { ...selectedShape.connection }
    shapePayload.name = CONNECTION_NAMES[selectedShape.connection.kind]
  }
  if (selectedShape.kind === 'text') {
    shapePayload.text = selectedShape.text
    if (selectedShape.roomLabel) shapePayload.roomLabel = { ...selectedShape.roomLabel }
  }
  if (selectedShape.kind === 'symbol') {
    shapePayload.path = selectedShape.path
    const sourceElectrical =
      options?.electricalOverride ??
      selectedShape.electrical ??
      electricalMetadataFromCatalog(undefined, selectedShape.name, selectedShape.path)
    if (sourceElectrical.oneWireEligible || selectedShape.bindingId) {
      shapePayload.electrical = options?.circuitPropertiesEditable
        ? { ...sourceElectrical }
        : {
            role: sourceElectrical.role,
            oneWireEligible: sourceElectrical.oneWireEligible,
            circuitType: sourceElectrical.circuitType,
            ratedCurrentA: sourceElectrical.ratedCurrentA,
            manufacturer: sourceElectrical.manufacturer,
            neutralPosition: sourceElectrical.neutralPosition,
            productSeries: sourceElectrical.productSeries,
            productReference: sourceElectrical.productReference
          }
    }
    shapePayload.circuitPropertiesEditable = options?.circuitPropertiesEditable === true
    const isProtectionSymbol = /automaat|breaker|protection devices/i.test(
      `${selectedShape.name} ${selectedShape.path}`
    )
    const editableFields =
      isProtectionSymbol
        ? symbolTextFieldsFor(selectedShape.path).filter((field) => field.key === 'description')
            .map((field) => ({ key: field.key, label: field.label, value: field.defaultValue }))
        : options?.hideSymbolTextFields ? [] : listEditableSymbolTextFields(selectedShape.path)
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
  if (selectedShape.kind === 'wall' && selectedShape.groupId?.startsWith('room-')) {
    shapePayload.isRoom = true
    shapePayload.roomName = selectedShape.roomName ?? ''
  }
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
  if (selectedShape.kind === 'line' && selectedShape.groupId?.startsWith('onewire-kamrail-')) {
    shapePayload.busbarLength = Math.hypot(
      selectedShape.end.x - selectedShape.start.x,
      selectedShape.end.y - selectedShape.start.y
    )
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
  if (options?.kindOverride !== 'group' && selectedShape.kind !== 'text') {
    const strokeWidth = typeof selectedShape.strokeWidth === 'number' ? selectedShape.strokeWidth : defaultStrokeWidth
    if (['wall', 'line', 'door', 'window', 'gate'].includes(selectedShape.kind) && 'start' in selectedShape) {
      const segments = selectedShape.kind === 'line' ? connectionSegments(selectedShape)
        : [{ start: selectedShape.start, end: selectedShape.end }]
      shapePayload.dimensions = { length: segments.reduce((length, segment) =>
        length + Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y), 0),
        ...(strokeWidth !== null ? { strokeWidth } : {}) }
    } else {
      let width = bounds.width, height = bounds.height
      let pen = strokeWidth
      if (selectedShape.kind === 'symbol') {
        const size = 24 * renderedSymbolScale(selectedShape.path, selectedShape.scale)
        const viewBox = getCachedSymbolSvg(selectedShape.path)?.viewBox.trim().split(/[\s,]+/).map(Number)
        if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
          const factor = size / Math.max(viewBox[2], viewBox[3])
          width = viewBox[2] * factor; height = viewBox[3] * factor
          pen = typeof selectedShape.strokeWidth === 'number' ? selectedShape.strokeWidth * factor
            : options?.symbolStrokeWidthPreference ?? DEFAULT_SYMBOL_STROKE_WIDTH
        } else pen = options?.symbolStrokeWidthPreference ?? DEFAULT_SYMBOL_STROKE_WIDTH
      }
      shapePayload.dimensions = { width, height,
        ...(pen !== null && selectedShape.kind !== 'image' ? { strokeWidth: pen } : {}) }
    }
  }
  if (shapePayload.dimensions && options?.drawingScale !== undefined && selectedShape.kind !== 'symbol' && selectedShape.heating?.kind !== 'table') {
    shapePayload.dimensions.drawingScale = options.drawingScale
  }
  shapePayload.x = bounds.x + bounds.width / 2
  shapePayload.y = bounds.y + bounds.height / 2

  return {
    selectionCount,
    canConvertToRoom: options?.canConvertToRoom === true,
    shape: shapePayload
  }
}
