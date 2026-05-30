// Opening placement helpers extracted from `src/fields/draw.ts`.
//
// Hosts the hover-ghost preview shown while a `draw-door` / `draw-window` /
// `draw-gate` tool is active. The class owns the small bit of mutable state
// (the current ghost rect + type) so that `DrawField` no longer has to track
// it directly. All geometry comes from `wall-snap.ts` — this module only
// renders + tracks state.
//
// Behavior MUST stay identical to the original inlined implementation:
// - Update is a no-op when the active tool isn't an opening tool.
// - When no wall is found near the pointer the ghost is cleared.
// - State change detection compares type + every rect field; identical
//   updates do not trigger an overlay re-render.
import type { LeftTop, WallSnap } from './wall-snap.js'

export type HoverGhostType = 'door' | 'window' | 'gate'
export type HoverGhostRect = {
  left: number
  top: number
  width: number
  height: number
  angle?: number
  originX?: 'left' | 'center' | 'right'
  originY?: 'top' | 'center' | 'bottom'
}
export type HoverGhostState = { rect: HoverGhostRect; type: HoverGhostType }

export type OpeningHoverGhostDeps = {
  findNearestWall: (pointer: LeftTop, maxDistance: number) => WallSnap | null
  getCenteredLayout: (
    action: string | undefined,
    pointer: LeftTop,
    wallSnap: WallSnap
  ) => {
    left: number
    top: number
    width: number
    height: number
    angle?: number
    originX?: 'left' | 'center' | 'right'
    originY?: 'top' | 'center' | 'bottom'
  }
}

export class OpeningHoverGhost {
  #state: HoverGhostState | null = null

  get state(): HoverGhostState | null {
    return this.#state
  }

  hasGhost(): boolean {
    return this.#state !== null
  }

  /** Force-clear without signaling. Mirrors a bare `this.#hoverGhost = null`. */
  reset(): void {
    this.#state = null
  }

  /** Clear and return whether state changed (so the caller can re-render). */
  clear(): boolean {
    if (!this.#state) return false
    this.#state = null
    return true
  }

  /**
   * Recompute the hover ghost for the current opening tool + pointer.
   * Returns true when state changed and the caller should schedule an
   * overlay re-render.
   */
  update(action: string | undefined, pointer: LeftTop, deps: OpeningHoverGhostDeps): boolean {
    if (action !== 'draw-door' && action !== 'draw-window' && action !== 'draw-gate') {
      return this.clear()
    }

    const wallSnap = deps.findNearestWall(pointer, 20)
    if (!wallSnap) return this.clear()

    const layout = deps.getCenteredLayout(action, pointer, wallSnap)
    const next: HoverGhostState = {
      rect: {
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        angle: layout.angle,
        originX: layout.originX,
        originY: layout.originY
      },
      type:
        action === 'draw-door' ? ('door' as const) : action === 'draw-window' ? ('window' as const) : ('gate' as const)
    }

    const prev = this.#state
    if (
      prev &&
      prev.type === next.type &&
      prev.rect.left === next.rect.left &&
      prev.rect.top === next.rect.top &&
      prev.rect.width === next.rect.width &&
      prev.rect.height === next.rect.height &&
      prev.rect.angle === next.rect.angle &&
      prev.rect.originX === next.rect.originX &&
      prev.rect.originY === next.rect.originY
    ) {
      return false
    }

    this.#state = next
    return true
  }

  /**
   * Render the ghost on an overlay 2D context. The caller supplies a
   * scene→viewport projector so this module stays decoupled from the
   * Fabric viewport transform.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    sceneToViewport: (point: { x: number; y: number }) => { x: number; y: number }
  ): void {
    if (!this.#state) return
    const { rect, type } = this.#state
    const angleDeg = rect.angle ?? 0
    const isCenterAnchored = rect.originX === 'center' && rect.originY === 'center'

    // Scene-space center of the ghost.
    const cxScene = isCenterAnchored ? rect.left : rect.left + rect.width / 2
    const cyScene = isCenterAnchored ? rect.top : rect.top + rect.height / 2
    const center = sceneToViewport({ x: cxScene, y: cyScene })

    // Half-extents in viewport units derived through the projector so we
    // honor canvas zoom.
    const edgeX = sceneToViewport({ x: cxScene + rect.width / 2, y: cyScene })
    const edgeY = sceneToViewport({ x: cxScene, y: cyScene + rect.height / 2 })
    const halfW = Math.hypot(edgeX.x - center.x, edgeX.y - center.y)
    const halfH = Math.hypot(edgeY.x - center.x, edgeY.y - center.y)
    const w = halfW * 2
    const h = halfH * 2

    ctx.save()
    ctx.translate(center.x, center.y)
    if (angleDeg) ctx.rotate((angleDeg * Math.PI) / 180)
    ctx.fillStyle = 'rgba(168, 84, 39, 0.18)'
    ctx.strokeStyle = '#a85427'
    ctx.lineWidth = 1.5
    ctx.setLineDash([6, 4])
    ctx.fillRect(-halfW, -halfH, w, h)
    ctx.strokeRect(-halfW, -halfH, w, h)
    ctx.setLineDash([])
    ctx.restore()

    // Label sits above the (un-rotated) center so it stays readable.
    const label = type.charAt(0).toUpperCase() + type.slice(1)
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
    const metrics = ctx.measureText(label)
    const padX = 5
    const badgeW = metrics.width + padX * 2
    const badgeH = 16
    const labelOffset = Math.max(halfW, halfH) + 12
    const bx = center.x - badgeW / 2
    const by = center.y - labelOffset - badgeH
    ctx.save()
    ctx.fillStyle = '#a85427'
    ctx.fillRect(bx, by, badgeW, badgeH)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, bx + padX, by + badgeH / 2)
    ctx.restore()
  }
}
