import type { Canvas } from './../../fabric-imports.js'

const STORAGE_KEY = 'cadle.zoomLevel'
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3

export interface ZoomControllerOptions {
  getCanvas: () => Canvas
  getWidth: () => number
  getHeight: () => number
  onChange: (zoom: number) => void
}

/**
 * Owns the canvas zoom level: clamping, persistence, fit-to-content, and
 * notifying the host element so its `@property zoomLevel` stays in sync.
 *
 * The host element keeps its reactive `zoomLevel` property for template
 * rendering; this controller is the source of truth for the value and pushes
 * updates through `onChange`.
 */
export class ZoomController {
  #zoomLevel = 1
  #options: ZoomControllerOptions

  constructor(options: ZoomControllerOptions) {
    this.#options = options
  }

  getZoom(): number {
    return this.#zoomLevel
  }

  /**
   * Read the persisted zoom from localStorage (defaulting to 1) and apply it
   * to the canvas. Called once after the canvas is created.
   */
  loadInitial() {
    const storedZoom = Number(globalThis.localStorage?.getItem(STORAGE_KEY))
    const next = Number.isFinite(storedZoom) && storedZoom > 0 ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, storedZoom)) : 1
    this.#zoomLevel = next
    this.#options.getCanvas().setZoom(next)
    this.#options.onChange(next)
  }

  setZoom(zoom: number) {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
    if (this.#zoomLevel === newZoom) return

    const canvas = this.#options.getCanvas()
    const center = { x: this.#options.getWidth() / 2, y: this.#options.getHeight() / 2 }
    this.#zoomLevel = newZoom
    canvas.zoomToPoint(center as any, newZoom)
    canvas.renderAll()
    this.#options.onChange(newZoom)
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, String(newZoom))
    } catch {
      /* localStorage unavailable — fine */
    }
  }

  zoomIn() {
    this.setZoom(this.#zoomLevel * 1.2)
  }

  zoomOut() {
    this.setZoom(this.#zoomLevel / 1.2)
  }

  /**
   * Reset is an alias for fit-to-container — the toolbar's "reset" button
   * fits content rather than snapping back to 100%.
   */
  reset() {
    this.fitToContainer()
  }

  /**
   * Compute a viewport transform that fits all visible canvas objects within
   * the available width/height (capped at 100% so we never zoom IN
   * automatically). Updates the canvas viewport and notifies the host.
   */
  fitToContainer() {
    const canvas = this.#options.getCanvas()
    const width = this.#options.getWidth()
    const height = this.#options.getHeight()
    const objects = canvas.getObjects().filter((obj: any) => obj && obj.visible !== false)

    if (objects.length === 0) {
      this.#zoomLevel = 1
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      canvas.renderAll()
      this.#options.onChange(1)
      return
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

    const contentWidth = Math.max(1, maxRight - minLeft)
    const contentHeight = Math.max(1, maxBottom - minTop)
    const margin = 28
    const availableWidth = Math.max(1, width - margin * 2)
    const availableHeight = Math.max(1, height - margin * 2)
    // Cap auto-fit at 100%: zooming IN automatically (e.g. to 300% for a
    // small scene) is disorienting. Only zoom OUT to make large content fit.
    const fitZoom = Math.max(
      MIN_ZOOM,
      Math.min(1, Math.min(availableWidth / contentWidth, availableHeight / contentHeight))
    )

    this.#zoomLevel = fitZoom

    const translateX = width / 2 - (minLeft + contentWidth / 2) * fitZoom
    const translateY = height / 2 - (minTop + contentHeight / 2) * fitZoom

    canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, translateX, translateY])
    canvas.renderAll()
    this.#options.onChange(fitZoom)
  }
}
