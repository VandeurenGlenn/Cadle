import { Rect, classRegistry } from 'fabric'
import type { Canvas, RectProps, SerializedRectProps, TClassProperties } from 'fabric'
import type { JsonValue } from '../types.js'
import defaultOptions from './default-options.js'
import { CadleDepth } from './depth.js'
import { CadleWidth } from './width.js'
import { canvasInk } from './canvas-tokens.js'

type WallOptions = {
  uuid?: string
  bindingId?: string
  situationMetadata?: Record<string, JsonValue>
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

  declare scaleX: number
  declare scaleY: number

  isHorizontal: boolean

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

    this.initWidthText()
    // this.initDepthText()
    this.set({ ...defaultOptions, ...options })

    const canvas = cadleShell?.field?.canvas as Canvas | undefined
    canvas?.requestRenderAll()
  }

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
