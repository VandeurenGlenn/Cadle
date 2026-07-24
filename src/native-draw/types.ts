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

export type OneWireSourceLink = {
  kind: 'board' | 'circuit' | 'device'
  id: string
  role: string
}

type GeneratedShapeMetadata = {
  generationKey?: string
  sourceLink?: OneWireSourceLink
}

export type LineShape = GeneratedShapeMetadata & {
  id: string
  kind: 'wall' | 'line' | 'door' | 'window' | 'gate'
  start: Point
  end: Point
  scale?: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  wallId?: string
  flipSide?: boolean
  stroke?: string
  strokeWidth?: number
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
}

export type RectShape = GeneratedShapeMetadata & {
  id: string
  kind: 'rect'
  start: Point
  end: Point
  variant?: 'rect' | 'circle' | 'arc'
  scale?: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  fill?: string
  stroke?: string
  strokeWidth?: number
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
}

export type TextShape = GeneratedShapeMetadata & {
  id: string
  kind: 'text'
  position: Point
  text: string
  scale?: number
  rotation?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  flipX?: boolean
  flipY?: boolean
  fontFamily?: string
  letterSpacing?: number
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
}

export type SymbolShape = GeneratedShapeMetadata & {
  id: string
  kind: 'symbol'
  position: Point
  name: string
  path: string
  scale: number
  symbolTextOverrides?: Record<string, string>
  electrical?: ElectricalDeviceMetadata
  rotation?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  flipX?: boolean
  flipY?: boolean
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
  catalogShapes?: Shape[]
}

export type ImageShape = GeneratedShapeMetadata & {
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
  strokeWidth?: number
  flipX?: boolean
  flipY?: boolean
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
}

export type Shape = LineShape | RectShape | TextShape | SymbolShape | ImageShape
export type DraftShape = LineShape | RectShape

export type NativeCatalogPick = {
  name: string
  path: string
  metadata?: Record<string, unknown>
  shapes?: Shape[]
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
import type { ElectricalDeviceMetadata } from './electrical.js'
