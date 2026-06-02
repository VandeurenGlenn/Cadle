// Binding-label overlay extracted from `src/fields/draw.ts`.
//
// Owns:
//  - The `bindingId → objects[]` lookup map and its scheduled refresh.
//  - The reentrancy guard around `refreshLookup` (CRITICAL: the
//    `binding-lookup-updated` event triggers consumers whose getters re-enter
//    the lookup, so the guard must wrap the entire dispatch).
//  - Drawing user-defined binding label badges on top of bound objects.
//  - Hit-testing those badges and tracking an in-progress label drag so the
//    user can reposition the badge by dragging it.
//
// Behavior MUST stay identical to the original inlined implementation.
import type { Canvas } from './../../fabric-imports.js'
import type { FabricObject } from 'fabric'
import { getViewportBoundsForObject, type Point } from './overlay-geometry.js'

type BindingObject = FabricObject & {
  bindingId?: string
  bindingLabel?: string
  bindingLabelOffset?: { dx: number; dy: number }
  symbolPath?: string
  symbolName?: string
}

type LabelHit = {
  obj: BindingObject
  rect: { x: number; y: number; width: number; height: number }
  anchor: { x: number; y: number }
}

type LabelDrag = {
  obj: BindingObject
  startPointerViewport: Point
  startOffset: { dx: number; dy: number }
  grabOffset: { dx: number; dy: number }
  moved: boolean
}

export interface BindingOverlayDeps {
  normalizeId: (raw) => string
  /**
   * Called after the lookup has been rebuilt. The reentrancy guard remains
   * active for the duration of this callback, so consumers can safely call
   * `getLookup()` / `getVersion()` without re-triggering refresh.
   */
  onLookupUpdated: (version: number) => void
}

export class BindingOverlay {
  #deps: BindingOverlayDeps
  #lookup = new Map<string, BindingObject[]>()
  #version = 0
  #scheduled = false
  #refreshing = false
  #labelHits: LabelHit[] = []
  #drag: LabelDrag | null = null

  constructor(deps: BindingOverlayDeps) {
    this.#deps = deps
  }

  // ── Lookup ─────────────────────────────────────────────────────────────
  getLookup(): Map<string, BindingObject[]> {
    return this.#lookup
  }

  getVersion(): number {
    return this.#version
  }

