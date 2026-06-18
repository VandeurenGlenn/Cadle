import { Rect, classRegistry } from 'fabric'
import type { Canvas } from 'fabric'
import type { JsonValue } from '../types.js'
import { getWallEndpoints, type Point, type WallObject } from '../fields/draw/wall-geometry.js'
import defaultOptions from './default-options.js'
import { CadleDepth } from './depth.js'
import { CadleWidth } from './width.js'
import { canvasInk, canvasWallFill } from './canvas-tokens.js'

type WallOptions = {
  uuid?: string
  bindingId?: string
  situationMetadata?: Record<string, JsonValue>
  wallThickness?: number
  wallPoints?: Point[]
  [key: string]: unknown
}

export default class CadleWall extends Rect {
  static type = 'CadleWall'

  rect: Rect
  _widthText: CadleWidth
  _depthText: CadleDepth
  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  readonly situationElementType = 'wall' as const
  situationMetadata?: Record<string, JsonValue>
  wallThickness?: number
  wallPoints?: Point[]

  declare scaleX: number
  declare scaleY: number

  isHorizontal: boolean

  // Object caching is disabled because `_render` paints the corner-closing caps
  // beyond the rect bounds (Fabric's cache canvas is sized to rect + 2px and
  // would clip them). Rendered output for orthogonal walls is unchanged.
  objectCaching = false

  set widthText(value: CadleWidth) {
    this._widthText = value
    const canvas = cadleShell?.field?.canvas as Canvas | null
    if (canvas && !canvas.getObjects().includes(value)) canvas.add(value)
  }

  set depthText(value: CadleDepth) {
    this._depthText = value
    const canvas = cadleShell?.field?.canvas as Canvas | null
    if (canvas && !canvas.getObjects().includes(value)) canvas.add(value)
  }

  get widthText() {
    return this._widthText
  }

  get depthText() {
    return this._depthText
  }

  initWidthText() {
    this.widthText = new CadleWidth(String((this.width / 50) * 100), {
      left: this.left,
      top: this.top + this.height + 20,
      fontSize: 16,
      fill: canvasInk(),
      visible: cadleShell.showMeasurements
    })
  }

  initDepthText() {
    this.depthText = new CadleDepth(String((this.height / 50) * 100), {
      left: this.left + this.width / 2,
      top: this.top + this.height + 20,
      fontSize: 16,
      fill: canvasInk(),
      visible: cadleShell.showMeasurements
    })
  }

  constructor(options: WallOptions = {}) {
    super()

    this.on('added', () => {
      const canvas = this.canvas as unknown as { sendToBack?: (object: unknown) => void } | null
      if (canvas?.sendToBack) canvas.sendToBack(this)
    })

    if (!options.uuid) {
      this.uuid = crypto.randomUUID()
    } else {
      this.uuid = (
        typeof options.uuid === 'string' ? options.uuid : crypto.randomUUID()
      ) as `${string}-${string}-${string}-${string}-${string}`
    }

    if (typeof options?.bindingId === 'string') this.bindingId = options.bindingId
    if (options?.situationMetadata && typeof options.situationMetadata === 'object') {
      this.situationMetadata = options.situationMetadata
    }

    if (typeof options?.wallThickness === 'number') this.wallThickness = options.wallThickness
    if (Array.isArray(options?.wallPoints))
      this.wallPoints = options.wallPoints.map((point) => ({ x: point.x, y: point.y }))

    this.initWidthText()
    // this.initDepthText()
    this.set({ ...defaultOptions, ...options })

    const canvas = cadleShell?.field?.canvas as Canvas | undefined
    canvas?.requestRenderAll()
  }

