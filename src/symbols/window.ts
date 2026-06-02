import {
  Rect,
  classRegistry,
  type Canvas,
  type RectProps,
  type SerializedRectProps,
  type TClassProperties
} from 'fabric'
import type { JsonValue } from '../types.js'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'
import { canvasInk, canvasSurface } from './canvas-tokens.js'

type WindowOptions = {
  uuid?: string
  bindingId?: string
  situationMetadata?: Record<string, JsonValue>
  backgroundColor?: string
  [key: string]: unknown
}

export default class CadleWindow extends Rect {
  static type = 'CadleWindow'

  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  readonly situationElementType = 'window' as const
  situationMetadata?: Record<string, JsonValue>

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

  constructor(options: WindowOptions = {}) {
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
    const x0 = -boxW / 2
    const y0 = -boxH / 2
    const isHorizontal = boxW >= boxH

    const minorSize = isHorizontal ? boxH : boxW
    const frameInset = Math.max(2, Math.min(10, minorSize * 0.22))
    const frameStroke = Math.max(1.4, Number(this.strokeWidth ?? 1))
    const mullionStroke = Math.max(1, frameStroke * 0.9)

    ctx.save()

    // Fill the wall opening with the current canvas surface color.
    const fillColor = (this as { backgroundColor?: string }).backgroundColor ?? canvasSurface()
    ctx.fillStyle = fillColor
    ctx.fillRect(x0, y0, boxW, boxH)

    const stroke = (this.stroke as string | undefined) ?? '#555'
    ctx.strokeStyle = stroke
    ctx.lineWidth = frameStroke
    ctx.setLineDash([])

    const innerLeft = x0 + frameInset
    const innerTop = y0 + frameInset
    const innerW = Math.max(1, boxW - frameInset * 2)
    const innerH = Math.max(1, boxH - frameInset * 2)

    ctx.strokeRect(innerLeft, innerTop, innerW, innerH)

    if (isHorizontal) {
      const centerX = x0 + boxW / 2
      ctx.lineWidth = mullionStroke
      ctx.beginPath()
      ctx.moveTo(centerX, innerTop)
      ctx.lineTo(centerX, innerTop + innerH)
      ctx.stroke()
    } else {
      const centerY = y0 + boxH / 2
      ctx.lineWidth = mullionStroke
      ctx.beginPath()
      ctx.moveTo(innerLeft, centerY)
      ctx.lineTo(innerLeft + innerW, centerY)
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

  updateWidthText(key, value) {
    if (!this.widthText) this.initWidthText()
    if (key === 'scaleX') this.scaleX = value
    if (!cadleShell.showMeasurements) return

    if (this.isHorizontal) {
      this.widthText.set({
        top: this.top - 20,
        left: this.left + (this.width * this.scaleX) / 2 - this.widthText.width / 2,
        text: String(((this.width * this.scaleX) / 50) * 100),
        visible: false
      })
    } else {
      this.widthText.set({
        visible: false,
        top: this.top + this.height / 2 - this.widthText.height / 2,
        left: this.left - this.widthText.width - 10,
        text: String(((this.height * this.scaleY) / 50) * 100)
      })
    }
  }

  handleSet(key: string, value: number) {
    // console.log({ key, value }) // todo only set when needed
    this.isHorizontal = this.width > this.height
    this.updateWidthText(key, value)
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
      backgroundColor: (this as { backgroundColor?: string }).backgroundColor,
      type: 'CadleWindow'
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
      backgroundColor: (this as { backgroundColor?: string }).backgroundColor,
      type: 'CadleWindow'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleWindow, 'CadleWindow')