  refreshLookup(canvas: Canvas) {
    if (this.#refreshing) return
    this.#refreshing = true
    try {
      this.#lookup.clear()

      for (const obj of canvas.getObjects()) {
        if (!obj) continue
        const binding = obj as BindingObject
        const bindingId = this.#deps.normalizeId(binding.bindingId)
        if (!bindingId) continue

        const bucket = this.#lookup.get(bindingId)
        if (bucket) bucket.push(obj)
        else this.#lookup.set(bindingId, [obj])
      }

      this.#version += 1
      this.#deps.onLookupUpdated(this.#version)
    } finally {
      this.#refreshing = false
    }
  }

  scheduleRefresh(canvas: Canvas) {
    if (this.#scheduled) return
    this.#scheduled = true
    requestAnimationFrame(() => {
      this.#scheduled = false
      this.refreshLookup(canvas)
    })
  }

  // ── Label rendering ────────────────────────────────────────────────────
  /**
   * Draw a user-defined binding label badge for every labeled object on the
   * canvas. Captures hit rects for the current frame so subsequent mousedown
   * can detect a label drag start.
   */
  drawLabels(ctx: CanvasRenderingContext2D, canvas: Canvas) {
    const objects = canvas.getObjects()
    if (objects.length === 0) {
      this.#labelHits = []
      return
    }

    const overlapArea = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number }
    ) => {
      const x1 = Math.max(a.x, b.x)
      const y1 = Math.max(a.y, b.y)
      const x2 = Math.min(a.x + a.width, b.x + b.width)
      const y2 = Math.min(a.y + a.height, b.y + b.height)
      const w = x2 - x1
      const h = y2 - y1
      if (w <= 0 || h <= 0) return 0
      return w * h
    }

    const objectBounds = objects
      .map((object) => {
        const bounds = getViewportBoundsForObject(canvas, object)
        if (!bounds) return null
        return {
          object,
          rect: {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height
          }
        }
      })
      .filter(
        (
          entry
        ): entry is {
          object: BindingObject
          rect: { x: number; y: number; width: number; height: number }
        } => !!entry
      )

    const wallBounds = objectBounds
      .filter(({ object }) =>
        String(object.type ?? '')
          .toLowerCase()
          .includes('wall')
      )
      .map(({ object, rect }) => ({ object, rect }))

    const canvasW = canvas.getWidth()
    const canvasH = canvas.getHeight()

    ctx.save()
    ctx.font = '700 10px "IBM Plex Sans", "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    // Reset and re-collect hit rects for this overlay frame.
    this.#labelHits = []

    for (const obj of objects) {
      const bindingLabel = (obj as BindingObject).bindingLabel
      if (typeof bindingLabel !== 'string' || bindingLabel.trim().length === 0) continue

      const bounds = getViewportBoundsForObject(canvas, obj)
      if (!bounds) continue

      const text = bindingLabel.trim()
      const textWidth = ctx.measureText(text).width
      const padX = 5
      const badgeW = textWidth + padX * 2
      const badgeH = 16
      const gap = 6
      const r = 3
      const targetRect = {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height
      }

      const anchorX = bounds.left
      const anchorY = bounds.top

      let bx: number
      let by: number

      const manualOffset = (obj as BindingObject).bindingLabelOffset
      const isManual = manualOffset && Number.isFinite(manualOffset.dx) && Number.isFinite(manualOffset.dy)

      if (isManual) {
        bx = anchorX + manualOffset.dx
        by = anchorY + manualOffset.dy
      } else {
        const rawAngle = Number(obj.angle ?? 0)
        const norm = ((rawAngle % 360) + 360) % 360
        const cardinal = Math.round(norm / 90) % 4
        const frontSide: 'right' | 'down' | 'left' | 'up' =
          cardinal === 0 ? 'right' : cardinal === 1 ? 'down' : cardinal === 2 ? 'left' : 'up'

        const rightCandidates = [
          {
            x: bounds.left + bounds.width + gap,
            y: bounds.top + bounds.height / 2 - badgeH / 2,
            side: 'right-middle'
          },
          { x: bounds.left + bounds.width + gap, y: bounds.top, side: 'right-top' },
          {
            x: bounds.left + bounds.width + gap,
            y: bounds.top + bounds.height - badgeH,
            side: 'right-bottom'
          }
        ]
        const downCandidates = [
          {
            x: bounds.left + bounds.width / 2 - badgeW / 2,
            y: bounds.top + bounds.height + gap,
            side: 'bottom-center'
          },
          { x: bounds.left, y: bounds.top + bounds.height + gap, side: 'bottom-left' },
          {
            x: bounds.left + bounds.width - badgeW,
            y: bounds.top + bounds.height + gap,
            side: 'bottom-right'
          }
        ]
        const leftCandidates = [
          {
            x: bounds.left - badgeW - gap,
            y: bounds.top + bounds.height / 2 - badgeH / 2,
            side: 'left-middle'
          },
          { x: bounds.left - badgeW - gap, y: bounds.top, side: 'left-top' },
          { x: bounds.left - badgeW - gap, y: bounds.top + bounds.height - badgeH, side: 'left-bottom' }
        ]
        const upCandidates = [
          { x: bounds.left + bounds.width / 2 - badgeW / 2, y: bounds.top - badgeH - gap, side: 'top-center' },
          { x: bounds.left, y: bounds.top - badgeH - gap, side: 'top-left' },
          { x: bounds.left + bounds.width - badgeW, y: bounds.top - badgeH - gap, side: 'top-right' }
        ]

        const sideOrder: Array<'right' | 'down' | 'left' | 'up'> =
          frontSide === 'right'
            ? ['right', 'up', 'down', 'left']
            : frontSide === 'down'
              ? ['down', 'right', 'left', 'up']
              : frontSide === 'left'
                ? ['left', 'up', 'down', 'right']
                : ['up', 'right', 'left', 'down']

        const sideMap = {
          right: rightCandidates,
          down: downCandidates,
          left: leftCandidates,
          up: upCandidates
        } as const

        const candidates: Array<{ x: number; y: number; side: string; tier: number }> = []
        sideOrder.forEach((side, tier) => {
          for (const c of sideMap[side]) candidates.push({ ...c, tier })
        })

        let best = candidates[0]
        let bestScore = Number.POSITIVE_INFINITY

        for (const candidate of candidates) {
          const badgeRect = {
            x: candidate.x,
            y: candidate.y,
            width: badgeW,
            height: badgeH
          }

          let score = 0

          score += candidate.tier * 6

          if (badgeRect.x < 2) score += (2 - badgeRect.x) * 80
          if (badgeRect.y < 2) score += (2 - badgeRect.y) * 80
          if (badgeRect.x + badgeRect.width > canvasW - 2) score += (badgeRect.x + badgeRect.width - (canvasW - 2)) * 80
          if (badgeRect.y + badgeRect.height > canvasH - 2)
            score += (badgeRect.y + badgeRect.height - (canvasH - 2)) * 80

          score += overlapArea(badgeRect, targetRect) * 1000

          for (const wall of wallBounds) {
            if (wall.object === obj) continue
            score += overlapArea(badgeRect, wall.rect) * 30
          }

          for (const entry of objectBounds) {
            if (entry.object === obj) continue
            score += overlapArea(badgeRect, entry.rect) * 4
          }

          if (score < bestScore) {
            bestScore = score
            best = candidate
          }
        }

        bx = best.x
        by = best.y
      }

      this.#labelHits.push({
        obj,
        rect: { x: bx, y: by, width: badgeW, height: badgeH },
        anchor: { x: anchorX, y: anchorY }
      })

