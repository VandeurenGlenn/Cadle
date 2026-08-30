import type { Point, Shape } from '../../editor/model/types.js'

type WallTransform = {
  before: Extract<Shape, { kind: 'wall' }>
  after: Extract<Shape, { kind: 'wall' }>
}

const mappedWallConnection = (point: Point, transform: WallTransform, tolerance = 1): Point | null => {
  const dx = transform.before.end.x - transform.before.start.x
  const dy = transform.before.end.y - transform.before.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return null
  const position =
    ((point.x - transform.before.start.x) * dx + (point.y - transform.before.start.y) * dy) / lengthSquared
  if (position < 0 || position > 1) return null
  const projected = {
    x: transform.before.start.x + dx * position,
    y: transform.before.start.y + dy * position
  }
  if (Math.hypot(point.x - projected.x, point.y - projected.y) > tolerance) return null
  return {
    x: transform.after.start.x + (transform.after.end.x - transform.after.start.x) * position,
    y: transform.after.start.y + (transform.after.end.y - transform.after.start.y) * position
  }
}

export const connectedWallIds = (shapes: readonly Shape[], targetIds: ReadonlySet<string>): Set<string> => {
  const targets = shapes.filter(
    (shape): shape is Extract<Shape, { kind: 'wall' }> => targetIds.has(shape.id) && shape.kind === 'wall'
  )
  const connected = new Set<string>()
  for (const shape of shapes) {
    if (targetIds.has(shape.id) || shape.kind !== 'wall') continue
    if (
      targets.some((target) => {
        const transform = { before: target, after: target }
        return mappedWallConnection(shape.start, transform) || mappedWallConnection(shape.end, transform)
      })
    ) {
      connected.add(shape.id)
    }
  }
  return connected
}

export const updateConnectedWalls = (
  before: readonly Shape[],
  after: Shape[],
  targetIds: ReadonlySet<string>
): Shape[] => {
  const updatedById = new Map(after.map((shape) => [shape.id, shape]))
  const transforms: WallTransform[] = before.flatMap((shape) => {
    const updated = updatedById.get(shape.id)
    return targetIds.has(shape.id) && shape.kind === 'wall' && updated?.kind === 'wall'
      ? [{ before: shape, after: updated }]
      : []
  })
  if (!transforms.length) return after

  return after.map((shape) => {
    if (targetIds.has(shape.id) || shape.kind !== 'wall') return shape
    const start = transforms.map((transform) => mappedWallConnection(shape.start, transform)).find(Boolean)
    const end = transforms.map((transform) => mappedWallConnection(shape.end, transform)).find(Boolean)
    if (!start && !end) return shape
    return { ...shape, start: start ?? shape.start, end: end ?? shape.end }
  })
}

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
