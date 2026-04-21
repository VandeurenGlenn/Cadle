import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/text-button.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../../items/object.js'

@customElement('object-scale')
export class ObjectScale extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean

  @query('md-filled-text-field')
  private _field!: any

  static styles = [
    css`
      :host {
        display: block;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      md-filled-text-field {
        width: 100%;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 8px;
      }
    `
  ]

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.removeEventListener('keydown', this.#onKeyDown as any)
    this.removeEventListener('click', this.#onClick as any)
  }

  firstUpdated(): void {
    this.shadowRoot?.addEventListener('keydown', this.#onKeyDown as any)
    this.renderRoot.addEventListener('click', this.#onClick as any)
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
      const originX = (obj as any).originX ?? 'left'
      const originY = (obj as any).originY ?? 'top'
      const anchorPoint = (obj as any).getPointByOrigin(originX, originY)
      obj.set({ scaleX: scale, scaleY: scale })
      ;(obj as any).setPositionByOrigin(anchorPoint, originX, originY)
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
      const originX = (obj as any).originX ?? 'left'
      const originY = (obj as any).originY ?? 'top'
      const anchorPoint = (obj as any).getPointByOrigin(originX, originY)
      obj.set({ scaleX: 1, scaleY: 1 })
      ;(obj as any).setPositionByOrigin(anchorPoint, originX, originY)
      obj.setCoords()
    }

    if (this._field) this._field.value = '100'
    canvas.requestRenderAll()
  }

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    const path = event.composedPath()
    if (path.some((n: any) => n?.tagName?.toLowerCase?.() === 'md-filled-text-field')) {
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
