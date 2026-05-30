// Architectural-measurement overlay extracted from `src/fields/draw.ts`.
//
// Owns:
//  - The animation-frame scheduling flag for overlay re-renders.
//  - Drawing wall + window dimension lines outside the floor plan.
//  - Lane assignment (so dimensions stack instead of overlapping).
//
// The host element still owns "what to render BEFORE the architectural
// measurements" (binding labels + opening hover ghost). Those are passed in
// as `preRender` callback so this module stays focused on dimensioning.
//
// Behavior MUST stay identical to the original inlined implementation.
import type { Canvas } from './../../fabric-imports.js'
import { getViewportBoundsForObject } from './overlay-geometry.js'

export interface MeasurementOverlayDeps {
  /** Always called before the architectural dimensions, even when the
   *  measurement toggle is off (e.g. binding labels and hover ghost). */
  preRender: (ctx: CanvasRenderingContext2D) => void
  /** Whether the architectural measurement layer is currently visible. */
  isEnabled: () => boolean
}

type Segment = {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
  isHorizontal: boolean
  label: string
}

type LaneState = {
  top: Array<Array<[number, number]>>
  bottom: Array<Array<[number, number]>>
  left: Array<Array<[number, number]>>
  right: Array<Array<[number, number]>>
}

export class MeasurementOverlay {
  #deps: MeasurementOverlayDeps
  #scheduled = false

  constructor(deps: MeasurementOverlayDeps) {
    this.#deps = deps
  }

  /**
   * Coalesce multiple render requests within a single animation frame.
   */
  schedule(canvas: Canvas) {
    if (this.#scheduled) return
    this.#scheduled = true
    requestAnimationFrame(() => {
      this.#scheduled = false
      this.render(canvas)
    })
  }

  /**
   * Render the overlay synchronously. Always invokes the `preRender` deps
   * callback first; the architectural dimensions are only drawn when
   * `isEnabled()` returns true.
   */
  render(canvas: Canvas) {
    const ctx = this.#getContext(canvas)
    if (!ctx) return

    this.#deps.preRender(ctx)

    if (!this.#deps.isEnabled()) return

    ctx.save()
    ctx.strokeStyle = '#3d2f25'
    ctx.fillStyle = '#3d2f25'
    ctx.lineWidth = 1.2
    ctx.setLineDash([])
    ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'

    const targets = this.#getTargets(canvas)
    if (targets.length === 0) {
      ctx.restore()
      return
    }

    const segments: Segment[] = []

    for (const obj of targets) {
      const bounds = getViewportBoundsForObject(canvas, obj)
      if (!bounds) continue
      const { left, top, width, height } = bounds

      if (!width || !height) continue

      const isHorizontal = width >= height
      const sceneLength = isHorizontal
        ? Math.abs(Number((obj as any)?.width ?? 0) * Number((obj as any)?.scaleX ?? 1))
        : Math.abs(Number((obj as any)?.height ?? 0) * Number((obj as any)?.scaleY ?? 1))
      const label = formatDimensionLabel(sceneLength)

      segments.push({
        left,
        top,
        width,
        height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        isHorizontal,
        label
      })
    }

    if (segments.length === 0) {
      ctx.restore()
      return
    }

    const planBounds = {
      left: Math.min(...segments.map((segment) => segment.left)),
      top: Math.min(...segments.map((segment) => segment.top)),
      right: Math.max(...segments.map((segment) => segment.left + segment.width)),
      bottom: Math.max(...segments.map((segment) => segment.top + segment.height)),
      centerX: 0,
      centerY: 0
    }
    planBounds.centerX = (planBounds.left + planBounds.right) / 2
    planBounds.centerY = (planBounds.top + planBounds.bottom) / 2

    const laneState: LaneState = {
      top: [],
      bottom: [],
      left: [],
      right: []
    }

    const orderedSegments = [...segments].sort((a, b) =>
      a.isHorizontal === b.isHorizontal ? 0 : a.isHorizontal ? -1 : 1
    )
    for (const segment of orderedSegments) {
      drawArchitecturalSideDimension(ctx, segment, planBounds, laneState)
    }

    ctx.restore()
  }

  // ── Internals ──────────────────────────────────────────────────────────
  #getContext(canvas: Canvas): CanvasRenderingContext2D | undefined {
    const topContext = (canvas as any).contextTop as CanvasRenderingContext2D | undefined
    if (!topContext) return undefined
    canvas.clearContext(topContext)
    return topContext
  }

  #getTargets(canvas: Canvas) {
    return canvas.getObjects().filter((obj: any) => obj && (obj.type === 'CadleWall' || obj.type === 'CadleWindow'))
  }
}

