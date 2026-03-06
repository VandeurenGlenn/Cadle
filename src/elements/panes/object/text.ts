import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@material/web/textfield/filled-text-field.js'
import './../../items/object.js'

@customElement('object-text')
export class ObjectText extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean

  @query('#text-content')
  private _textInput!: any

  @query('#font-size')
  private _fontSizeInput!: any

  static styles = [
    css`
      :host {
        display: block;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      .text-content {
        padding: 8px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      md-filled-text-field {
        width: 100%;
      }
    `
  ]

  firstUpdated(): void {
    this.renderRoot.addEventListener('click', this.#onClick as any)

    // Listen to canvas selection changes
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

    if (!activeObject || activeObject.type !== 'i-text') {
      // Reset when nothing selected or not a text object
      if (this._textInput) this._textInput.value = ''
      if (this._fontSizeInput) this._fontSizeInput.value = '16'
      return
    }

    // Sync current text properties
    if (this._textInput && activeObject.text) {
      this._textInput.value = activeObject.text
    }
    if (this._fontSizeInput && activeObject.fontSize) {
      this._fontSizeInput.value = String(activeObject.fontSize)
    }
  }

  #onTextChange(e: Event) {
    const input = e.target as any
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return

    const activeObject = canvas.getActiveObject()
    if (!activeObject || activeObject.type !== 'i-text') return

    activeObject.set({ text: input.value })
    canvas.requestRenderAll()
  }

  #onFontSizeChange(e: Event) {
    const input = e.target as any
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return

    const activeObject = canvas.getActiveObject()
    if (!activeObject || activeObject.type !== 'i-text') return

    const size = Number(input.value)
    if (Number.isFinite(size) && size > 0) {
      activeObject.set({ fontSize: size })
      canvas.requestRenderAll()
    }
  }

  render() {
    return html`
      <object-item
        label="text"
        icon="format_size">
        <div class="text-content">
          <md-filled-text-field
            id="text-content"
            label="Text Content"
            type="text"
            value=""
            @input=${this.#onTextChange}
            @change=${this.#onTextChange}>
          </md-filled-text-field>

          <md-filled-text-field
            id="font-size"
            label="Font Size"
            type="number"
            min="8"
            max="200"
            value="16"
            @change=${this.#onFontSizeChange}>
          </md-filled-text-field>
        </div>
      </object-item>
    `
  }
}
