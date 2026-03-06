import { Rect, classRegistry } from 'fabric'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'

export default class CadleDoor extends Rect {
  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`

  doorHingeSide: 'left' | 'right' | 'top' | 'bottom' = 'right'
  doorSwingDirection: 'up' | 'down' | 'left' | 'right' = 'down'

  wallThickness?: number

  scaleX: number = 1
  scaleY: number = 1

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

    if (!options.uuid) {
      this.uuid = crypto.randomUUID()
    } else {
    }

    if (options?.doorHingeSide) this.doorHingeSide = options.doorHingeSide
    if (options?.doorSwingDirection) this.doorSwingDirection = options.doorSwingDirection
    if (typeof options?.wallThickness === 'number') this.wallThickness = options.wallThickness

    cadleShell.field.canvas.renderAll()
  }

  _render(ctx: CanvasRenderingContext2D) {
    const boxW = Math.max(1, Math.abs(this.width || 0))
    const boxH = Math.max(1, Math.abs(this.height || 0))

    // Fabric renders most shapes centered at (0,0), so treat (-boxW/2, -boxH/2) as top-left.
    const x0 = -boxW / 2
    const y0 = -boxH / 2

    const isHorizontal = this.doorSwingDirection === 'up' || this.doorSwingDirection === 'down'
    const leafLen = Math.max(1, Math.min(boxW, boxH))

    // Normalize hinge side for the current orientation.
    const hingeSide = ((): 'left' | 'right' | 'top' | 'bottom' => {
      if (isHorizontal) {
        return this.doorHingeSide === 'left' || this.doorHingeSide === 'right' ? this.doorHingeSide : 'right'
      }
      return this.doorHingeSide === 'top' || this.doorHingeSide === 'bottom' ? this.doorHingeSide : 'bottom'
    })()

    ctx.save()
    ctx.strokeStyle = (this.stroke as any) || '#555'
    ctx.lineWidth = (this.strokeWidth as any) || 1

    const dash = (this.strokeDashArray as any) || [5, 5]

    if (isHorizontal) {
      const swingDown = this.doorSwingDirection === 'down'
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
      const swingRight = this.doorSwingDirection === 'right'
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
      doorHingeSide: this.doorHingeSide,
      doorSwingDirection: this.doorSwingDirection,
      wallThickness: this.wallThickness,
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      doorHingeSide: this.doorHingeSide,
      doorSwingDirection: this.doorSwingDirection,
      wallThickness: this.wallThickness,
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleDoor, 'CadleDoor')
