import { connectedWallIds, dragEndpointSnapDelta, translateShape, updateConnectedWalls } from './shape-transforms.js'
import { oneWireSymbolNodeInfo } from '../layout/onewire-symbol-nodes.js'
import { symbolContentBounds } from '../layout/symbol-layout.js'
import type { DraftShape, DragState, Point, Shape } from '../../editor/model/types.js'

const closestPointOnSegment = (point: Point, start: Point, end: Point): Point => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return { ...start }
  const position = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return { x: start.x + dx * position, y: start.y + dy * position }
}

const isWallSymbol = (shape: Shape): shape is Extract<Shape, { kind: 'symbol' }> =>
  shape.kind === 'symbol' && /\/(?:switches|socket outlets)\//i.test(shape.path)

type WallShape = Extract<Shape, { kind: 'wall' }>

const symbolWallOffsetPoint = (
  point: Point,
  symbolHalfExtent: number,
  wall: WallShape,
  zoom: number,
  symbol: Extract<Shape, { kind: 'symbol' }> | null = null
): Point | null => {
  const closest = closestPointOnSegment(point, wall.start, wall.end)
  const dx = wall.end.x - wall.start.x
  const dy = wall.end.y - wall.start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return null
  const nx = -dy / length
  const ny = dx / length
  const sideByPointer = Math.sign((point.x - closest.x) * nx + (point.y - closest.y) * ny)
  const side = sideByPointer === 0 ? 1 : sideByPointer
  const wallStrokePx = typeof wall.strokeWidth === 'number' ? wall.strokeWidth : 6
  const wallHalfThickness = wallStrokePx / (2 * Math.max(zoom, 0.1))
  const switchExtent =
    symbol && /\/switches\//i.test(symbol.path)
      ? directionalExtent(symbolContentBounds({ ...symbol, position: point }), point, nx, ny, side === 1 ? -1 : 1)
      : null
  const centerOffset =
    switchExtent === null
      ? wallHalfThickness + symbolHalfExtent + Math.max(symbolHalfExtent * (5 / 12), wallHalfThickness * (5 / 6))
      : wallHalfThickness + switchExtent + 1.5
  return {
    x: closest.x + nx * side * centerOffset,
    y: closest.y + ny * side * centerOffset
  }
}

const mountedWallForSymbol = (
  shape: Extract<Shape, { kind: 'symbol' }>,
  symbolHalfExtent: number,
  shapes: readonly Shape[],
  zoom: number
): WallShape | null => {
  let bestWall: WallShape | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of shapes) {
    if (candidate.kind !== 'wall') continue
    const closest = closestPointOnSegment(shape.position, candidate.start, candidate.end)
    const distance = Math.hypot(shape.position.x - closest.x, shape.position.y - closest.y)
    if (distance >= bestDistance) continue
    if (!snapSymbolToWallOffset(shape.position, symbolHalfExtent, [candidate], zoom).snapped) continue
    bestWall = candidate
    bestDistance = distance
  }
  return bestWall
}

const isClearOfWalls = (point: Point, symbolHalfExtent: number, shapes: readonly Shape[], zoom: number): boolean =>
  shapes.every((shape) => {
    if (shape.kind !== 'wall') return true
    const closest = closestPointOnSegment(point, shape.start, shape.end)
    const wallStrokePx = typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 6
    const wallHalfThickness = wallStrokePx / (2 * Math.max(zoom, 0.1))
    return Math.hypot(point.x - closest.x, point.y - closest.y) >= wallHalfThickness + symbolHalfExtent
  })

const directionalExtent = (
  bounds: { x: number; y: number; width: number; height: number },
  center: Point,
  axisX: number,
  axisY: number,
  direction: -1 | 1
): number => {
  const centerProjection = center.x * axisX + center.y * axisY
  const projections = [
    bounds.x * axisX + bounds.y * axisY,
    (bounds.x + bounds.width) * axisX + bounds.y * axisY,
    bounds.x * axisX + (bounds.y + bounds.height) * axisY,
    (bounds.x + bounds.width) * axisX + (bounds.y + bounds.height) * axisY
  ]
  return direction < 0 ? centerProjection - Math.min(...projections) : Math.max(...projections) - centerProjection
}

