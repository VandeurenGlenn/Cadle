import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './position.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/list-item.js'
import '@material/web/textfield/filled-text-field.js'
import './../../items/object.js'
@customElement('object-position')
export class ObjectPosition extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  @query('#pos-left')
  private accessor _leftInput!: any

  @query('#pos-top')
  private accessor _topInput!: any

  @query('#pos-width')
  private accessor _widthInput!: any

  @query('#pos-height')
  private accessor _heightInput!: any

  static styles = [styles]


  firstRender(): void {
    this.shadowRoot?.addEventListener('click', this.#onClick as any)
    // Listen to canvas selection changes
    const canvas = cadleShell?.field?.canvas
    if (canvas) {
      canvas.on('selection:created', () => this.#syncFromCanvas())
      canvas.on('selection:updated', () => this.#syncFromCanvas())
      canvas.on('selection:cleared', () => this.#syncFromCanvas())
      canvas.on('object:modified', () => this.#syncFromCanvas())
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
      // Reset when nothing selected
      if (this._leftInput) this._leftInput.value = '0'
      if (this._topInput) this._topInput.value = '0'
      if (this._widthInput) this._widthInput.value = '0'
      if (this._heightInput) this._heightInput.value = '0'
      return
    }

    // Sync current position from active object
    if (this._leftInput) this._leftInput.value = String(Math.round(activeObject.left ?? 0))
    if (this._topInput) this._topInput.value = String(Math.round(activeObject.top ?? 0))
    if (this._widthInput)
      this._widthInput.value = String(Math.round((activeObject.width ?? 0) * (activeObject.scaleX ?? 1)))
    if (this._heightInput)
      this._heightInput.value = String(Math.round((activeObject.height ?? 0) * (activeObject.scaleY ?? 1)))
  }

  #applyPosition(property: 'left' | 'top' | 'width' | 'height', value: string) {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObjects = canvas.getActiveObjects()
    if (activeObjects.length === 0) return
    const numValue = Number(value)
    if (!Number.isFinite(numValue)) return
    for (const obj of activeObjects) {
      if (property === 'width' || property === 'height') {
        // For width/height, we need to account for scale
        const originalSize = property === 'width' ? (obj.width ?? 0) : (obj.height ?? 0)
        if (originalSize > 0) {
          const newScale = numValue / originalSize
          const originX = (obj as any).originX ?? 'left'
          const originY = (obj as any).originY ?? 'top'
          const anchorPoint = (obj as any).getPointByOrigin(originX, originY)
          const isSymbolObject = Boolean((obj as any).symbolPath || (obj as any).symbolName)
          if (isSymbolObject) {
            obj.set({ scaleX: newScale, scaleY: newScale })
          } else {
            obj.set(property === 'width' ? { scaleX: newScale } : { scaleY: newScale })
          }

          ;(obj as any).setPositionByOrigin(anchorPoint, originX, originY)
          obj.setCoords()
        }
      } else {
        obj.set({ [property]: numValue })
        obj.setCoords()
      }
    }

    canvas.requestRenderAll()
  }

  render() {
    return html`
      <object-item
        label="position"
        icon="open_with">
        <div class="position-grid">
          <md-filled-text-field
            id="pos-left"
            label="Left (x)"
            type="number"
            value="0"
            @change=${(e: Event) => this.#applyPosition('left', (e.target as any).value)}>
          </md-filled-text-field>
          <md-filled-text-field
            id="pos-top"
            label="Top (y)"
            type="number"
            value="0"
            @change=${(e: Event) => this.#applyPosition('top', (e.target as any).value)}>
          </md-filled-text-field>
          <md-filled-text-field
            id="pos-width"
            label="Width"
            type="number"
            value="0"
            @change=${(e: Event) => this.#applyPosition('width', (e.target as any).value)}>
          </md-filled-text-field>
          <md-filled-text-field
            id="pos-height"
            label="Height"
            type="number"
            value="0"
            @change=${(e: Event) => this.#applyPosition('height', (e.target as any).value)}>
          </md-filled-text-field>
        </div>
      </object-item>
    `
  }
}
