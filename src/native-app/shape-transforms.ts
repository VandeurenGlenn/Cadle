import type { Point, Shape } from '../native-draw/types.js'

export const dragEndpointSnapDelta = (
  movedShapes: Shape[],
  draggedIds: Set<string>,
  allShapes: Shape[],
  snapRadius = 20
): Point | null => {
  let bestDelta: Point | null = null
  let bestDistance = snapRadius
  const stationaryEndpoints: Point[] = []

  for (const shape of allShapes) {
    if (draggedIds.has(shape.id) || shape.kind !== 'wall') continue
    stationaryEndpoints.push(shape.start, shape.end)
  }
  if (!stationaryEndpoints.length) return null

  for (const shape of movedShapes) {
    if (shape.kind !== 'wall') continue
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
      const line = {
        id: shape.id,
        kind: shape.kind,
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy }
      }
      if (shape.flipSide) line.flipSide = true
      if (shape.stroke) line.stroke = shape.stroke
      if (shape.bindingId) line.bindingId = shape.bindingId
      if (shape.groupId) line.groupId = shape.groupId
      return line
    }
    case 'rect': {
      const rect = {
        id: shape.id,
        kind: 'rect' as const,
        start: { x: shape.start.x + dx, y: shape.start.y + dy },
        end: { x: shape.end.x + dx, y: shape.end.y + dy }
      }
      if (shape.variant) rect.variant = shape.variant
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      return rect
    }
    case 'text': {
      const text = {
        id: shape.id,
        kind: 'text' as const,
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
        text: shape.text
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      return text
    }
    case 'symbol': {
      const symbol = {
        id: shape.id,
        kind: 'symbol' as const,
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
        name: shape.name,
        path: shape.path,
        scale: shape.scale
      }
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      return symbol
    }
    case 'image': {
      const image = {
        id: shape.id,
        kind: 'image' as const,
        position: { x: shape.position.x + dx, y: shape.position.y + dy },
        name: shape.name,
        path: shape.path,
        width: shape.width,
        height: shape.height
      }
      if (shape.rotation) image.rotation = shape.rotation
      if (shape.fill) image.fill = shape.fill
      if (shape.stroke) image.stroke = shape.stroke
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      return image
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
      const line = {
        id: shape.id,
        kind: shape.kind,
        start: snapPoint({ x: shape.start.x + dx, y: shape.start.y + dy }),
        end: snapPoint({ x: shape.end.x + dx, y: shape.end.y + dy })
      }
      if (shape.flipSide) line.flipSide = true
      if (shape.stroke) line.stroke = shape.stroke
      if (shape.bindingId) line.bindingId = shape.bindingId
      if (shape.groupId) line.groupId = shape.groupId
      return line
    }
    case 'rect': {
      const rect = {
        id: shape.id,
        kind: 'rect' as const,
        start: snapPoint({ x: shape.start.x + dx, y: shape.start.y + dy }),
        end: snapPoint({ x: shape.end.x + dx, y: shape.end.y + dy })
      }
      if (shape.variant) rect.variant = shape.variant
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      return rect
    }
    case 'text': {
      const text = {
        id: shape.id,
        kind: 'text' as const,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy }),
        text: shape.text
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      return text
    }
    case 'symbol': {
      const symbol = {
        id: shape.id,
        kind: 'symbol' as const,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy }),
        name: shape.name,
        path: shape.path,
        scale: shape.scale
      }
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      return symbol
    }
    case 'image': {
      const image = {
        id: shape.id,
        kind: 'image' as const,
        position: snapPoint({ x: shape.position.x + dx, y: shape.position.y + dy }),
        name: shape.name,
        path: shape.path,
        width: shape.width,
        height: shape.height
      }
      if (shape.rotation) image.rotation = shape.rotation
      if (shape.fill) image.fill = shape.fill
      if (shape.stroke) image.stroke = shape.stroke
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      return image
    }
  }
}
