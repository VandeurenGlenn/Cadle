import { Rect, Group, IText, classRegistry } from 'fabric'
import defaultOptions from './default-options.js'
import { CadleDepth } from './depth.js'
import { CadleWidth } from './width.js'

export default class CadleWall extends Rect {
  static type = 'CadleWall'

  rect: Rect
  _widthText: CadleWidth
  _depthText: CadleDepth
  uuid: `${string}-${string}-${string}-${string}-${string}`
  bindingId?: string
  situationElementType: 'wall' = 'wall'
  situationMetadata?: Record<string, unknown>

  declare scaleX: number
  declare scaleY: number

  isHorizontal: boolean

  set widthText(value) {
    this._widthText = value
    cadleShell.field.canvas.add(value)
  }

  set depthText(value) {
    this._depthText = value
    cadleShell.field.canvas.add(value)
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
      fill: 'black',
      visible: cadleShell.showMeasurements
    })
  }

  initDepthText() {
    this.depthText = new CadleDepth(String((this.height / 50) * 100), {
      left: this.left + this.width / 2,
      top: this.top + this.height + 20,
      fontSize: 16,
      fill: 'black',
      visible: cadleShell.showMeasurements
    })
  }

  constructor(options) {
    super()

    if (!options.uuid) {
      this.uuid = crypto.randomUUID()
    } else {
      this.uuid = options.uuid
    }
    if (typeof options?.bindingId === 'string') this.bindingId = options.bindingId
    if (options?.situationMetadata && typeof options.situationMetadata === 'object') {
      this.situationMetadata = options.situationMetadata
    }
    this.initWidthText()
    // this.initDepthText()
    this.set({ ...defaultOptions, ...options })
    this.set('type', 'CadleWall')

    cadleShell.field.canvas.requestRenderAll()
  }

  updateWidthText(key, value) {
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

  updateDepthText(key, value) {
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

  handleSet(key, value) {
    // console.log({ key, value }) // todo only set when needed
    this.isHorizontal = this.width > this.height
    this.updateWidthText(key, value)
    // this.updateDepthText(key, value)
  }

  set(key, value?) {
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

  isType(type) {
    return type === 'CadleWall'
  }

  toJSON(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
      situationElementType: this.situationElementType,
      situationMetadata: this.situationMetadata,
      type: 'CadleWall'
    }
  }

  toObject(): any {
    return {
      ...super.toObject(),
      uuid: this.uuid,
      bindingId: this.bindingId,
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
