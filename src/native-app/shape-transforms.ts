import type { Point, Shape } from '../native-draw/types.js'

export const dragEndpointSnapDelta = (
  movedShapes: Shape[],
  draggedIds: Set<string>,
  allShapes: Shape[],
  snapRadius = 20
): Point | null => {
  const isEndpointShape = (
    shape: Shape
  ): shape is Extract<Shape, { kind: 'wall' | 'line' | 'door' | 'window' | 'gate' }> =>
    shape.kind === 'wall' ||
    shape.kind === 'line' ||
    shape.kind === 'door' ||
    shape.kind === 'window' ||
    shape.kind === 'gate'

  let bestDelta: Point | null = null
  let bestDistance = snapRadius
  const stationaryEndpoints: Point[] = []

  for (const shape of allShapes) {
    if (draggedIds.has(shape.id) || !isEndpointShape(shape)) continue
    stationaryEndpoints.push(shape.start, shape.end)
  }
  if (!stationaryEndpoints.length) return null

  for (const shape of movedShapes) {
    if (!isEndpointShape(shape)) continue
    for (const movedEndpoint of [shape.start, shape.end]) {
      for (const stationaryEndpoint of stationaryEndpoints) {
        const distance = Math.hypot(movedEndpoint.x - stationaryEndpoint.x, movedEndpoint.y - stationaryEndpoint.y)
        if (distance < bestDistance) {
          bestDistance = distance
          bestDelta = {
            x: stationaryEndpoint.x - movedEndpoint.x,
            y: stationaryEndpoint.y - movedEndpoint.y
          }
        }
      }
    }
  }

  return bestDelta
}

export const translateShape = (shape: Shape, dx: number, dy: number): Shape => {
  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate': {
      return {
        ...shape,
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy }
      }
    }
    case 'rect': {
      return {
        ...shape,
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy }
      }
    }
    case 'text': {
      return {
        ...shape,
        position: { x: shape.position.x + dx, y: shape.position.y + dy }
      }
    }
    case 'symbol': {
      return {
        ...shape,
        position: { x: shape.position.x + dx, y: shape.position.y + dy }
      }
    }
    case 'image': {
      return {
        ...shape,
        position: { x: shape.position.x + dx, y: shape.position.y + dy }
      }
    }
  }
}

export const moveShape = (shape: Shape, dx: number, dy: number, snapPoint: (point: Point) => Point): Shape => {
  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate': {
      return {
        ...shape,
        start: snapPoint({ x: shape.start.x + dx, y: shape.start.y + dy }),
        end: snapPoint({ x: shape.end.x + dx, y: shape.end.y + dy })
      }
    }
    case 'rect': {
      return {
        ...shape,
        start: snapPoint({ x: shape.start.x + dx, y: shape.start.y + dy }),
        end: snapPoint({ x: shape.end.x + dx, y: shape.end.y + dy })
      }
    }
    case 'text': {
      return {
        ...shape,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy })
      }
    }
    case 'symbol': {
      return {
        ...shape,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy })
      }
    }
    case 'image': {
      return {
        ...shape,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy })
      }
    }
  }
}
