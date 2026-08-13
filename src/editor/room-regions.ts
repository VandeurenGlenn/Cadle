import type { LineShape, Point, Shape } from './model/types.js'

export type RoomRegion = {
  groupId: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export const namedRoomRegions = (shapes: readonly Shape[]): RoomRegion[] => {
  const groups = new Map<string, LineShape[]>()
  for (const shape of shapes) {
    if (shape.kind !== 'wall' || !shape.groupId?.startsWith('room-') || !shape.roomName?.trim()) continue
    const entries = groups.get(shape.groupId)
    if (entries) entries.push(shape)
    else groups.set(shape.groupId, [shape])
  }
  return [...groups.entries()].flatMap(([groupId, walls]) => {
    const points = walls.flatMap((wall) => [wall.start, wall.end])
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(...points.map((point) => point.x))
    const maxY = Math.max(...points.map((point) => point.y))
    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return []
    return [{ groupId, name: walls[0].roomName!.trim(), x: minX, y: minY, width: maxX - minX, height: maxY - minY }]
  })
}

export const roomNameAtPoint = (regions: readonly RoomRegion[], point: Point): string | undefined => {
  const matches = regions.filter(
    (room) => point.x >= room.x && point.x <= room.x + room.width && point.y >= room.y && point.y <= room.y + room.height
  )
  matches.sort((left, right) => left.width * left.height - right.width * right.height)
  return matches[0]?.name
}

export const shapeAnchorPoint = (shape: Shape): Point | null => {
  if (shape.kind === 'symbol' || shape.kind === 'image' || shape.kind === 'text') return shape.position
  if ('start' in shape && 'end' in shape) {
    return { x: (shape.start.x + shape.end.x) / 2, y: (shape.start.y + shape.end.y) / 2 }
  }
  return null
}
