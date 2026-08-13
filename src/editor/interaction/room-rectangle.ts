import type { LineShape, Point } from '../model/types.js'

export const convertWallsToRoom = (
  shapes: readonly LineShape[],
  nextId: () => string,
  roomName = ''
): LineShape[] | null => {
  if (shapes.length < 3 || shapes.some((shape) => shape.kind !== 'wall')) return null
  const groupId = `room-${nextId()}`
  const name = roomName.trim()
  return shapes.map((shape) => ({
    ...shape,
    groupId,
    ...(name ? { roomName: name } : {})
  }))
}

export const createRoomWalls = (start: Point, end: Point, nextId: () => string): LineShape[] => {
  const groupId = `room-${nextId()}`
  const corners: Point[] = [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y }
  ]

  return corners.map((corner, index) => ({
    id: nextId(),
    kind: 'wall',
    start: corner,
    end: corners[(index + 1) % corners.length],
    groupId
  }))
}
