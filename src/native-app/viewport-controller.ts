import type { Point } from '../native-draw/types.js'

export type ViewportState = Readonly<{
  zoom: number
  panX: number
  panY: number
}>

export type Size = Readonly<{ width: number; height: number }>

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

/** Keeps viewport transforms and zoom invariants out of the editor element. */
export class ViewportController {
  #zoom = 1
  #panX = 0
  #panY = 0

  get state(): ViewportState {
    return { zoom: this.#zoom, panX: this.#panX, panY: this.#panY }
  }

  screenToWorld(point: Point): Point {
    return {
      x: (point.x - this.#panX) / this.#zoom,
      y: (point.y - this.#panY) / this.#zoom
    }
  }

  zoomAt(point: Point, factor: number): boolean {
    if (!Number.isFinite(factor) || factor <= 0) return false
    const nextZoom = this.#clampZoom(this.#zoom * factor)
    if (nextZoom === this.#zoom) return false

    this.#panX = point.x - (point.x - this.#panX) * (nextZoom / this.#zoom)
    this.#panY = point.y - (point.y - this.#panY) * (nextZoom / this.#zoom)
    this.#zoom = nextZoom
    return true
  }

  panBy(dx: number, dy: number): void {
    if (Number.isFinite(dx)) this.#panX += dx
    if (Number.isFinite(dy)) this.#panY += dy
  }

  setPan(panX: number, panY: number): void {
    if (Number.isFinite(panX)) this.#panX = panX
    if (Number.isFinite(panY)) this.#panY = panY
  }

  fit(container: Size, world: Size, margin = 12): boolean {
    if (container.width <= 0 || container.height <= 0 || world.width <= 0 || world.height <= 0) return false
    const availableWidth = Math.max(1, container.width - margin * 2)
    const availableHeight = Math.max(1, container.height - margin * 2)
    this.#zoom = this.#clampZoom(Math.min(1, availableWidth / world.width, availableHeight / world.height))
    this.#panX = (container.width - world.width * this.#zoom) / 2
    this.#panY = (container.height - world.height * this.#zoom) / 2
    return true
  }

  #clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
  }
}
