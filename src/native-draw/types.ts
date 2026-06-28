export type Tool =
  | 'select'
  | 'wall'
  | 'line'
  | 'door'
  | 'window'
  | 'gate'
  | 'rect'
  | 'circle'
  | 'arc'
  | 'text'
  | 'symbol'
  | 'onewire'

export type Point = { x: number; y: number }

export type LineShape = {
  id: string
  kind: 'wall' | 'line' | 'door' | 'window' | 'gate'
  start: Point
  end: Point
  flipSide?: boolean
  stroke?: string
  bindingId?: string
  groupId?: string
}

export type RectShape = {
  id: string
  kind: 'rect'
  start: Point
  end: Point
  variant?: 'rect' | 'circle' | 'arc'
  rotation?: number
  fill?: string
  stroke?: string
  bindingId?: string
  groupId?: string
}

export type TextShape = {
  id: string
  kind: 'text'
  position: Point
  text: string
  rotation?: number
  fill?: string
  stroke?: string
  flipX?: boolean
  flipY?: boolean
  bindingId?: string
  groupId?: string
}

export type SymbolShape = {
  id: string
  kind: 'symbol'
  position: Point
  name: string
  path: string
  scale: number
  rotation?: number
  fill?: string
  stroke?: string
  flipX?: boolean
  flipY?: boolean
  bindingId?: string
  groupId?: string
}

export type ImageShape = {
  id: string
  kind: 'image'
  position: Point
  name: string
  path: string
  width: number
  height: number
  rotation?: number
  fill?: string
  stroke?: string
  flipX?: boolean
  flipY?: boolean
  bindingId?: string
  groupId?: string
}

export type Shape = LineShape | RectShape | TextShape | SymbolShape | ImageShape
export type DraftShape = LineShape | RectShape

export type NativeCatalogPick = {
  name: string
  path: string
  metadata?: Record<string, unknown>
}

export type Snapshot = {
  shapes: Shape[]
  selectedId: string | null
  worldWidth: number
  worldHeight: number
}

export type DragState = {
  ids: string[]
  pointerStart: Point
  initial: Shape[]
}

export type PaperPreset = 'a4-portrait' | 'a4-landscape' | 'a3-portrait' | 'a3-landscape'
