// Leaf geometry module: pure wall-endpoint math with NO dependency on the
// concrete `CadleWall` class. Living in its own module lets both `wall-snap.ts`
// (which imports `CadleWall` for `instanceof` checks) and `symbols/wall.ts`
// (the `CadleWall` class itself) consume it without forming an import cycle.
import type { FabricObject } from 'fabric'

export type Point = { x: number; y: number }

export type WallObject = FabricObject & {
  left?: number
  top?: number
  width?: number
  height?: number
  wallThickness?: number
  wallPoints?: Point[]
  scaleX?: number
  scaleY?: number
  angle?: number
  originY?: 'top' | 'center' | 'bottom'
  type?: string
  doorSwingDirection?: string
  doorHingeSide?: string
}

/**
 * Return the two endpoints (in canvas coords) of a wall, supporting both
 * axis-aligned legacy walls (origin top-left, no angle) and free-angle walls
 * (origin left/center + angle).
 */
export function getWallEndpoints(wall: WallObject): [Point, Point] {
  const left = Number(wall.left ?? 0)
  const top = Number(wall.top ?? 0)
  const wallPoints = Array.isArray(wall.wallPoints) ? wall.wallPoints : null
  if (wallPoints && wallPoints.length >= 2) {
    const start = wallPoints[0]
    const end = wallPoints[wallPoints.length - 1]
    return [
      { x: left + start.x, y: top + start.y },
      { x: left + end.x, y: top + end.y }
    ]
  }

  const width = Math.abs(Number(wall.width ?? 0)) * Number(wall.scaleX ?? 1)
  const height = Math.abs(Number(wall.height ?? 0)) * Number(wall.scaleY ?? 1)
  const angle = Number(wall.angle ?? 0)
  const originY = wall.originY ?? 'top'

  // Free-angle walls: origin is left/top or left/center, width is the wall
  // length, the wall extends from the start point along its rotated axis.
  if (originY === 'center' || (angle !== 0 && angle !== 180)) {
    const rad = (angle * Math.PI) / 180
    const dx = Math.cos(rad) * width
    const dy = Math.sin(rad) * width

    if (originY === 'center') {
      return [
        { x: left, y: top },
        { x: left + dx, y: top + dy }
      ]
    }

    const offsetX = originY === 'top' ? -Math.sin(rad) * (height / 2) : Math.sin(rad) * (height / 2)
    const offsetY = originY === 'top' ? Math.cos(rad) * (height / 2) : -Math.cos(rad) * (height / 2)
    return [
      { x: left + offsetX, y: top + offsetY },
      { x: left + dx + offsetX, y: top + dy + offsetY }
    ]
  }

  // Legacy axis-aligned walls: endpoint axis is pinned to the wall edge
  // (top edge for horizontal walls, left edge for vertical walls).
  if (width >= height) {
    const y = top + height / 2
    return [
      { x: left, y },
      { x: left + width, y }
    ]
  }

  const x = left + width / 2
  return [
    { x, y: top },
    { x, y: top + height }
  ]
}
