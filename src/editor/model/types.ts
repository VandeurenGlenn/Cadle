import type { ElectricalConnection } from './electrical-connection.js'

export type Tool =
  | 'select'
  | 'room-label'
  | 'wall'
  | 'room'
  | 'line'
  | 'door'
  | 'sliding-door'
  | 'window'
  | 'sliding-window'
  | 'gate'
  | 'rect'
  | 'built-in-cabinet'
  | StairVariant
  | 'circle'
  | 'arc'
  | 'roof-left'
  | 'roof-straight'
  | 'roof-right'
  | 'text'
  | 'symbol'
  | 'onewire'
  | 'heating-zone'
  | 'heating-exclusion'
  | 'heating-pipe'
  | 'heating-manifold'

export type Point = { x: number; y: number }

export type RoofVariant = 'roof-left' | 'roof-straight' | 'roof-right'
export type RoofPattern = 'none' | 'tiles' | 'slates' | 'standing-seam'
export type StairVariant = 'stairs-straight' | 'stairs-quarter-turn' | 'stairs-double-quarter-turn' | 'stairs-spiral'

export type OneWireSourceLink = {
  kind: 'board' | 'circuit' | 'device'
  id: string
  role: string
}

type GeneratedShapeMetadata = {
  roomName?: string
  heatingObstacle?: boolean
  heating?: import('../heating-plan.js').HeatingData
  generationKey?: string
  sourceLink?: OneWireSourceLink
  oneWireRailId?: string
  oneWireSourceSignature?: string
  hidden?: boolean
  locked?: boolean
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
  doorStyle?: 'sliding'
  windowStyle?: 'sliding'
  stroke?: string
  strokeWidth?: number
  energyFlow?: 'forward' | 'reverse' | 'bidirectional'
  energySource?: 'default' | 'generator' | 'mixed'
  connection?: ElectricalConnection
  bindingId?: string
  groupId?: string
  bindingLabelOffset?: { x: number; y: number }
}

export type RectShape = GeneratedShapeMetadata & {
  id: string
  kind: 'rect'
  start: Point
  end: Point
  variant?: 'rect' | 'circle' | 'arc' | 'built-in-cabinet' | RoofVariant | StairVariant
  roofPattern?: RoofPattern
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
  roomLabel?: import('../room-labels.js').RoomLabelData
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
  fontWeight?: number
  letterSpacing?: number
  textAnchor?: 'start' | 'middle' | 'end'
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
  circuitSpecifications?: import('../../types.js').Project['circuitSpecifications']
  heatingSchedulePages?: import('../../types.js').Project['pages']
  drawingScale?: import('../layout/drawing-scale.js').DrawingScale | null
  shapes: Shape[]
  selectedId: string | null
  worldWidth: number
  worldHeight: number
  overflowPages?: import('../../types.js').Project['pages']
}

export type DragState = {
  ids: string[]
  pointerStart: Point
  initial: Shape[]
  connectionInitial?: Shape[]
}

export type PaperPreset = 'a4-portrait' | 'a4-landscape' | 'a3-portrait' | 'a3-landscape'
import type { ElectricalDeviceMetadata } from './electrical.js'