export const snapWallSymbolNextToSymbol = (
  point: Point,
  sourceShape: Extract<Shape, { kind: 'symbol' }>,
  shapes: readonly Shape[],
  excludedIds: ReadonlySet<string> = new Set(),
  zoom = 1,
  wall: WallShape | null = null
): { point: Point; snapped: boolean } => {
  const snapRadius = 18 / Math.max(zoom, 0.1)
  const sourceHalfExtent = (24 * Math.max(0.4, sourceShape.scale)) / 2
  let bestPoint: Point | null = null
  let bestDistance = snapRadius

  for (const shape of shapes) {
    if (excludedIds.has(shape.id) || !isWallSymbol(shape)) continue
    const targetHalfExtent = (24 * Math.max(0.4, shape.scale)) / 2
    const sourceBounds = symbolContentBounds({ ...sourceShape, position: point })
    const targetBounds = symbolContentBounds(shape)
    const targetWall = wall ?? mountedWallForSymbol(shape, targetHalfExtent, shapes, zoom)
    let anchors: Point[]
    if (targetWall) {
      const dx = targetWall.end.x - targetWall.start.x
      const dy = targetWall.end.y - targetWall.start.y
      const length = Math.hypot(dx, dy)
      if (length === 0) continue
      const targetWallSnap = snapSymbolToWallOffset(shape.position, targetHalfExtent, [targetWall], zoom)
      if (!targetWallSnap.snapped) continue
      anchors = [-1, 1].map((direction) => {
        const snapDirection = direction as -1 | 1
        const tangentX = dx / length
        const tangentY = dy / length
        const targetExtent = directionalExtent(targetBounds, shape.position, tangentX, tangentY, snapDirection)
        const sourceExtent = directionalExtent(sourceBounds, point, tangentX, tangentY, -snapDirection as -1 | 1)
        const offset = targetExtent + sourceExtent + 4
        const alongWall = {
          x: shape.position.x + tangentX * offset * direction,
          y: shape.position.y + tangentY * offset * direction
        }
        return alongWall
      })
    } else {
      const leftOffset =
        directionalExtent(targetBounds, shape.position, 1, 0, -1) + directionalExtent(sourceBounds, point, 1, 0, 1) + 4
      const rightOffset =
        directionalExtent(targetBounds, shape.position, 1, 0, 1) + directionalExtent(sourceBounds, point, 1, 0, -1) + 4
      const topOffset =
        directionalExtent(targetBounds, shape.position, 0, 1, -1) + directionalExtent(sourceBounds, point, 0, 1, 1) + 4
      const bottomOffset =
        directionalExtent(targetBounds, shape.position, 0, 1, 1) + directionalExtent(sourceBounds, point, 0, 1, -1) + 4
      anchors = [
        { x: shape.position.x, y: shape.position.y - topOffset },
        { x: shape.position.x, y: shape.position.y + bottomOffset },
        { x: shape.position.x - leftOffset, y: shape.position.y },
        { x: shape.position.x + rightOffset, y: shape.position.y }
      ]
    }
    for (const anchor of anchors) {
      if (!isClearOfWalls(anchor, sourceHalfExtent, shapes, zoom)) continue
      const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y)
      if (distance >= bestDistance) continue
      bestPoint = anchor
      bestDistance = distance
    }
  }

  return bestPoint ? { point: { ...bestPoint }, snapped: true } : { point, snapped: false }
}