  /**
   * Paint the base rectangle, then extend connected endpoints by half a wall
   * thickness to remove visual corner cutouts. Connected ends are rounded so
   * orthogonal joins render as smooth corners instead of hard miters.
   *
   * Important: Fabric `Rect` renders in center-local coordinates
   * (x in [-width/2, width/2], y in [-height/2, height/2]). Cap placement
   * must therefore anchor at +/- halfWidth, not at 0/width.
   */
  _render(ctx: CanvasRenderingContext2D) {
    if (Array.isArray(this.wallPoints) && this.wallPoints.length >= 2) {
      const fillRaw = this.fill
      const strokeRaw = this.stroke
      const strokeColor =
        typeof strokeRaw === 'string' && strokeRaw.toLowerCase() !== 'transparent'
          ? strokeRaw
          : typeof fillRaw === 'string' && fillRaw.toLowerCase() !== 'transparent'
            ? fillRaw
            : canvasWallFill()
      const thickness = Number(this.wallThickness ?? 0) || Math.max(1, Math.min(this.width ?? 0, this.height ?? 0))
      const halfWidth = Math.abs(Number(this.width ?? 0)) / 2
      const halfHeight = Math.abs(Number(this.height ?? 0)) / 2
      const dashArray = Array.isArray(this.strokeDashArray) ? this.strokeDashArray : null

      ctx.save()
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = thickness
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (dashArray) ctx.setLineDash(dashArray)
      ctx.beginPath()

      const [firstPoint, ...restPoints] = this.wallPoints
      ctx.moveTo(firstPoint.x - halfWidth, firstPoint.y - halfHeight)
      for (const point of restPoints) {
        ctx.lineTo(point.x - halfWidth, point.y - halfHeight)
      }

      ctx.stroke()
      ctx.restore()
      return
    }

    super._render(ctx)

    const angle = Number(this.angle ?? 0)
    const originY = this.originY ?? 'top'
    const isFreeAngle = originY === 'center' || (angle !== 0 && angle !== 180)
    const fillRaw = this.fill
    const fill = typeof fillRaw === 'string' && fillRaw.toLowerCase() !== 'transparent' ? fillRaw : canvasWallFill()

    const localThickness = Math.abs(Number(this.height ?? 0))
    const localHalfThickness = localThickness / 2
    const localWidth = Math.abs(Number(this.width ?? 0))
    const localHalfWidth = localWidth / 2
    const joinTolerance = localHalfThickness * Math.abs(Number(this.scaleY ?? 1))
    const radius = Math.min(localHalfThickness, 6)
    if (!localWidth || !localHalfThickness) return

    ctx.save()
    ctx.fillStyle = fill

    const [startPoint, endPoint] = getWallEndpoints(this as unknown as WallObject)
    const startCapLength = this.#capLengthForEnd(startPoint, joinTolerance, localHalfThickness, isFreeAngle)
    const endCapLength = this.#capLengthForEnd(endPoint, joinTolerance, localHalfThickness, isFreeAngle)

    if (startCapLength) {
      this.#fillEndCap(
        ctx,
        -localHalfWidth - startCapLength,
        -localHalfThickness,
        startCapLength,
        localThickness,
        radius,
        true
      )
    }

    if (endCapLength) {
      this.#fillEndCap(ctx, localHalfWidth, -localHalfThickness, endCapLength, localThickness, radius, false)
    }

