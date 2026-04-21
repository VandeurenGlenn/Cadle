import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@material/web/textfield/filled-text-field.js'
import './../../items/object.js'

@customElement('object-binding')
export class ObjectBinding extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean

  @query('#binding-id')
  private _bindingInput!: any

  static styles = [
    css`
      :host {
        display: block;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      .binding-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        padding: 8px 12px;
      }

      md-filled-text-field {
        width: 100%;
      }
    `
  ]

  firstUpdated(): void {
    const canvas = cadleShell?.field?.canvas
    if (canvas) {
      canvas.on('selection:created', () => this.#syncFromCanvas())
      canvas.on('selection:updated', () => this.#syncFromCanvas())
      canvas.on('selection:cleared', () => this.#syncFromCanvas())
      canvas.on('object:modified', () => this.#syncFromCanvas())
    }
    this.#syncFromCanvas()
  }

  #normalizeBindingId(value: string) {
    return value.trim()
  }

  #syncFromCanvas() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas || !this._bindingInput) return

    const activeObject = canvas.getActiveObject() as any
    if (!activeObject) {
      this._bindingInput.value = ''
      return
    }

    this._bindingInput.value = String(activeObject.bindingId ?? '')
  }

  #applyBindingId(value: string) {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return

    const activeObjects = canvas.getActiveObjects() as any[]
    if (activeObjects.length === 0) return

    const bindingId = this.#normalizeBindingId(value)

    for (const obj of activeObjects) {
      if (bindingId) {
        obj.set({ bindingId })
      } else {
        obj.set({ bindingId: undefined })
      }
      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  render() {
    return html`
      <object-item
        label="binding"
        icon="link">
        <div class="binding-grid">
          <md-filled-text-field
            id="binding-id"
            label="Binding ID (A1)"
            type="text"
            @change=${(e: Event) => this.#applyBindingId((e.target as any).value)}>
          </md-filled-text-field>
        </div>
      </object-item>
    `
  }
}
