import type { OneWirePresetConfig } from './constants.js'
import { buildOneWireCircuit } from './onewire-builder.js'
import { resolveSelectPointerDown } from './pointer-select.js'
import { resolveWallChainClick, type WallChain } from './wall-chain.js'
import type { DragState, LineShape, Point, Shape } from '../native-draw/types.js'

export type ResolveOneWirePointerDownInput = {
  button: number
  point: Point
  bindingId: string
  preset: OneWirePresetConfig
  nextId: () => string
  breakerWidth: number
  nodeSize: number
  nextBindingId: (current: string) => string
}

export type ResolveOneWirePointerDownResult = {
  shapes: Shape[]
  selectedIds: Set<string>
  selectedId: string | null
  nextBindingId: string
}

export const resolveOneWirePointerDown = (
  input: ResolveOneWirePointerDownInput
): ResolveOneWirePointerDownResult | null => {
  if (input.button !== 0) return null
  const circuit = buildOneWireCircuit(
    input.point,
    input.bindingId,
    input.preset,
    input.nextId,
    input.breakerWidth,
    input.nodeSize
  )
  return {
    shapes: circuit.shapes,
    selectedIds: new Set(circuit.primarySelection),
    selectedId: circuit.primarySelection[0] ?? null,
    nextBindingId: input.nextBindingId(input.bindingId)
  }
}

export type ResolveSelectPointerDownStateInput = {
  shapeId: string | null
  rawPoint: Point
  selectedIds: Set<string>
  selectedId: string | null
  shapes: Shape[]
  pointerId: number
}

export type ResolveSelectPointerDownStateResult = {
  selectedIds: Set<string>
  selectedId: string | null
  drag: DragState | null
  bandStart: Point | null
  bandEnd: Point | null
  stagePointerId: number
}

export const resolveSelectPointerDownState = (
  input: ResolveSelectPointerDownStateInput
): ResolveSelectPointerDownStateResult => {
  const result = resolveSelectPointerDown({
    shapeId: input.shapeId,
    rawPoint: input.rawPoint,
    selectedIds: input.selectedIds,
    selectedId: input.selectedId,
    shapes: input.shapes
  })
  return {
    ...result,
    stagePointerId: input.pointerId
  }
}

export type ResolveWallPointerDownInput = {
  button: number
  point: Point
  snapped: boolean
  now: number
  lastWallClickTime: number
  lastWallClickPoint: Point | null
  wallChain: WallChain
  nextId: () => string
}

export type ResolveWallPointerDownResult = {
  snapTarget: Point | null
  lastWallClickTime: number
  lastWallClickPoint: Point | null
  wallChain: WallChain
  chainPreviewEnd: Point | null
  committedWall: LineShape | null
}

export const resolveWallPointerDown = (input: ResolveWallPointerDownInput): ResolveWallPointerDownResult | null => {
  if (input.button !== 0) return null
  const result = resolveWallChainClick({
    point: input.point,
    snapped: input.snapped,
    now: input.now,
    lastWallClickTime: input.lastWallClickTime,
    lastWallClickPoint: input.lastWallClickPoint,
    wallChain: input.wallChain,
    nextId: input.nextId
  })
  return {
    snapTarget: result.snapTarget,
    lastWallClickTime: result.lastWallClickTime,
    lastWallClickPoint: result.lastWallClickPoint,
    wallChain: result.wallChain,
    chainPreviewEnd: result.chainPreviewEnd,
    committedWall: result.committedWall
  }
}
