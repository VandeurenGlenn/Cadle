import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './export.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/list-item.js'
import '@material/web/button/filled-button.js'
import './../../items/object.js'
@customElement('object-export')
export class ObjectExport extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  static styles = [styles]

  firstRender(): void {
    this.shadowRoot?.addEventListener('click', this.#onClick)
  }

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  #exportAsSVG() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) {
      alert('Please select an object to export')
      return
    }

    // Export selected object as SVG
    const svg = activeObject.toSVG()
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `object-${Date.now()}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  #exportAsJSON() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) {
      alert('Please select an object to export')
      return
    }

    // Export selected object as JSON
    const json = JSON.stringify(activeObject.toJSON(), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `object-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  #addToCatalog() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObject = canvas.getActiveObject()
    if (!activeObject) {
      alert('Please select an object to add to catalog')
      return
    }

    // TODO: Implement catalog functionality
    console.log('Add to catalog:', activeObject.toJSON())
    alert('Catalog feature coming soon!')
  }

  render() {
    return html`
      <object-item
        label="export"
        icon="output">
        <div class="export-actions">
          <div
            class="action-row"
            @click=${this.#exportAsSVG}>
            <custom-icon icon="image"></custom-icon>
            Export as SVG
          </div>
          <div
            class="action-row"
            @click=${this.#exportAsJSON}>
            <custom-icon icon="code"></custom-icon>
            Export as JSON
          </div>
          <div
            class="action-row"
            @click=${this.#addToCatalog}>
            <custom-icon icon="save"></custom-icon>
            Add to catalog
          </div>
        </div>
      </object-item>
    `
  }
}
