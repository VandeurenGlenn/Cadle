import { LiteElement, html, css, customElement, property } from '@vandeurenglenn/lite'
import styles from './overlay.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/list-item.js'
import '@material/web/switch/switch.js'
import '@material/web/slider/slider.js'
import './../../items/object.js'
@customElement('object-overlay')
export class ObjectOverlay extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  @property({ type: Boolean }) accessor isOverlay: boolean = false
  @property({ type: Number }) accessor opacity: number = 100
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

  #isImageObject(activeObject: any): boolean {
    if (!activeObject) return false
    const type = String(activeObject.type ?? '')
    const ctor = String(activeObject.constructor?.name ?? '')
    return (
      type === 'image' ||
      type === 'Image' ||
      type === 'fabricImage' ||
      type === 'FabricImage' ||
      ctor === 'FabricImage' ||
      typeof activeObject.getSrc === 'function' ||
      typeof activeObject.src === 'string'
    )
  }

  #getSelectedImageObject(): any | null {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return null
    const activeObject = canvas.getActiveObject()
    if (this.#isImageObject(activeObject)) return activeObject
    const activeObjects = canvas.getActiveObjects?.() ?? []
    for (const obj of activeObjects) {
      if (this.#isImageObject(obj)) return obj
    }

    const selectionObjects = (activeObject as any)?.getObjects?.() ?? []
    for (const obj of selectionObjects) {
      if (this.#isImageObject(obj)) return obj
    }

    const allObjects = canvas.getObjects?.() ?? []
    const imageObjects = allObjects.filter((obj: any) => this.#isImageObject(obj))
    if (imageObjects.length === 0) return null
    const lockedImages = imageObjects.filter(
      (obj: any) =>
        obj.selectable === false ||
        obj.lockMovementX ||
        obj.lockMovementY ||
        obj.lockRotation ||
        obj.lockScalingX ||
        obj.lockScalingY
    )
    if (lockedImages.length === 1) return lockedImages[0]
    if (imageObjects.length === 1) return imageObjects[0]
    return null
  }

  #syncFromCanvas() {
    const selectedImage = this.#getSelectedImageObject()
    if (!selectedImage) {
      this.isOverlay = false
      this.opacity = 100
      return
    }

    // Check if object is locked (overlay mode)
    this.isOverlay = Boolean(
      selectedImage.lockMovementX &&
      selectedImage.lockMovementY &&
      selectedImage.lockRotation &&
      selectedImage.lockScalingX &&
      selectedImage.lockScalingY
    )
    this.opacity = Math.round((selectedImage.opacity ?? 1) * 100)
  }

  #toggleOverlay(e: Event) {
    const target = e.target as any
    const isChecked = target.selected
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = this.#getSelectedImageObject()
    if (!activeObject) return
    // Toggle overlay mode
    activeObject.set({
      selectable: true,
      evented: true,
      hasControls: !isChecked,
      hasBorders: !isChecked,
      lockMovementX: isChecked,
      lockMovementY: isChecked,
      lockRotation: isChecked,
      lockScalingX: isChecked,
      lockScalingY: isChecked
    })
    this.isOverlay = isChecked
    canvas.requestRenderAll()
  }

  #onOpacityChange(e: Event) {
    const slider = e.target as any
    const value = Number(slider.value)
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = this.#getSelectedImageObject()
    if (!activeObject) return
    const opacity = value / 100
    activeObject.set({ opacity })
    this.opacity = value
    canvas.requestRenderAll()
  }

  render() {
    const isImage = Boolean(this.#getSelectedImageObject())
    if (!isImage) {
      return html`
        <object-item
          label="overlay"
          icon="layers">
          <div class="overlay-content">
            <div class="info-text">Select an image to use overlay mode</div>
          </div>
        </object-item>
      `
    }
    return html`
      <object-item
        label="overlay"
        icon="layers">
        <div class="overlay-content">
          <div class="switch-row">
            <span>Lock as overlay</span>
            <md-switch
              ?selected=${this.isOverlay}
              @change=${this.#toggleOverlay}></md-switch>
          </div>
          <div class="slider-row">
            <span class="slider-label">Opacity: ${this.opacity}%</span>
            <md-slider
              min="0"
              max="100"
              value=${this.opacity}
              @input=${this.#onOpacityChange}
              @change=${this.#onOpacityChange}></md-slider>
          </div>
          <div class="info-text">
            ${this.isOverlay
    ? 'Image is locked and can be used as reference'
    : 'Toggle to lock image as static overlay'}
          </div>
        </div>
      </object-item>
    `
  }
}