    ctx.restore()
  }

  #fillEndCap(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    startAtLeft: boolean
  ) {
    if (radius <= 0) {
      ctx.fillRect(x, y, width, height)
      return
    }

    ctx.beginPath()
    if (startAtLeft) {
      ctx.moveTo(x + radius, y)
      ctx.lineTo(x + width, y)
      ctx.lineTo(x + width, y + height)
      ctx.lineTo(x + radius, y + height)
      ctx.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI, false)
      ctx.lineTo(x, y + radius)
      ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false)
    } else {
      ctx.moveTo(x, y)
      ctx.lineTo(x + width - radius, y)
      ctx.arc(x + width - radius, y + radius, radius, Math.PI * 1.5, 0, false)
      ctx.lineTo(x + width, y + height - radius)
      ctx.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2, false)
      ctx.lineTo(x, y + height)
    }

    ctx.closePath()
    ctx.fill()
  }

  // Return half-thickness cap length when this endpoint is connected and
  // needs a geometric closure. Orthogonal-to-orthogonal joins don't need caps.
  #capLengthForEnd(point: Point, joinTolerance: number, halfThickness: number, isFreeAngle: boolean): number {
    const canvas = this.canvas as Canvas | null
    if (!canvas) return 0

    const toleranceSquared = joinTolerance * joinTolerance
    for (const object of canvas.getObjects()) {
      if (object === this || (object as { type?: string }).type !== 'CadleWall') continue
      const other = object as WallObject
      const otherAngle = Number(other.angle ?? 0)
      const otherOriginY = other.originY ?? 'top'
      const otherIsFreeAngle = otherOriginY === 'center' || (otherAngle !== 0 && otherAngle !== 180)

      for (const endpoint of getWallEndpoints(other)) {
        const dx = endpoint.x - point.x
        const dy = endpoint.y - point.y
        if (dx * dx + dy * dy > toleranceSquared) continue
        if (!isFreeAngle && !otherIsFreeAngle) return 0
        return halfThickness
      }
    }
    return 0
  }

  // True when `point` coincides with any other wall endpoint that requires an
  // end cap. Free-angle ends always cap if joined. Orthogonal ends only cap if
  // the neighboring wall is non-axis-aligned, preserving byte-identical 90°
  // orthogonal joins.
  updateWidthText(key: string, value: number) {
    // if (!this.widthText) this.initWidthText()
    if (key === 'scaleX') this.scaleX = value
    if (this.isHorizontal) {
      this.widthText.set({
        top: this.top - 20,
        left: this.left + (this.width * this.scaleX) / 2 - this.widthText.width / 2,
        text: String(Math.round(((this.width * this.scaleX) / 50) * 100 * 100) / 100),
        visible: false
      })
    } else {
      this.widthText.set({
        top: this.top + this.height / 2 - this.widthText.height / 2,
        left: this.left - this.widthText.width - 10,
        text: String(Math.round(((this.height * this.scaleY) / 50) * 100 * 100) / 100),
        visible: false
      })
    }
  }

  updateDepthText(key: string, value: number) {
    // if (!this.depthText) this.initDepthText()
    if (key === 'scaleY') this.scaleY = value
    if (this.isHorizontal) {
      this.depthText.set({
        top: this.top + (this.height * this.scaleY) / 2 - this.depthText.height / 2,
        left: this.left - this.depthText.width - 10,
        text: String(Math.round(((this.height * this.scaleY) / 50) * 100 * 100) / 100),
        visible: cadleShell.showMeasurements
      })
    } else {
      this.depthText.set({
        top: this.top - 20,
        left: this.left + (this.width * this.scaleX) / 2 - this.depthText.width / 2,
        text: String(Math.round(((this.width * this.scaleX) / 50) * 100 * 100) / 100),
        visible: cadleShell.showMeasurements
      })
    }
  }

  handleSet(key: string, value: number | string | undefined) {
    // console.log({ key, value }) // todo only set when needed
    this.isHorizontal = this.width > this.height
    this.updateWidthText(key, Number(value ?? 0))
    // this.updateDepthText(key, Number(value ?? 0))
  }

  set(key: string | Record<string, unknown>, value?: unknown) {
    let result
    if (typeof key === 'object') {
      result = super.set(key, value)

      for (const [k, v] of Object.entries(key)) {
        this.handleSet(k, Number(v ?? 0))
      }
    } else {
      result = super.set(key, value)
      this.handleSet(key, Number(value ?? 0))
    }
    return result
  }

  isType(type: string): boolean {
    return type === 'CadleWall'
  }

  toJSON(): ReturnType<Rect['toJSON']> {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      bindingLabel: (this as { bindingLabel?: string }).bindingLabel,
      bindingLabelOffset: (this as { bindingLabelOffset?: { dx: number; dy: number } }).bindingLabelOffset,
      wallThickness: this.wallThickness,
      wallPoints: this.wallPoints,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleWall'
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude?: any[]): any {
    return {
      ...super.toObject(propertiesToInclude),
      uuid: this.uuid,
      bindingId: this.bindingId,
      bindingLabel: (this as { bindingLabel?: string }).bindingLabel,
      bindingLabelOffset: (this as { bindingLabelOffset?: { dx: number; dy: number } }).bindingLabelOffset,
      wallThickness: this.wallThickness,
      wallPoints: this.wallPoints,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleWall'
      // children: [
      // this.widthText.uuid

      // this.depthText.uuid
      // ]
    }
  }
}

classRegistry.setClass(CadleWall, 'CadleWall')
