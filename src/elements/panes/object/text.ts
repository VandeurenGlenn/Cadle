import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './text.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/list-item.js'
import '@material/web/textfield/filled-text-field.js'
import './../../items/object.js'
@customElement('object-text')
export class ObjectText extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  @query('#text-content')
  private accessor _textInput!: any

  @query('#font-size')
  private accessor _fontSizeInput!: any

  static styles = [styles]


  firstRender(): void {
    this.shadowRoot?.addEventListener('click', this.#onClick as any)
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

    const textObject = activeObject as any
    // Sync current text properties
    if (this._textInput && textObject.text) {
      this._textInput.value = textObject.text
    }

    if (this._fontSizeInput && textObject.fontSize) {
      this._fontSizeInput.value = String(textObject.fontSize)
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