export const snapSymbolToWallOffset = (
  point: Point,
  symbolHalfExtent: number,
  shapes: readonly Shape[],
  zoom = 1,
  symbol: Extract<Shape, { kind: 'symbol' }> | null = null
): { point: Point; snapped: boolean; wall: WallShape | null } => {
  const snapRadius = symbolHalfExtent * 2
  let bestPoint: Point | null = null
  let bestWall: WallShape | null = null
  let bestDistance = snapRadius

  for (const shape of shapes) {
    if (shape.kind !== 'wall') continue
    const closest = closestPointOnSegment(point, shape.start, shape.end)
    const distance = Math.hypot(point.x - closest.x, point.y - closest.y)
    if (distance >= bestDistance) continue
    const offsetPoint = symbolWallOffsetPoint(point, symbolHalfExtent, shape, zoom, symbol)
    if (!offsetPoint) continue
    bestPoint = offsetPoint
    bestWall = shape
    bestDistance = distance
  }

  return bestPoint ? { point: bestPoint, snapped: true, wall: bestWall } : { point, snapped: false, wall: null }
}

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
  allShapes: Shape[],
  zoom = 1
): Shape[] => {
  const point = snapPoint(rawPoint)
  const pointerStart = snapPoint(drag.pointerStart)
  const dx = point.x - pointerStart.x
  const dy = point.y - pointerStart.y
  const movedShapes = drag.initial.map((initialShape) => translateShape(initialShape, dx, dy))
  const targetIds = new Set(drag.ids)
  const snapExclusions = new Set([...targetIds, ...connectedWallIds(allShapes, targetIds)])
  const snapDelta = dragEndpointSnapDelta(movedShapes, snapExclusions, allShapes)
  let finalShapes = snapDelta
    ? movedShapes.map((shape) => translateShape(shape, snapDelta.x, snapDelta.y))
    : movedShapes

  const wallSymbol = finalShapes.find(isWallSymbol)
  if (wallSymbol?.kind === 'symbol') {
    const halfExtent = (24 * Math.max(0.4, wallSymbol.scale)) / 2
    const wallSnap = snapSymbolToWallOffset(wallSymbol.position, halfExtent, allShapes, zoom, wallSymbol)
    if (wallSnap.snapped) {
      finalShapes = finalShapes.map((shape) =>
        translateShape(shape, wallSnap.point.x - wallSymbol.position.x, wallSnap.point.y - wallSymbol.position.y)
      )
    }
    const movedWallSymbol = finalShapes.find((shape) => shape.id === wallSymbol.id)
    if (movedWallSymbol?.kind === 'symbol') {
      const symbolSnap = snapWallSymbolNextToSymbol(
        movedWallSymbol.position,
        movedWallSymbol,
        allShapes,
        targetIds,
        zoom,
        wallSnap.wall
      )
      if (symbolSnap.snapped) {
        finalShapes = finalShapes.map((shape) =>
          translateShape(
            shape,
            symbolSnap.point.x - movedWallSymbol.position.x,
            symbolSnap.point.y - movedWallSymbol.position.y
          )
        )
      }
    }
  }

  const electricalSymbol = finalShapes.find((shape) => {
    if (shape.kind !== 'symbol') return false
    return (
      /protection devices|automaat|breaker|differential|differentieel|\brcd\b/i.test(`${shape.name} ${shape.path}`) &&
      oneWireSymbolNodeInfo(shape.path, shape.scale) !== null
    )
  })
  if (electricalSymbol?.kind === 'symbol') {
    const node = oneWireSymbolNodeInfo(electricalSymbol.path, electricalSymbol.scale)
    if (node) {
      const anchor = {
        x: electricalSymbol.position.x + node.offset.x,
        y: electricalSymbol.position.y + node.offset.y
      }
      const snappedAnchor = snapPoint(anchor)
      const nodeDelta = {
        x: snappedAnchor.x - anchor.x,
        y: snappedAnchor.y - anchor.y
      }
      if (Math.abs(nodeDelta.x) >= 1e-9 || Math.abs(nodeDelta.y) >= 1e-9) {
        finalShapes = finalShapes.map((shape) => translateShape(shape, nodeDelta.x, nodeDelta.y))
      }
    }
  }

  const movedById = new Map(finalShapes.map((shape) => [shape.id, shape]))
  const after = allShapes.map((shape) => movedById.get(shape.id) ?? shape)
  return updateConnectedWalls(allShapes, after, targetIds)
}
