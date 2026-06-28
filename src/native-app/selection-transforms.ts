import type { Point, Shape } from '../native-draw/types.js'

export type SelectionTransformAction =
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'rotate-left'
  | 'rotate-right'
  | 'scale-up'
  | 'scale-down'

const scaleFactorForAction = (action: SelectionTransformAction): number => {
  if (action === 'scale-up') return 1.1
  if (action === 'scale-down') return 1 / 1.1
  return 1
}

const transformPoint = (point: Point, center: Point, action: SelectionTransformAction): Point => {
  if (action === 'scale-up' || action === 'scale-down') {
    const factor = scaleFactorForAction(action)
    return {
      x: center.x + (point.x - center.x) * factor,
      y: center.y + (point.y - center.y) * factor
    }
  }

  if (action === 'flip-horizontal') {
    return { x: center.x * 2 - point.x, y: point.y }
  }
  if (action === 'flip-vertical') {
    return { x: point.x, y: center.y * 2 - point.y }
  }
  if (action === 'rotate-left') {
    return {
      x: center.x - (point.y - center.y),
      y: center.y + (point.x - center.x)
    }
  }
  return {
    x: center.x + (point.y - center.y),
    y: center.y - (point.x - center.x)
  }
}

const nextRotation = (rotation: number | undefined, action: SelectionTransformAction): number | undefined => {
  if (action !== 'rotate-left' && action !== 'rotate-right') return rotation
  const delta = action === 'rotate-left' ? -90 : 90
  return ((((rotation ?? 0) + delta) % 360) + 360) % 360
}

const nextFlipX = (flipX: boolean | undefined, action: SelectionTransformAction): boolean | undefined => {
  if (action !== 'flip-horizontal') return flipX
  return !flipX || undefined
}

const nextFlipY = (flipY: boolean | undefined, action: SelectionTransformAction): boolean | undefined => {
  if (action !== 'flip-vertical') return flipY
  return !flipY || undefined
}

const normalizeRectPoints = (a: Point, b: Point): { start: Point; end: Point } => ({
  start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
  end: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }
})

export const transformShapeForSelection = (shape: Shape, center: Point, action: SelectionTransformAction): Shape => {
  const scaleFactor = scaleFactorForAction(action)

  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate':
      return {
        ...shape,
        start: transformPoint(shape.start, center, action),
        end: transformPoint(shape.end, center, action)
      }
    case 'rect': {
      if (action === 'rotate-left' || action === 'rotate-right') {
        const width = Math.abs(shape.end.x - shape.start.x)
        const height = Math.abs(shape.end.y - shape.start.y)
        const currentCenter = {
          x: (shape.start.x + shape.end.x) / 2,
          y: (shape.start.y + shape.end.y) / 2
        }
        const nextCenter = transformPoint(currentCenter, center, action)
        return {
          ...shape,
          start: { x: nextCenter.x - width / 2, y: nextCenter.y - height / 2 },
          end: { x: nextCenter.x + width / 2, y: nextCenter.y + height / 2 },
          rotation: nextRotation(shape.rotation, action)
        }
      }

      const a = transformPoint(shape.start, center, action)
      const b = transformPoint(shape.end, center, action)
      const normalized = normalizeRectPoints(a, b)
      return {
        ...shape,
        start: normalized.start,
        end: normalized.end
      }
    }
    case 'text':
      return {
        ...shape,
        position: transformPoint(shape.position, center, action),
        rotation: nextRotation(shape.rotation, action),
        flipX: nextFlipX(shape.flipX, action),
        flipY: nextFlipY(shape.flipY, action)
      }
    case 'symbol':
      return {
        ...shape,
        position: transformPoint(shape.position, center, action),
        scale: shape.scale * scaleFactor,
        rotation: nextRotation(shape.rotation, action),
        flipX: nextFlipX(shape.flipX, action),
        flipY: nextFlipY(shape.flipY, action)
      }
    case 'image':
      return {
        ...shape,
        position: transformPoint(shape.position, center, action),
        width: shape.width * scaleFactor,
        height: shape.height * scaleFactor,
        rotation: nextRotation(shape.rotation, action),
        flipX: nextFlipX(shape.flipX, action),
        flipY: nextFlipY(shape.flipY, action)
      }
  }
}