      // Rounded-rect badge background
      ctx.fillStyle = '#a85427'
      ctx.beginPath()
      ctx.moveTo(bx + r, by)
      ctx.lineTo(bx + badgeW - r, by)
      ctx.arcTo(bx + badgeW, by, bx + badgeW, by + r, r)
      ctx.lineTo(bx + badgeW, by + badgeH - r)
      ctx.arcTo(bx + badgeW, by + badgeH, bx + badgeW - r, by + badgeH, r)
      ctx.lineTo(bx + r, by + badgeH)
      ctx.arcTo(bx, by + badgeH, bx, by + badgeH - r, r)
      ctx.lineTo(bx, by + r)
      ctx.arcTo(bx, by, bx + r, by, r)
      ctx.closePath()
      ctx.fill()

      // Badge text
      ctx.fillStyle = '#ffffff'
      ctx.fillText(text, bx + padX, by + badgeH / 2)
    }

    ctx.restore()
  }

  // ── Hit-test + drag ────────────────────────────────────────────────────
  hasHits(): boolean {
    return this.#labelHits.length > 0
  }

  /** Returns the topmost label hit at the given viewport point, or null. */
  hitTestLabel(viewportPoint: Point): LabelHit | null {
    for (let i = this.#labelHits.length - 1; i >= 0; i--) {
      const hit = this.#labelHits[i]
      const r = hit.rect
      if (
        viewportPoint.x >= r.x &&
        viewportPoint.x <= r.x + r.width &&
        viewportPoint.y >= r.y &&
        viewportPoint.y <= r.y + r.height
      ) {
        return hit
      }
    }
    return null
  }

  isOverAnyLabel(viewportPoint: Point): boolean {
    return this.#labelHits.some(
      (h) =>
        viewportPoint.x >= h.rect.x &&
        viewportPoint.x <= h.rect.x + h.rect.width &&
        viewportPoint.y >= h.rect.y &&
        viewportPoint.y <= h.rect.y + h.rect.height
    )
  }

  beginDrag(hit: LabelHit, viewportPoint: Point) {
    const existing = hit.obj.bindingLabelOffset
    const startOffset =
      existing && Number.isFinite(existing.dx) && Number.isFinite(existing.dy)
        ? { dx: existing.dx, dy: existing.dy }
        : { dx: hit.rect.x - hit.anchor.x, dy: hit.rect.y - hit.anchor.y }
    this.#drag = {
      obj: hit.obj,
      startPointerViewport: { x: viewportPoint.x, y: viewportPoint.y },
      startOffset,
      grabOffset: { dx: viewportPoint.x - hit.rect.x, dy: viewportPoint.y - hit.rect.y },
      moved: false
    }
  }

  isDragging(): boolean {
    return this.#drag !== null
  }

  /**
   * Update the dragged label's offset. Returns true if state changed and the
   * caller should re-render the overlay.
   */
  updateDrag(viewportPoint: Point): boolean {
    if (!this.#drag) return false
    const drag = this.#drag
    const newBadgeX = viewportPoint.x - drag.grabOffset.dx
    const newBadgeY = viewportPoint.y - drag.grabOffset.dy
    const hit = this.#labelHits.find((h) => h.obj === drag.obj)
    const anchor = hit?.anchor ?? { x: 0, y: 0 }
    const dx = newBadgeX - anchor.x
    const dy = newBadgeY - anchor.y
    drag.obj.bindingLabelOffset = { dx, dy }
    drag.moved = true
    return true
  }

  /** End the active label drag and report whether the label actually moved. */
  endDrag(): { moved: boolean } {
    const drag = this.#drag
    this.#drag = null
    return { moved: drag?.moved ?? false }
  }
}
