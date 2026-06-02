import type { Canvas } from '../../fabric-imports.js'
import type { FabricObject } from 'fabric'

type WallSnap = {
  bounds: { left: number; top: number; width: number; height: number; horizontal: boolean }
  wall?: FabricObject
}

type WallBounds = WallSnap['bounds']

type OpeningTarget = FabricObject & {
  type?: string
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  doorSwingDirection?: string
  doorHingeSide?: string
}

export const isWallObject = (obj: FabricObject | null | undefined) => obj?.type === 'CadleWall'

export const isOpeningObject = (obj: FabricObject | null | undefined) =>
  obj?.type === 'CadleDoor' || obj?.type === 'CadleWindow' || obj?.type === 'CadleGate'

export const getWallBounds = (wall: FabricObject) => {
  const left = Number(wall?.left ?? 0)
  const top = Number(wall?.top ?? 0)
  const width = Math.abs(Number(wall?.width ?? 0) * Number(wall?.scaleX ?? 1))
  const height = Math.abs(Number(wall?.height ?? 0) * Number(wall?.scaleY ?? 1))
  return {
    left,
    top,
    width,
    height,
    horizontal: width >= height
  }
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const findNearestWall = (canvas: Canvas, point: { left: number; top: number }, maxDistance: number) => {
  const walls = canvas.getObjects().filter((obj: FabricObject) => isWallObject(obj))
  let best: { wall: FabricObject; bounds: WallBounds; distance: number } | null = null

  for (const wall of walls) {
    const bounds = getWallBounds(wall)
    if (!bounds.width || !bounds.height) continue

    let distance = Number.POSITIVE_INFINITY

    if (bounds.horizontal) {
      const centerY = bounds.top + bounds.height / 2
      const projectedX = clamp(point.left, bounds.left, bounds.left + bounds.width)
      distance = Math.hypot(point.left - projectedX, point.top - centerY)
    } else {
      const centerX = bounds.left + bounds.width / 2
      const projectedY = clamp(point.top, bounds.top, bounds.top + bounds.height)
      distance = Math.hypot(point.left - centerX, point.top - projectedY)
    }

    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { wall, bounds, distance }
    }
  }
  return best
}

export const projectPointToWall = (
  point: { left: number; top: number },
  wallSnap: WallSnap,
  freeDraw: boolean,
  gridSize: number
) => {
  const { bounds } = wallSnap
  const snapAxis = (value: number) => {
    if (freeDraw) return value
    return Math.round(value / gridSize) * gridSize
  }

  if (bounds.horizontal) {
    const projectedLeft = clamp(point.left, bounds.left, bounds.left + bounds.width)
    return {
      left: snapAxis(projectedLeft),
      top: bounds.top + bounds.height / 2
    }
  }

  const projectedTop = clamp(point.top, bounds.top, bounds.top + bounds.height)
  return {
    left: bounds.left + bounds.width / 2,
    top: snapAxis(projectedTop)
  }
}

export const getWallDrawLayout = (
  startPoint: { left: number; top: number },
  currentPoint: { left: number; top: number },
  gridSize: number
) => {
  const dx = currentPoint.left - startPoint.left
  const dy = currentPoint.top - startPoint.top
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const thickness = Math.max(2, gridSize)

  if (absDx >= absDy) {
    return {
      left: Math.min(startPoint.left, currentPoint.left),
      top: startPoint.top - thickness / 2,
      width: Math.max(gridSize, absDx),
      height: thickness
    }
  }
  return {
    left: startPoint.left - thickness / 2,
    top: Math.min(startPoint.top, currentPoint.top),
    width: thickness,
    height: Math.max(gridSize, absDy)
  }
}

export const getOpeningWallLayout = (
  startPoint: { left: number; top: number },
  currentPoint: { left: number; top: number },
  wallSnap: WallSnap,
  gridSize: number
) => {
  const { bounds } = wallSnap
  const snappedStart = projectPointToWall(startPoint, wallSnap, false, gridSize)
  const snappedCurrent = projectPointToWall(currentPoint, wallSnap, false, gridSize)

  if (bounds.horizontal) {
    const startX = clamp(snappedStart.left, bounds.left, bounds.left + bounds.width)
    const currentX = clamp(snappedCurrent.left, bounds.left, bounds.left + bounds.width)
    return {
      left: Math.min(startX, currentX),
      top: bounds.top,
      width: Math.max(gridSize, Math.abs(currentX - startX)),
      height: bounds.height,
      horizontal: true,
      wallThickness: bounds.height,
      dx: currentX - startX,
      dy: currentPoint.top - startPoint.top
    }
  }

  const startY = clamp(snappedStart.top, bounds.top, bounds.top + bounds.height)
  const currentY = clamp(snappedCurrent.top, bounds.top, bounds.top + bounds.height)
  return {
    left: bounds.left,
    top: Math.min(startY, currentY),
    width: bounds.width,
    height: Math.max(gridSize, Math.abs(currentY - startY)),
    horizontal: false,
    wallThickness: bounds.width,
    dx: currentPoint.left - startPoint.left,
    dy: currentY - startY
  }
}

export const snapOpeningToWall = (
  target: OpeningTarget,
  point: { left: number; top: number },
  wallSnap: WallSnap,
  freeDraw: boolean,
  gridSize: number
) => {
  const { bounds } = wallSnap
  const currentWidth = Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) || gridSize
  const currentHeight = Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) || gridSize
  const projected = projectPointToWall(point, wallSnap, freeDraw, gridSize)

  if (bounds.horizontal) {
    const left = clamp(projected.left - currentWidth / 2, bounds.left, bounds.left + bounds.width - currentWidth)
    const updates: Partial<{
      left: number
      top: number
      width: number
      height: number
      wallThickness?: number
      doorSwingDirection?: string
      doorHingeSide?: string
    }> = {
      left,
      top: bounds.top,
      width: currentWidth,
      height: bounds.height
    }

    if (target.type === 'CadleDoor') {
      updates.wallThickness = bounds.height
      if (target.doorSwingDirection !== 'up' && target.doorSwingDirection !== 'down')
        updates.doorSwingDirection = 'down'
      if (target.doorHingeSide !== 'left' && target.doorHingeSide !== 'right') updates.doorHingeSide = 'left'
    }

    target.set(updates)
    target.setCoords()
    return true
  }

  const top = clamp(projected.top - currentHeight / 2, bounds.top, bounds.top + bounds.height - currentHeight)
  const updates: Partial<{
    left: number
    top: number
    width: number
    height: number
    wallThickness?: number
    doorSwingDirection?: string
    doorHingeSide?: string
  }> = {
    left: bounds.left,
    top,
    width: bounds.width,
    height: currentHeight
  }

  if (target.type === 'CadleDoor') {
    updates.wallThickness = bounds.width
    if (target.doorSwingDirection !== 'left' && target.doorSwingDirection !== 'right')
      updates.doorSwingDirection = 'right'
    if (target.doorHingeSide !== 'top' && target.doorHingeSide !== 'bottom') updates.doorHingeSide = 'top'
  }

  target.set(updates)
  target.setCoords()
  return true
}
