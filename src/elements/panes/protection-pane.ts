import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import type { FabricObject } from 'fabric'
import type { JsonValue } from '../../types.js'
import styles from './object-pane.css' with { type: 'css' }
import { buildKlemmenlijstTSV, buildLabelSheetHTML, downloadText } from '../../helpers/panel-labels.js'
import { ProtectionSymbolClassifier } from '../../helpers/protection-symbol.js'
import './object/color.js'
import './object/export.js'
import './object/position.js'
import './object/scale.js'
import './object/binding.js'
import './object/protection.js'
import './object/text.js'
import './object/overlay.js'
import '../header.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/lite-elements/icon.js'
@customElement('protection-pane')
export class ProtectionPane extends LiteElement {
  @property()
  private accessor _activeObjectLabel = 'No selection'

  @property({ type: Number })
  private accessor _selectionCount = 0

  @property({ type: Boolean, attribute: false })
  private accessor _isProtectionSelection = false

  private _selectionHandlersBound = false
  static styles = [styles]

  connectedCallback(): void {
    super.connectedCallback()
    this.#ensureSelectionBindings()
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    const canvas = cadleShell?.field?.canvas
    if (canvas && this._selectionHandlersBound) {
      canvas.off('selection:created', this.#syncSelectionLabel)
      canvas.off('selection:updated', this.#syncSelectionLabel)
      canvas.off('selection:cleared', this.#syncSelectionLabel)
      this._selectionHandlersBound = false
    }
  }

  #ensureSelectionBindings = () => {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) {
      requestAnimationFrame(this.#ensureSelectionBindings)
      return
    }

    if (!this._selectionHandlersBound) {
      canvas.on('selection:created', this.#syncSelectionLabel)
      canvas.on('selection:updated', this.#syncSelectionLabel)
      canvas.on('selection:cleared', this.#syncSelectionLabel)
      this._selectionHandlersBound = true
    }

    this.#syncSelectionLabel()
  }

  #formatObjectLabel(object: FabricObject | Record<string, JsonValue> | null | undefined): string {
    const objectRecord = object as Record<string, JsonValue>
    const customName = objectRecord?.name || objectRecord?.label || objectRecord?.bindingName
    if (typeof customName === 'string' && customName.trim().length > 0) return customName
    const rawType = object?.type || object?.constructor?.name || 'Object'
    if (typeof rawType !== 'string') return 'Object'
    return rawType
      .replace(/^Cadle/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim()
  }

  #syncSelectionLabel = () => {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObjects = canvas.getActiveObjects?.() ?? []
    this._selectionCount = activeObjects.length
    this._isProtectionSelection =
      activeObjects.length > 0 &&
      activeObjects.every((object) => ProtectionSymbolClassifier.isProtectionSymbol(object as FabricObject))

    if (activeObjects.length === 0) {
      this._activeObjectLabel = 'No selection'
      return
    }

    if (activeObjects.length > 1) {
      this._activeObjectLabel = 'Multiple objects selected'
      return
    }

    this._activeObjectLabel = this.#formatObjectLabel(activeObjects[0])
  }

  render() {
    const hasSelection = this._selectionCount > 0
    const headerTitle = this._isProtectionSelection ? 'Protection settings' : this._activeObjectLabel
    const headerMeta = this._isProtectionSelection ? 'Circuit protection' : `${this._selectionCount} selected`
    return html`
      ${hasSelection
        ? html`
            <cadle-header>
              <div class="title">${headerTitle}</div>
              <div
                class="meta"
                slot="end">
                ${headerMeta}
              </div>
            </cadle-header>
            <section>
              ${this._isProtectionSelection
                ? html` <object-protection .active=${true}></object-protection> `
                : html`
                    <object-color></object-color>
                    <object-text></object-text>
                    <object-binding></object-binding>
                    <object-protection></object-protection>
                    <object-scale></object-scale>
                    <object-position></object-position>
                    <object-overlay></object-overlay>
                    <object-export></object-export>
                  `}
            </section>
            <div class="toolbar">
              <span class="toolbar-label">Measurements</span>
              <custom-icon-button
                icon="measuring_tape"
                title="Toggle measurement labels on the canvas"
                @click=${() => (cadleShell.showMeasurements = !cadleShell.showMeasurements)}></custom-icon-button>
              <custom-icon-button
                icon="table_view"
                title="Export panel labels/TSV"
                @click=${this.exportPanelLabels}></custom-icon-button>
            </div>
          `
        : html`
            <div class="empty-state">
              <div class="empty-card">
                <custom-icon icon="arrow_selector_tool"></custom-icon>
                <span class="empty-title">No selection</span>
                <span class="empty-hint">Select an object to inspect.</span>
              </div>
            </div>
          `}
    `
  }

  exportPanelLabels() {
    const field = cadleShell?.field
    if (!field) return
    const groups = field.getBindingGroups()
    // Map draw.ts group objects to PanelLabelRow[]
    const rows = groups.map((g) => ({
      bindingId: g.bindingId,
      letter: g.letter,
      number: g.number,
      description: '',
      wireSection: g.wireSection,
      breakerAmperage: g.breakerAmperage,
      switches: g.switches,
      loads: g.loads,
      ready: g.ready
    }))
    // Export TSV
    const tsv = buildKlemmenlijstTSV(rows)
    downloadText('panel-klemmenlijst.tsv', tsv, 'text/tab-separated-values')
    // Export printable label sheet (HTML)
    const html = buildLabelSheetHTML(rows, cadleShell?.projectName || 'Project')
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
  }
}
