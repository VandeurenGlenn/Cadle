import { Rect, classRegistry } from 'fabric'
import type { Canvas, RectProps, SerializedRectProps, TClassProperties } from 'fabric'
import type { JsonValue } from '../types.js'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'
import { canvasInk, canvasSurface } from './canvas-tokens.js'

type DoorOptions = {
  uuid?: string
  doorHingeSide?: 'left' | 'right' | 'top' | 'bottom'
  doorSwingDirection?: 'up' | 'down' | 'left' | 'right'
  wallThickness?: number
  bindingId?: string
  situationMetadata?: Record<string, JsonValue>
  backgroundColor?: string
  [key: string]: unknown
}

type DoorStyle = {
  backgroundColor?: string
  stroke?: string
  strokeWidth?: number
  strokeDashArray?: number[]
}

export default class CadleDoor extends Rect {
  static type = 'CadleDoor'

  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  readonly situationElementType = 'door' as const
  situationMetadata?: Record<string, JsonValue>

  doorHingeSide: 'left' | 'right' | 'top' | 'bottom' = 'right'
  doorSwingDirection: 'up' | 'down' | 'left' | 'right' = 'down'

  wallThickness?: number

  declare scaleX: number
  declare scaleY: number

  isHorizontal: boolean

  set widthText(value: CadleWidth) {
    this._widthText = value
    const canvas = cadleShell?.field?.canvas as Canvas | null
    if (canvas && !canvas.getObjects().includes(value)) canvas.add(value)
  }

  get widthText() {
    return this._widthText
  }

  constructor(options: DoorOptions = {}) {
    super({ ...defaultOptions, ...options } as unknown as ConstructorParameters<typeof Rect>[0])

    this.on('added', () => {
      const self = this as unknown as { bringToFront?: () => void }
      self.bringToFront?.()
    })

    if (!options.uuid) {
      this.uuid = crypto.randomUUID()
    } else {
      this.uuid = (
        typeof options.uuid === 'string' ? options.uuid : crypto.randomUUID()
      ) as `${string}-${string}-${string}-${string}-${string}`
    }

    if (options?.doorHingeSide) this.doorHingeSide = options.doorHingeSide
    if (options?.doorSwingDirection) this.doorSwingDirection = options.doorSwingDirection
    if (typeof options?.wallThickness === 'number') this.wallThickness = options.wallThickness
    if (typeof options?.bindingId === 'string') this.bindingId = options.bindingId
    if (options?.situationMetadata && typeof options.situationMetadata === 'object') {
      this.situationMetadata = options.situationMetadata
    }

    const canvas = cadleShell?.field?.canvas as Canvas | undefined
    canvas?.requestRenderAll()
  }

