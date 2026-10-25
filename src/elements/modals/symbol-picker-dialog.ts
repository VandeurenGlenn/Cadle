import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import type { Catalog } from '../../types.js'
import '../catalog/catalog.js'
import '@vandeurenglenn/lite-elements/icon.js'
import styles from './symbol-picker-dialog.css' with { type: 'css' }

@customElement('symbol-picker-dialog')
export class SymbolPickerDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ attribute: false }) accessor catalog: Catalog = []

  static styles = [styles]

  onChange(property: string) {
    if (property !== 'open') return
    this.toggleAttribute('data-open', this.open)
    this.setAttribute('aria-hidden', String(!this.open))
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #onSymbolPicked = () => {
    this.#close()
  }

  render() {
    if (!this.open) return html``
    return html`
      <button
        class="scrim"
        type="button"
        aria-label="Close symbol picker"
        @click=${this.#close}></button>
      <section
        class="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-picker-title">
        <header>
          <div>
            <h2 id="symbol-picker-title">Add symbol</h2>
            <p>Choose a symbol, then tap the plan to place it.</p>
          </div>
          <button
            class="close-button"
            type="button"
            title="Close"
            aria-label="Close symbol picker"
            @click=${this.#close}>
            <custom-icon icon="close"></custom-icon>
          </button>
        </header>
        <div class="catalog-body">
          <catalog-element
            .browseMode=${true}
            .catalog=${this.catalog}
            @catalog-symbol-picked=${this.#onSymbolPicked}></catalog-element>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'symbol-picker-dialog': SymbolPickerDialog
  }
}
