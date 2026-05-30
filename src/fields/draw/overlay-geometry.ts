// Shared geometry helpers for overlays drawn on top of the Fabric canvas
// (binding-label badges, architectural measurements, opening-placement
// hover ghost, …). These live outside any overlay class because more than
// one consumer needs them.
//
// Pure functions: they only read from the passed canvas/object and never
// mutate state.
import type { Canvas } from './../../fabric-imports.js'

export type Point = { x: number; y: number }
export type ViewportBounds = { left: number; top: number; width: number; height: number }

/**
 * Project a scene-space point through the canvas viewport transform to
 * viewport (CSS pixel) coordinates.
 */
export function sceneToViewport(canvas: Canvas, point: Point): Point {
  const vpt = (canvas as any).viewportTransform as number[] | undefined
  if (!vpt || vpt.length < 6) return point
  return {
    x: point.x * vpt[0] + point.y * vpt[2] + vpt[4],
    y: point.x * vpt[1] + point.y * vpt[3] + vpt[5]
  }
}

/**
 * Compute the viewport-space bounding box of a Fabric object using its
 * `getCoords()` corners projected through the current viewport transform.
 * Returns `null` if the object has no coordinates yet.
 */
export function getViewportBoundsForObject(canvas: Canvas, obj: any): ViewportBounds | null {
  const coords = typeof obj?.getCoords === 'function' ? obj.getCoords() : []
  if (!coords || coords.length === 0) return null

  const transformed = coords.map((point: any) =>
    sceneToViewport(canvas, {
      x: Number(point?.x ?? 0),
      y: Number(point?.y ?? 0)
    })
  )

  const xs = transformed.map((p: Point) => p.x)
  const ys = transformed.map((p: Point) => p.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return {
    left,
    top,
    width: Math.abs(right - left),
    height: Math.abs(bottom - top)
  }
}