  _render(ctx: CanvasRenderingContext2D) {
    const boxW = Math.max(1, Math.abs(this.width || 0))
    const boxH = Math.max(1, Math.abs(this.height || 0))

    // Fabric renders most shapes centered at (0,0), so treat (-boxW/2, -boxH/2) as top-left.
    const x0 = -boxW / 2
    const y0 = -boxH / 2

    // Orientation is dictated by the door's actual box dimensions — a tall
    // box (height > width) is a vertical door, a wide box is horizontal.
    // doorSwingDirection / doorHingeSide only choose WHICH side the leaf
    // pivots on; if they don't match the current orientation we fall back
    // to a sensible default.
    const isHorizontal = boxW >= boxH
    const leafLen = Math.max(1, isHorizontal ? boxW : boxH)

    // Normalize hinge side for the current orientation.
    const hingeSide = ((): 'left' | 'right' | 'top' | 'bottom' => {
      if (isHorizontal) {
        return this.doorHingeSide === 'left' || this.doorHingeSide === 'right' ? this.doorHingeSide : 'right'
      }
      return this.doorHingeSide === 'top' || this.doorHingeSide === 'bottom' ? this.doorHingeSide : 'bottom'
    })()

    ctx.save()

    // Mask the wall segment under the door so the opening reads clearly.
    const style = this as DoorStyle
    ctx.fillStyle = style.backgroundColor ?? canvasSurface()
    ctx.fillRect(x0, y0, boxW, boxH)

    ctx.strokeStyle = (this.stroke as string | undefined) || '#555'
    ctx.lineWidth = this.strokeWidth ?? 1

    const dash = style.strokeDashArray || [5, 5]

    if (isHorizontal) {
      const swingDown = this.doorSwingDirection === 'down' || this.doorSwingDirection !== 'up'
      // Opening line is on the swing-side wall face.
      const openingY = swingDown ? y0 + boxH : y0
      const hingeX = hingeSide === 'right' ? x0 + boxW : x0
      const hingeY = openingY

      // 1) Opening (dashed) line
      const openX1 = hingeSide === 'right' ? hingeX - leafLen : hingeX
      const openX2 = hingeSide === 'right' ? hingeX : hingeX + leafLen
      ctx.setLineDash(Array.isArray(dash) ? dash : [5, 5])
      ctx.beginPath()
      ctx.moveTo(openX1, openingY)
      ctx.lineTo(openX2, openingY)
      ctx.stroke()

      // 2) Door leaf line (solid)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(hingeX, hingeY)
      ctx.lineTo(hingeX, hingeY + (swingDown ? leafLen : -leafLen))
      ctx.stroke()

      // 3) Swing arc (solid, quarter circle), kept inside the box
      // Hinge right => arc goes left; hinge left => arc goes right.
      const startAngle = hingeSide === 'right' ? Math.PI : 0
      const endAngle = swingDown ? Math.PI / 2 : -Math.PI / 2
      const anticlockwise = hingeSide === 'right' ? true : false
      ctx.beginPath()
      ctx.arc(hingeX, hingeY, leafLen, startAngle, endAngle, anticlockwise)
      ctx.stroke()
    } else {
      const swingRight = this.doorSwingDirection === 'right' || this.doorSwingDirection !== 'left'
      // Opening line is on the swing-side wall face.
      const openingX = swingRight ? x0 + boxW : x0
      const hingeX = openingX
      const hingeY = hingeSide === 'bottom' ? y0 + boxH : y0

      // 1) Opening (dashed) line
      const openY1 = hingeSide === 'bottom' ? hingeY - leafLen : hingeY
      const openY2 = hingeSide === 'bottom' ? hingeY : hingeY + leafLen
      ctx.setLineDash(Array.isArray(dash) ? dash : [5, 5])
      ctx.beginPath()
      ctx.moveTo(openingX, openY1)
      ctx.lineTo(openingX, openY2)
      ctx.stroke()

      // 2) Door leaf line (solid)
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(hingeX, hingeY)
      ctx.lineTo(hingeX + (swingRight ? leafLen : -leafLen), hingeY)
      ctx.stroke()

      // 3) Swing arc (solid, quarter circle), kept inside the box
      // Hinge bottom => arc goes up; hinge top => arc goes down.
      const startAngle = hingeSide === 'bottom' ? -Math.PI / 2 : Math.PI / 2
      const endAngle = swingRight ? 0 : Math.PI
      const anticlockwise = hingeSide === 'bottom' ? false : true
      ctx.beginPath()
      ctx.arc(hingeX, hingeY, leafLen, startAngle, endAngle, anticlockwise)
      ctx.stroke()
    }

    ctx.restore()
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

  updateWidthText(key: string, value: number) {
    if (!this.widthText) this.initWidthText()
    if (key === 'scaleX') this.scaleX = value
    if (!cadleShell.showMeasurements) return

    if (this.isHorizontal) {
      this.widthText.set({
        top: this.top - 20,
        left: this.left + (this.width * this.scaleX) / 2 - this.widthText.width / 2,
        text: String(((this.width * this.scaleX) / 50) * 100),
        visible: cadleShell.showMeasurements
      })
    } else {
      this.widthText.set({
        visible: cadleShell.showMeasurements,
        top: this.top + this.height / 2 - this.widthText.height / 2,
        left: this.left - this.widthText.width - 10,
        text: String(((this.height * this.scaleY) / 50) * 100)
      })
    }
  }

  handleSet(key: string, value: number | string | undefined) {
    // console.log({ key, value }) // todo only set when needed
    this.isHorizontal = this.width > this.height
    this.updateWidthText(key, Number(value ?? 0))
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

  toJSON(): ReturnType<Rect['toJSON']> {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      doorHingeSide: this.doorHingeSide,
      doorSwingDirection: this.doorSwingDirection,
      wallThickness: this.wallThickness,
      backgroundColor: (this as { backgroundColor?: string }).backgroundColor,
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toObject(propertiesToInclude?: any[]): any {
    return {
      ...super.toObject(propertiesToInclude),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      doorHingeSide: this.doorHingeSide,
      doorSwingDirection: this.doorSwingDirection,
      wallThickness: this.wallThickness,
      backgroundColor: (this as { backgroundColor?: string }).backgroundColor,
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleDoor, 'CadleDoor')