// ── Dimension drawing helpers (pure) ───────────────────────────────────
function formatDimensionLabel(lengthInPixels: number) {
  const lengthInCentimeters = (Math.max(0, lengthInPixels) / 50) * 100
  if (lengthInCentimeters >= 100) {
    const meters = Math.round((lengthInCentimeters / 100) * 100) / 100
    return `${meters} m`
  }

  const rounded = Math.round(lengthInCentimeters)
  return `${rounded} cm`
}

function drawDimensionLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, rotate = false) {
  ctx.save()
  if (rotate) {
    ctx.translate(x, y)
    ctx.rotate(-Math.PI / 2)
    x = 0
    y = 0
  }

  ctx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'
  const textWidth = ctx.measureText(text).width
  const paddingX = 6
  const paddingY = 4
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = 18

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillRect(x - boxWidth / 2, y - boxHeight + paddingY, boxWidth, boxHeight)
  ctx.strokeStyle = 'rgba(52, 40, 30, 0.35)'
  ctx.lineWidth = 1
  ctx.strokeRect(x - boxWidth / 2, y - boxHeight + paddingY, boxWidth, boxHeight)

  ctx.fillStyle = '#3d2f25'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 7) {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + Math.cos(angle + Math.PI / 6) * size, y + Math.sin(angle + Math.PI / 6) * size)
  ctx.moveTo(x, y)
  ctx.lineTo(x + Math.cos(angle - Math.PI / 6) * size, y + Math.sin(angle - Math.PI / 6) * size)
  ctx.stroke()
}

function intervalsOverlap(a: [number, number], b: [number, number], margin = 12) {
  return !(a[1] + margin < b[0] || b[1] + margin < a[0])
}

function assignDimensionLane(lanes: Array<Array<[number, number]>>, interval: [number, number]) {
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex]
    const blocked = lane.some((existing) => intervalsOverlap(existing, interval))
    if (!blocked) {
      lane.push(interval)
      return laneIndex
    }
  }

  lanes.push([interval])
  return lanes.length - 1
}

function drawArchitecturalSideDimension(
  ctx: CanvasRenderingContext2D,
  segment: Segment,
  planBounds: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number },
  laneState: LaneState
) {
  const baseOffset = 28
  const laneStep = 24

  if (segment.isHorizontal) {
    const side = segment.centerY <= planBounds.centerY ? 'top' : 'bottom'
    const interval: [number, number] = [segment.left, segment.left + segment.width]
    const laneIndex = assignDimensionLane(laneState[side], interval)
    const y =
      side === 'top'
        ? planBounds.top - (baseOffset + laneIndex * laneStep)
        : planBounds.bottom + (baseOffset + laneIndex * laneStep)

    const x1 = segment.left
    const x2 = segment.left + segment.width
    const yRef = side === 'top' ? segment.top : segment.top + segment.height

    ctx.beginPath()
    ctx.moveTo(x1, yRef)
    ctx.lineTo(x1, y)
    ctx.moveTo(x2, yRef)
    ctx.lineTo(x2, y)
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()

    drawArrowHead(ctx, x1, y, 0)
    drawArrowHead(ctx, x2, y, Math.PI)

    drawDimensionLabel(ctx, (x1 + x2) / 2, side === 'top' ? y - 4 : y + 18, segment.label)
    return
  }

  const side = segment.centerX <= planBounds.centerX ? 'left' : 'right'
  const interval: [number, number] = [segment.top, segment.top + segment.height]
  const laneIndex = assignDimensionLane(laneState[side], interval)
  const x =
    side === 'left'
      ? planBounds.left - (baseOffset + laneIndex * laneStep)
      : planBounds.right + (baseOffset + laneIndex * laneStep)

  const y1 = segment.top
  const y2 = segment.top + segment.height
  const xRef = side === 'left' ? segment.left : segment.left + segment.width

  ctx.beginPath()
  ctx.moveTo(xRef, y1)
  ctx.lineTo(x, y1)
  ctx.moveTo(xRef, y2)
  ctx.lineTo(x, y2)
  ctx.moveTo(x, y1)
  ctx.lineTo(x, y2)
  ctx.stroke()

  drawArrowHead(ctx, x, y1, Math.PI / 2)
  drawArrowHead(ctx, x, y2, -Math.PI / 2)

  drawDimensionLabel(ctx, side === 'left' ? x - 4 : x + 14, (y1 + y2) / 2, segment.label, true)
}
