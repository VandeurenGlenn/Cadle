export const formatDimensionLabel = (lengthInPixels: number) => {
  const lengthInCentimeters = (Math.max(0, lengthInPixels) / 50) * 100
  if (lengthInCentimeters >= 100) {
    const meters = Math.round((lengthInCentimeters / 100) * 100) / 100
    return `${meters} m`
  }

  const rounded = Math.round(lengthInCentimeters)
  return `${rounded} cm`
}

export const drawDimensionLabel = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  rotate = false
) => {
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

export const drawArrowHead = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 7) => {
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + Math.cos(angle + Math.PI / 6) * size, y + Math.sin(angle + Math.PI / 6) * size)
  ctx.moveTo(x, y)
  ctx.lineTo(x + Math.cos(angle - Math.PI / 6) * size, y + Math.sin(angle - Math.PI / 6) * size)
  ctx.stroke()
}

export const drawHorizontalDimension = (
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  label: string
) => {
  const extension = 12
  const offset = Math.max(20, Math.min(32, height + 8))
  const y = top - offset
  const x1 = left
  const x2 = left + width

  ctx.beginPath()
  ctx.moveTo(x1, top)
  ctx.lineTo(x1, y + extension)
  ctx.moveTo(x2, top)
  ctx.lineTo(x2, y + extension)
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()

  drawArrowHead(ctx, x1, y, 0)
  drawArrowHead(ctx, x2, y, Math.PI)
  drawDimensionLabel(ctx, left + width / 2, y - 4, label)
}

export const drawVerticalDimension = (
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  label: string
) => {
  const extension = 12
  const offset = Math.max(20, Math.min(32, width + 8))
  const x = left - offset
  const y1 = top
  const y2 = top + height

  ctx.beginPath()
  ctx.moveTo(left, y1)
  ctx.lineTo(x + extension, y1)
  ctx.moveTo(left, y2)
  ctx.lineTo(x + extension, y2)
  ctx.moveTo(x, y1)
  ctx.lineTo(x, y2)
  ctx.stroke()

  drawArrowHead(ctx, x, y1, Math.PI / 2)
  drawArrowHead(ctx, x, y2, -Math.PI / 2)
  drawDimensionLabel(ctx, x - 4, top + height / 2, label, true)
}

export const sceneToViewport = (point: { x: number; y: number }, viewportTransform: number[] | undefined) => {
  if (!viewportTransform || viewportTransform.length < 6) return point
  return {
    x: point.x * viewportTransform[0] + point.y * viewportTransform[2] + viewportTransform[4],
    y: point.x * viewportTransform[1] + point.y * viewportTransform[3] + viewportTransform[5]
  }
}

import type { Canvas } from './../../fabric-imports.js'
import type { FabricObject } from 'fabric'

type CanvasWithMeasurementContext = Canvas & {
  contextTop?: CanvasRenderingContext2D
  upperCanvasEl?: HTMLCanvasElement
}

export const getMeasurementOverlayContext = (canvas: CanvasWithMeasurementContext) => {
  const topContext = canvas.contextTop || canvas.upperCanvasEl?.getContext('2d')
  if (!topContext) return undefined

  if (!canvas?.contextTop) canvas.contextTop = topContext
  canvas.clearContext(topContext)
  return topContext
}

export const getMeasurementTargets = (canvas: Canvas) =>
  canvas
    .getObjects()
    .filter((obj): obj is FabricObject => !!obj && (obj.type === 'CadleWall' || obj.type === 'CadleWindow'))

export const intervalsOverlap = (a: [number, number], b: [number, number], margin = 12) =>
  !(a[1] + margin < b[0] || b[1] + margin < a[0])

export const assignDimensionLane = (lanes: Array<Array<[number, number]>>, interval: [number, number]) => {
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

export const drawArchitecturalSideDimension = (
  ctx: CanvasRenderingContext2D,
  segment: {
    left: number
    top: number
    width: number
    height: number
    centerX: number
    centerY: number
    isHorizontal: boolean
    label: string
  },
  planBounds: { left: number; top: number; right: number; bottom: number; centerX: number; centerY: number },
  laneState: {
    top: Array<Array<[number, number]>>
    bottom: Array<Array<[number, number]>>
    left: Array<Array<[number, number]>>
    right: Array<Array<[number, number]>>
  }
) => {
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

export const getViewportBoundsForObject = (canvas: Canvas, obj: FabricObject) => {
  const coords = typeof obj?.getCoords === 'function' ? obj.getCoords() : ([] as Array<{ x: number; y: number }>)
  if (!coords || coords.length === 0) return null

  const transformed = coords.map((point) =>
    sceneToViewport(
      {
        x: Number(point?.x ?? 0),
        y: Number(point?.y ?? 0)
      },
      canvas.viewportTransform as number[] | undefined
    )
  )

  const xs = transformed.map((point: { x: number; y: number }) => point.x)
  const ys = transformed.map((point: { x: number; y: number }) => point.y)
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

export const renderArchitecturalMeasurements = (
  canvas: CanvasWithMeasurementContext,
  showMeasurements: boolean,
  ctx?: CanvasRenderingContext2D
) => {
  const targetCtx = ctx ?? getMeasurementOverlayContext(canvas)
  if (!targetCtx) return
  if (!ctx) canvas.clearContext(targetCtx)
  if (!showMeasurements) return

  targetCtx.save()
  targetCtx.strokeStyle = '#3d2f25'
  targetCtx.fillStyle = '#3d2f25'
  targetCtx.lineWidth = 1.2
  targetCtx.setLineDash([])
  targetCtx.font = '600 11px "IBM Plex Sans", "Segoe UI", sans-serif'

  const targets = getMeasurementTargets(canvas)
  if (targets.length === 0) {
    targetCtx.restore()
    return
  }

  const segments: Array<{
    left: number
    top: number
    width: number
    height: number
    centerX: number
    centerY: number
    isHorizontal: boolean
    label: string
  }> = []

  for (const obj of targets) {
    const bounds = getViewportBoundsForObject(canvas, obj)
    if (!bounds) continue
    const { left, top, width, height } = bounds
    if (!width || !height) continue

    const isHorizontal = width >= height
    const sceneLength = isHorizontal
      ? Math.abs(Number(obj?.width ?? 0) * Number(obj?.scaleX ?? 1))
      : Math.abs(Number(obj?.height ?? 0) * Number(obj?.scaleY ?? 1))
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
    targetCtx.restore()
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

  const laneState = {
    top: [] as Array<Array<[number, number]>>,
    bottom: [] as Array<Array<[number, number]>>,
    left: [] as Array<Array<[number, number]>>,
    right: [] as Array<Array<[number, number]>>
  }

  const orderedSegments = [...segments].sort((a, b) =>
    a.isHorizontal === b.isHorizontal ? 0 : a.isHorizontal ? -1 : 1
  )

  for (const segment of orderedSegments) {
    drawArchitecturalSideDimension(targetCtx, segment, planBounds, laneState)
  }

  targetCtx.restore()
}
