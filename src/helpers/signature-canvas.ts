export type SignaturePoint = {
  x: number
  y: number
}

export type SignatureBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type CanvasRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

export function pointOnSignatureCanvas(
  rect: CanvasRect,
  canvasWidth: number,
  canvasHeight: number,
  clientX: number,
  clientY: number
): SignaturePoint {
  const scaleX = rect.width > 0 ? canvasWidth / rect.width : 1
  const scaleY = rect.height > 0 ? canvasHeight / rect.height : 1
  return {
    x: Math.max(0, Math.min(canvasWidth, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(canvasHeight, (clientY - rect.top) * scaleY))
  }
}

export function includeSignaturePoint(
  bounds: SignatureBounds | null,
  point: SignaturePoint
): SignatureBounds {
  if (!bounds) {
    return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
  }
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y)
  }
}

export function signatureCropRect(
  bounds: SignatureBounds,
  canvasWidth: number,
  canvasHeight: number,
  padding = 24
) {
  const x = Math.max(0, Math.floor(bounds.minX - padding))
  const y = Math.max(0, Math.floor(bounds.minY - padding))
  const right = Math.min(canvasWidth, Math.ceil(bounds.maxX + padding))
  const bottom = Math.min(canvasHeight, Math.ceil(bounds.maxY + padding))
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  }
}
