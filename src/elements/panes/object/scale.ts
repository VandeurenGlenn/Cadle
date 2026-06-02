import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './scale.css' with { type: 'css' }
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/text-button.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../../items/object.js'

type ScaleField = HTMLElement & { value: string }

@customElement('object-scale')
export class ObjectScale extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  @query('md-filled-text-field')
  private accessor _field!: ScaleField

  static styles = [styles]

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('keydown', this.#onKeyDown)
    this.removeEventListener('click', this.#onClick)
  }

  firstRender(): void {
    this.shadowRoot?.addEventListener('keydown', this.#onKeyDown)
    this.shadowRoot?.addEventListener('click', this.#onClick)
    // Listen to canvas selection changes to keep scale value in sync
    const canvas = cadleShell?.field?.canvas
    if (canvas) {
      canvas.on('selection:created', () => this.#syncFromCanvas())
      canvas.on('selection:updated', () => this.#syncFromCanvas())
      canvas.on('selection:cleared', () => {
        if (this._field) this._field.value = '100'
      })
    }

    this.#syncFromCanvas()
  }

  #syncFromCanvas() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) {
      if (this._field) this._field.value = '100'
      return
    }

    const scale = activeObject.scaleX ?? 1
    const pct = Math.round(scale * 100)
    if (this._field) this._field.value = String(pct)
  }

  #apply() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) return // Only apply if there's a selected object
    const raw = Number(this._field?.value ?? 100)
    if (!Number.isFinite(raw)) return
    const clamped = Math.min(500, Math.max(10, raw))
    const scale = clamped / 100
    // Scale the active object(s) only
    const activeObjects = canvas.getActiveObjects()
    for (const obj of activeObjects) {
      const originX = obj.originX ?? 'left'
      const originY = obj.originY ?? 'top'
      const anchorPoint = obj.getPointByOrigin(originX, originY)
      obj.set({ scaleX: scale, scaleY: scale })
      obj.setPositionByOrigin(anchorPoint, originX, originY)
      obj.setCoords()
    }

    canvas.requestRenderAll()
    this._field.value = String(clamped)
  }

  #reset() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) return
    // Reset scale to 1 (100%)
    const activeObjects = canvas.getActiveObjects()
    for (const obj of activeObjects) {
      const originX = obj.originX ?? 'left'
      const originY = obj.originY ?? 'top'
      const anchorPoint = obj.getPointByOrigin(originX, originY)
      obj.set({ scaleX: 1, scaleY: 1 })
      obj.setPositionByOrigin(anchorPoint, originX, originY)
      obj.setCoords()
    }

    if (this._field) this._field.value = '100'
    canvas.requestRenderAll()
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    const path = event.composedPath() as EventTarget[]
    if (path.some((node) => node instanceof Element && node.tagName.toLowerCase() === 'md-filled-text-field')) {
      event.preventDefault()
      this.#apply()
    }
  }

  render() {
    return html`
      <object-item
        label="scale"
        icon="resize">
        <md-filled-text-field
          label="Scale (%)"
          type="number"
          min="10"
          max="500"
          step="10"
          value="100"
          @change=${this.#apply}></md-filled-text-field>
        <div class="actions">
          <md-text-button @click=${this.#reset}>Reset</md-text-button>
        </div>
      </object-item>
    `
  }
}
