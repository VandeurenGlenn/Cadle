import type { Point } from '../../editor/model/types.js'

export type ViewportState = Readonly<{
  zoom: number
  panX: number
  panY: number
}>

export type Size = Readonly<{ width: number; height: number }>
export type Bounds = Readonly<{ x: number; y: number; width: number; height: number }>

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

  preserveCenter(previous: Size, next: Size): boolean {
    if (previous.width <= 0 || previous.height <= 0 || next.width <= 0 || next.height <= 0) return false
    this.#panX += (next.width - previous.width) / 2
    this.#panY += (next.height - previous.height) / 2
    return true
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

  fitBounds(container: Size, bounds: Bounds, margin = 32, minimumZoom = MIN_ZOOM): boolean {
    if (container.width <= 0 || container.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return false
    const availableWidth = Math.max(1, container.width - margin * 2)
    const availableHeight = Math.max(1, container.height - margin * 2)
    this.#zoom = this.#clampZoom(
      Math.max(minimumZoom, Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height))
    )
    this.#panX = (container.width - bounds.width * this.#zoom) / 2 - bounds.x * this.#zoom
    this.#panY = (container.height - bounds.height * this.#zoom) / 2 - bounds.y * this.#zoom
    return true
  }

  #clampZoom(zoom: number): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
  }
}
