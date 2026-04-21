import { Rect, classRegistry } from 'fabric'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'

export default class CadleWindow extends Rect {
  static type = 'CadleWindow'

  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  situationElementType: 'window' = 'window'
  situationMetadata?: Record<string, unknown>

  declare scaleX: number
  declare scaleY: number

  isHorizontal: boolean

  set widthText(value) {
    this._widthText = value
    cadleShell.field.canvas.add(value)
  }

  get widthText() {
    return this._widthText
  }

  constructor(options) {
    super({ ...defaultOptions, ...options })
    this.set('type', 'CadleWindow')

    if (!options.uuid) {
      this.uuid = crypto.randomUUID()
    } else {
      this.uuid = options.uuid
    }
    if (typeof options?.bindingId === 'string') this.bindingId = options.bindingId
    if (options?.situationMetadata && typeof options.situationMetadata === 'object') {
      this.situationMetadata = options.situationMetadata
    }

    cadleShell.field.canvas.requestRenderAll()
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

    // Clear the wall segment beneath the window so it reads as an opening.
    ctx.fillStyle = (this as any).backgroundColor || '#fff'
    ctx.fillRect(x0, y0, boxW, boxH)

    const stroke = (this.stroke as any) || '#555'
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
      fill: 'black',
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

  handleSet(key, value) {
    // console.log({ key, value }) // todo only set when needed
    this.isHorizontal = this.width > this.height
    this.updateWidthText(key, value)
  }

  set(key, value) {
    let result
    if (typeof key === 'object') {
      result = super.set(key, value)

      for (const [k, v] of Object.entries(key)) {
        this.handleSet(k, v)
      }
    } else {
      result = super.set(key, value)
      this.handleSet(key, value)
    }

    return result
  }

  toJSON(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleWindow'
      // children: [this.widthText.uuid]
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleWindow'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleWindow, 'CadleWindow')
