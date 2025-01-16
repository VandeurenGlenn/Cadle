import { Rect, Group, IText, classRegistry } from 'fabric'
import defaultOptions from './default-options.js'
import { CadleWidth } from './width.js'

export default class CadleWindow extends Rect {
  rect: Rect
  _widthText: CadleWidth
  uuid: `${string}-${string}-${string}-${string}-${string}`

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

    cadleShell.field.canvas.renderAll()
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
      type: 'CadleWindow'
      // children: [this.widthText.uuid]
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      type: 'CadleWindow'
      // children: [this.widthText.uuid]
    }
  }
}

classRegistry.setClass(CadleWindow, 'CadleWindow')
