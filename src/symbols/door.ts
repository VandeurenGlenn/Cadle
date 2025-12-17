import { Rect, Group, IText, classRegistry, Circle, Path } from 'fabric'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'

export default class CadleDoor extends Rect {
  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`

  scaleX: number = 1
  scaleY: number = 1

  isHorizontal: boolean
  arcLine: Circle

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

    this.drawDoorOpening()
    cadleShell.field.canvas.renderAll()
  }

  drawDoorOpening() {
    // Remove existing arc if present
    if (this.arcLine) {
      cadleShell.field.canvas.remove(this.arcLine)
    }

    // Create a quarter-circle arc to show door swing
    const radius = Math.min(this.width, this.height)
    this.arcLine = new Circle({
      radius: radius,
      left: this.left,
      top: this.top,
      fill: 'transparent',
      stroke: this.stroke,
      strokeWidth: this.strokeWidth,
      startAngle: 0,
      endAngle: Math.PI / 2,
      originX: 'left',
      originY: 'top'
    })

    cadleShell.field.canvas.add(this.arcLine)
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

    // Redraw door opening if dimensions changed
    if (
      key === 'scaleX' ||
      key === 'scaleY' ||
      key === 'width' ||
      key === 'height' ||
      key === 'left' ||
      key === 'top'
    ) {
      this.drawDoorOpening()
    }
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
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      type: 'CadleDoor'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleDoor, 'CadleDoor')
