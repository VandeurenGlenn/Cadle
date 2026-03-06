import { LitElement, html, css, PropertyValues } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../../items/object.js'

@customElement('object-color')
export class ObjectColor extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean

  @query('#stroke-color')
  private _strokeInput!: HTMLInputElement

  @query('#fill-color')
  private _fillInput!: HTMLInputElement

  static styles = [
    css`
      :host {
        display: block;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      .color-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }

      .color-row:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      input[type='color'] {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      custom-icon {
        margin-right: 4px;
      }
    `
  ]

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.renderRoot.addEventListener('click', this.#onClick as any)

    // Listen to canvas selection changes to sync colors
    const canvas = cadleShell?.field?.canvas
    if (canvas) {
      canvas.on('selection:created', () => this.#syncFromCanvas())
      canvas.on('selection:updated', () => this.#syncFromCanvas())
      canvas.on('selection:cleared', () => this.#syncFromCanvas())
    }
    this.#syncFromCanvas()
  }

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  #syncFromCanvas() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()

    if (!activeObject) {
      // Reset to defaults when nothing selected
      if (this._strokeInput) this._strokeInput.value = '#000000'
      if (this._fillInput) this._fillInput.value = '#ffffff'
      return
    }

    // Sync current colors from active object
    if (this._strokeInput && activeObject.stroke) {
      this._strokeInput.value = String(activeObject.stroke)
    }
    if (this._fillInput && activeObject.fill) {
      this._fillInput.value = String(activeObject.fill)
    }
  }

  #onStrokeChange(e: Event) {
    const input = e.target as HTMLInputElement
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return

    const activeObjects = canvas.getActiveObjects()
    if (activeObjects.length === 0) return

    for (const obj of activeObjects) {
      obj.set({ stroke: input.value })
    }
    canvas.requestRenderAll()
  }

  #onFillChange(e: Event) {
    const input = e.target as HTMLInputElement
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return

    const activeObjects = canvas.getActiveObjects()
    if (activeObjects.length === 0) return

    for (const obj of activeObjects) {
      obj.set({ fill: input.value })
    }
    canvas.requestRenderAll()
  }

  render() {
    return html`
      <object-item
        label="color"
        icon="palette">
        <div class="color-row">
          <custom-icon icon="border_color"></custom-icon>
          border
          <flex-it></flex-it>
          <input
            id="stroke-color"
            type="color"
            value="#000000"
            @input=${this.#onStrokeChange}
            @change=${this.#onStrokeChange} />
        </div>

        <div class="color-row">
          <custom-icon icon="format_color_fill"></custom-icon>
          fill
          <flex-it></flex-it>
          <input
            id="fill-color"
            type="color"
            value="#ffffff"
            @input=${this.#onFillChange}
            @change=${this.#onFillChange} />
        </div>
      </object-item>
    `
  }
}
