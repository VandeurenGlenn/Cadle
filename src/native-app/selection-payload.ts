import type { Shape } from '../native-draw/types.js'

export type NativeSelectionShapePayload = {
  id: string
  kind: string
  bindingId?: string
  name?: string
  canFlip?: boolean
  flipSide?: boolean
  rotation?: number
  fill?: string
  stroke?: string
}

export type NativeSelectionChangedPayload = {
  selectionCount: number
  shape?: NativeSelectionShapePayload
}

export const createNativeSelectionChangedPayload = (
  selectedShape: Shape | null,
  selectedIdsCount: number
): NativeSelectionChangedPayload => {
  const selectionCount = selectedIdsCount > 0 ? selectedIdsCount : selectedShape ? 1 : 0
  if (selectionCount !== 1 || !selectedShape) {
    return {
      selectionCount,
      shape: undefined
    }
  }

  const shapePayload: NativeSelectionShapePayload = {
    id: selectedShape.id,
    kind: selectedShape.kind
  }
  if ('bindingId' in selectedShape && selectedShape.bindingId) shapePayload.bindingId = selectedShape.bindingId
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
  }
  if ('fill' in selectedShape) shapePayload.fill = typeof selectedShape.fill === 'string' ? selectedShape.fill : ''
  if ('stroke' in selectedShape)
    shapePayload.stroke = typeof selectedShape.stroke === 'string' ? selectedShape.stroke : ''

  return {
    selectionCount,
    shape: shapePayload
  }
}
