import { Rect, classRegistry } from 'fabric'
import defaultOptions from './default-options.js'

export default class CadleGate extends Rect {
  static type = 'CadleGate'

  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  situationElementType: 'gate' = 'gate'
  situationMetadata?: Record<string, unknown>

  constructor(options) {
    super({ ...defaultOptions, ...options })
    this.set('type', 'CadleGate')

    if (!options?.uuid) {
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
    const railInset = Math.max(2, (isHorizontal ? boxH : boxW) * 0.2)
    const postSize = Math.max(2, Math.min(8, (isHorizontal ? boxH : boxW) * 0.35))
    const stroke = (this.stroke as any) || '#555'

    ctx.save()
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(1.2, Number(this.strokeWidth ?? 1))
    ctx.setLineDash([])

    if (isHorizontal) {
      const topRail = y0 + railInset
      const bottomRail = y0 + boxH - railInset

      // Gate posts
      ctx.beginPath()
      ctx.rect(x0, y0, postSize, boxH)
      ctx.rect(x0 + boxW - postSize, y0, postSize, boxH)
      ctx.stroke()

      // Rails
      ctx.beginPath()
      ctx.moveTo(x0 + postSize, topRail)
      ctx.lineTo(x0 + boxW - postSize, topRail)
      ctx.moveTo(x0 + postSize, bottomRail)
      ctx.lineTo(x0 + boxW - postSize, bottomRail)
      ctx.stroke()

      // Opening direction marker
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x0 + boxW / 2, topRail)
      ctx.lineTo(x0 + boxW / 2, y0 + boxH)
      ctx.stroke()
    } else {
      const leftRail = x0 + railInset
      const rightRail = x0 + boxW - railInset

      // Gate posts
      ctx.beginPath()
      ctx.rect(x0, y0, boxW, postSize)
      ctx.rect(x0, y0 + boxH - postSize, boxW, postSize)
      ctx.stroke()

      // Rails
      ctx.beginPath()
      ctx.moveTo(leftRail, y0 + postSize)
      ctx.lineTo(leftRail, y0 + boxH - postSize)
      ctx.moveTo(rightRail, y0 + postSize)
      ctx.lineTo(rightRail, y0 + boxH - postSize)
      ctx.stroke()

      // Opening direction marker
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(leftRail, y0 + boxH / 2)
      ctx.lineTo(x0 + boxW, y0 + boxH / 2)
      ctx.stroke()
    }

    ctx.restore()
  }

  toJSON(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleGate'
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleGate'
    }
  }
}

classRegistry.setClass(CadleGate, 'CadleGate')
