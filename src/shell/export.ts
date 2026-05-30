/**
 * Pure-ish helpers for exporting a Fabric canvas to an A4-sized PNG.
 *
 * The shell remains the only orchestrator; this module owns the math
 * (page dimensions, content bounds, best-fit zoom) and the temporary
 * viewport-transform dance required to render at A4 sizing.
 */

export type A4Orientation = 'portrait' | 'landscape'

export type A4ExportResult = {
  dataUrl: string
  orientation: A4Orientation
  width: number
  height: number
}

export const A4_EXPORT_MARGIN = 28

export function getExportDimensions(orientation: A4Orientation): { width: number; height: number } {
  return orientation === 'portrait' ? { width: 794, height: 1123 } : { width: 1123, height: 794 }
}

export type CanvasContentBounds = {
  objects: any[]
  minLeft: number
  minTop: number
  maxRight: number
  maxBottom: number
  contentWidth: number
  contentHeight: number
}

export function getCanvasContentBounds(canvas: any): CanvasContentBounds {
  const objects = canvas.getObjects().filter((obj: any) => obj.visible !== false)
  if (objects.length === 0) {
    return {
      objects,
      minLeft: 0,
      minTop: 0,
      maxRight: 0,
      maxBottom: 0,
      contentWidth: 1,
      contentHeight: 1
    }
  }

  let minLeft = Number.POSITIVE_INFINITY
  let minTop = Number.POSITIVE_INFINITY
  let maxRight = Number.NEGATIVE_INFINITY
  let maxBottom = Number.NEGATIVE_INFINITY

  for (const obj of objects) {
    const bounds = obj.getBoundingRect()
    minLeft = Math.min(minLeft, Number(bounds.left ?? 0))
    minTop = Math.min(minTop, Number(bounds.top ?? 0))
    maxRight = Math.max(maxRight, Number(bounds.left ?? 0) + Number(bounds.width ?? 0))
    maxBottom = Math.max(maxBottom, Number(bounds.top ?? 0) + Number(bounds.height ?? 0))
  }
  return {
    objects,
    minLeft,
    minTop,
    maxRight,
    maxBottom,
    contentWidth: Math.max(1, maxRight - minLeft),
    contentHeight: Math.max(1, maxBottom - minTop)
  }
}

export function resolveBestOrientation(contentWidth: number, contentHeight: number, margin: number): A4Orientation {
  const landscape = getExportDimensions('landscape')
  const portrait = getExportDimensions('portrait')

  const landscapeZoom = Math.min(
    Math.max(1, landscape.width - margin * 2) / contentWidth,
    Math.max(1, landscape.height - margin * 2) / contentHeight
  )
  const portraitZoom = Math.min(
    Math.max(1, portrait.width - margin * 2) / contentWidth,
    Math.max(1, portrait.height - margin * 2) / contentHeight
  )
  return portraitZoom > landscapeZoom ? 'portrait' : 'landscape'
}

/**
 * Renders the canvas at A4 dimensions and returns a high-DPI PNG data URL.
 * The original viewport transform and dimensions are restored after export.
 */
export async function exportCanvasToA4PNG(
  canvas: any,
  orientation: A4Orientation | 'auto' = 'auto'
): Promise<A4ExportResult> {
  const exportMargin = A4_EXPORT_MARGIN
  const previousDimensions = {
    width: Number(canvas.getWidth() ?? 1123),
    height: Number(canvas.getHeight() ?? 794)
  }
  const previousViewportTransform = (canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0]).slice() as number[]
  const bounds = getCanvasContentBounds(canvas)

  const resolvedOrientation: A4Orientation =
    orientation === 'auto'
      ? resolveBestOrientation(bounds.contentWidth, bounds.contentHeight, exportMargin)
      : orientation
  const { width: exportWidth, height: exportHeight } = getExportDimensions(resolvedOrientation)

  const exportMultiplier = Math.max(2, Math.ceil(window.devicePixelRatio || 1))

  try {
    const retinaScaling = (canvas.getRetinaScaling?.() ?? window.devicePixelRatio) || 1
    canvas.setDimensions({ width: exportWidth, height: exportHeight }, retinaScaling)

    if (bounds.objects.length === 0) {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    } else {
      const availableWidth = Math.max(1, exportWidth - exportMargin * 2)
      const availableHeight = Math.max(1, exportHeight - exportMargin * 2)
      const fitZoom = Math.max(
        0.1,
        Math.min(3, Math.min(availableWidth / bounds.contentWidth, availableHeight / bounds.contentHeight))
      )
      const translateX = exportWidth / 2 - (bounds.minLeft + bounds.contentWidth / 2) * fitZoom
      const translateY = exportHeight / 2 - (bounds.minTop + bounds.contentHeight / 2) * fitZoom

      canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, translateX, translateY])
    }

    canvas.renderAll()

    const dataUrl = canvas.toDataURL({
      multiplier: exportMultiplier,
      quality: 100,
      format: 'png',
      width: exportWidth,
      height: exportHeight,
      enableRetinaScaling: true
    })
    return {
      dataUrl,
      orientation: resolvedOrientation,
      width: exportWidth,
      height: exportHeight
    }
  } finally {
    const retinaScaling = (canvas.getRetinaScaling?.() ?? window.devicePixelRatio) || 1
    canvas.setDimensions(previousDimensions, retinaScaling)
    if (previousViewportTransform && previousViewportTransform.length === 6) {
      canvas.setViewportTransform(previousViewportTransform as any)
    }

    canvas.renderAll()
  }
}
