import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import styles from './save-field.css' with { type: 'css' }
import { Canvas } from 'fabric'
@customElement('save-field')
export class SaveField extends LiteElement {
  #canvas: Canvas
  #height: number
  #width: number
  gridSize: number
  get #biggest() {
    return this.#width > this.#height ? this.#width : this.#height
  }

  static styles = [styles]

  async loadFromJSON(json) {
    await this.#canvas.loadFromJSON(json)
    await this.#canvas.renderAll()
  }

  toDataURL() {
    return this.#canvas.toDataURL({ multiplier: 3, quality: 100, enableRetinaScaling: true })
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    await this.rendered
    const { width, height } = this.getBoundingClientRect()
    this.#width = width
    this.#height = height
    const canvasEl = this.shadowRoot?.querySelector('canvas')
    if (canvasEl) {
      canvasEl.width = width + document.querySelector('app-shell').drawer.getBoundingClientRect().width
      canvasEl.height = height
      this.#canvas = new Canvas(canvasEl, { selection: false })
    }
  }

  render() {
    return html` <canvas
      id="canvas"
      width=""
      height="600"></canvas>`
  }
}
