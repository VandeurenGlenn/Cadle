import { LitElement, html, css } from 'lit'
import { customElement, state } from 'lit/decorators.js'
import './object/color.js'
import './object/export.js'
import './object/position.js'
import './object/scale.js'
import './object/binding.js'
import './object/text.js'
import './object/overlay.js'
import '../header.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'

@customElement('object-pane')
export class ObjectPane extends LitElement {
  @state()
  private _activeObjectLabel = 'No selection'

  @state()
  private _selectionCount = 0

  private _selectionHandlersBound = false

  static styles = [
    css`
      :host {
        position: absolute;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        --md-list-item-list-item-container-color: #fff;
        --md-list-item-list-item-leading-avatar-color: #fff;
        --md-list-item-list-item-leading-avatar-shape: 0;
        pointer-events: auto;
        top: 64px;
        right: 0;
        bottom: 0;
        width: 320px;

        border-left: 1px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface);
        box-shadow: -2px 0 8px rgba(0, 0, 0, 0.06);
      }

      section {
        min-height: 0;
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        padding: 8px;
        gap: 8px;
      }

      .title {
        font-size: 14px;
        font-weight: 600;
        color: var(--md-sys-color-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 4px 8px;
      }

      .meta {
        font-size: 12px;
        color: var(--md-sys-color-on-surface-variant);
        padding: 0 8px;
        font-weight: 500;
      }

      .toolbar {
        padding: 12px 8px;
        border-top: 1px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface-variant);
        display: flex;
        gap: 8px;
      }

      custom-button {
        pointer-events: auto;
        border-radius: 8px;
        transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      custom-button:hover {
        background: var(--md-sys-color-primary-container);
        transform: translateY(-1px);
      }
    `
  ]

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

  #formatObjectLabel(object: any): string {
    const customName = object?.name || object?.label || object?.bindingName
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
    return html`
      <cadle-header>
        <div class="title">${this._activeObjectLabel}</div>
        <div
          class="meta"
          slot="end">
          ${this._selectionCount === 0 ? '0 selected' : `${this._selectionCount} selected`}
        </div>
      </cadle-header>

      <section>
        <object-color></object-color>
        <object-text></object-text>
        <object-binding></object-binding>
        <object-scale></object-scale>
        <object-position></object-position>
        <object-overlay></object-overlay>
        <object-export></object-export>
      </section>

      <div class="toolbar">
        <custom-icon-button
          icon="measuring_tape"
          @click=${() => (cadleShell.showMeasurements = !cadleShell.showMeasurements)}></custom-icon-button>
      </div>
    `
  }
}
