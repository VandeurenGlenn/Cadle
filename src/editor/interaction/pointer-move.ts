import { dragEndpointSnapDelta, translateShape } from './shape-transforms.js'
import { oneWireSymbolNodeInfo } from '../layout/onewire-symbol-nodes.js'
import type { DraftShape, DragState, Point, Shape } from '../../editor/model/types.js'

export const updateSymbolPreviewPoint = (
  rawPoint: Point,
  currentPreview: Point | null,
  snapPoint: (point: Point) => Point,
  isSamePoint: (a: Point | null, b: Point | null) => boolean
): { changed: boolean; nextPreview: Point } => {
  const nextPreview = snapPoint(rawPoint)
  return {
    changed: !isSamePoint(currentPreview, nextPreview),
    nextPreview
  }
}

export const updateWallChainPreview = (
  rawPoint: Point,
  snapPoint: (point: Point) => Point,
  snapToEndpoints: (point: Point) => { point: Point; snapped: boolean }
): { chainPreviewEnd: Point; snapTarget: Point | null } => {
  const gridSnapped = snapPoint(rawPoint)
  const { point, snapped } = snapToEndpoints(gridSnapped)
  return {
    chainPreviewEnd: point,
    snapTarget: snapped ? point : null
  }
}

export const updateDraftShapeEnd = (
  draft: DraftShape,
  rawPoint: Point,
  snapPoint: (point: Point) => Point,
  keepAspectRatio = false
): DraftShape => {
  const snapped = snapPoint(rawPoint)
  if (draft.kind !== 'rect' || !keepAspectRatio) {
    return {
      ...draft,
      end: snapped
    }
  }

  const dx = snapped.x - draft.start.x
  const dy = snapped.y - draft.start.y
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  const xSign = dx === 0 ? (dy === 0 ? 1 : Math.sign(dy)) : Math.sign(dx)
  const ySign = dy === 0 ? (dx === 0 ? 1 : Math.sign(dx)) : Math.sign(dy)

  return {
    ...draft,
    end: {
      x: draft.start.x + xSign * size,
      y: draft.start.y + ySign * size
    }
  }
}

export const applyDragMove = (
  rawPoint: Point,
  drag: DragState,
  snapPoint: (point: Point) => Point,
  allShapes: Shape[]
): Shape[] => {
  const point = snapPoint(rawPoint)
  const pointerStart = snapPoint(drag.pointerStart)
  const dx = point.x - pointerStart.x
  const dy = point.y - pointerStart.y
  const movedShapes = drag.initial.map((initialShape) => translateShape(initialShape, dx, dy))
  const snapDelta = dragEndpointSnapDelta(movedShapes, new Set(drag.ids), allShapes)
  if (snapDelta) return movedShapes.map((shape) => translateShape(shape, snapDelta.x, snapDelta.y))

  const electricalSymbol = movedShapes.find((shape) => {
    if (shape.kind !== 'symbol') return false
    return (
      /protection devices|automaat|breaker|differential|differentieel|\brcd\b/i.test(`${shape.name} ${shape.path}`) &&
      oneWireSymbolNodeInfo(shape.path, shape.scale) !== null
    )
  })
  if (electricalSymbol?.kind !== 'symbol') return movedShapes
  const node = oneWireSymbolNodeInfo(electricalSymbol.path, electricalSymbol.scale)
  if (!node) return movedShapes
  const anchor = {
    x: electricalSymbol.position.x + node.offset.x,
    y: electricalSymbol.position.y + node.offset.y
  }
  const snappedAnchor = snapPoint(anchor)
  const nodeDelta = {
    x: snappedAnchor.x - anchor.x,
    y: snappedAnchor.y - anchor.y
  }
  if (Math.abs(nodeDelta.x) < 1e-9 && Math.abs(nodeDelta.y) < 1e-9) return movedShapes
  return movedShapes.map((shape) => translateShape(shape, nodeDelta.x, nodeDelta.y))
}
