export type BindingLabelSide = 'auto' | 'left' | 'right' | 'top' | 'bottom'

export type SymbolTextField = {
  key: string
  label: string
  value: string
}

export type SelectionShapeElectrical = NonNullable<SelectionShape['electrical']>

export type SelectionShape = {
  id?: string
  kind?: string
  text?: string
  symbolTextFields?: SymbolTextField[]
  bindingId?: string
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
  bindingLabelOffset?: { x: number; y: number }
  electrical?: {
    role?: string
    circuitType?: string
    breakerCurrentA?: number
    cableSectionMm2?: number
    poles?: number
    phaseConfiguration?: string
  }
}

export type SelectionPayload = {
  selectionCount?: number
  shape?: SelectionShape
}

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const inferBindingLabelSide = (offset: { x: number; y: number } | null): BindingLabelSide => {
  if (!offset) return 'auto'
  if (Math.abs(offset.x) >= Math.abs(offset.y)) return offset.x < 0 ? 'left' : 'right'
  return offset.y < 0 ? 'top' : 'bottom'
}

export const normalizeSelection = (payload: SelectionPayload) => {
  const selectionCount = Number.isFinite(payload?.selectionCount) ? Number(payload.selectionCount) : 0
  const shape = payload?.shape
  if (!shape) return { selectionCount, shape: null }

  const kind = typeof shape.kind === 'string' ? shape.kind : 'shape'
  const symbolTextFields = Array.isArray(shape.symbolTextFields)
    ? shape.symbolTextFields
        .filter(
          (field): field is SymbolTextField =>
            Boolean(field) &&
            typeof field === 'object' &&
            typeof field.key === 'string' &&
            typeof field.label === 'string' &&
            typeof field.value === 'string'
        )
        .map((field) => ({ ...field }))
    : []

  return {
    selectionCount,
    shape: {
      id: typeof shape.id === 'string' ? shape.id : '',
      kind,
      label: kind.charAt(0).toUpperCase() + kind.slice(1),
      bindingId: typeof shape.bindingId === 'string' ? shape.bindingId : '',
      name: typeof shape.name === 'string' ? shape.name : '',
      text: typeof shape.text === 'string' ? shape.text : '',
      symbolTextFields,
      canFlip: shape.canFlip === true,
      flipSide: shape.flipSide === true,
      flipX: typeof shape.flipX === 'boolean' ? shape.flipX : null,
      flipY: typeof shape.flipY === 'boolean' ? shape.flipY : null,
      rotation: finiteNumber(shape.rotation),
      scale: finiteNumber(shape.scale),
      fill: typeof shape.fill === 'string' ? shape.fill : '',
      stroke: typeof shape.stroke === 'string' ? shape.stroke : '',
      canSetStrokeWidth: shape.canSetStrokeWidth === true,
      strokeWidth: finiteNumber(shape.strokeWidth),
      x: finiteNumber(shape.x),
      y: finiteNumber(shape.y),
      fontFamily: typeof shape.fontFamily === 'string' ? shape.fontFamily : '',
      letterSpacing: finiteNumber(shape.letterSpacing),
      bindingLabelSide: inferBindingLabelSide(shape.bindingLabelOffset ?? null),
      electrical: shape.electrical && typeof shape.electrical === 'object' ? { ...shape.electrical } : null
    }
  }
}
