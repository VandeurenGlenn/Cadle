import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './styles/category.css' with { type: 'css' }
import { map } from '@vandeurenglenn/lite/map.js'
import './item.js'
import type { Catalog } from './../../types.js'
import '@vandeurenglenn/lite-elements/toggle.js'
declare global {
  interface HTMLElementTagNameMap {
    'catalog-category': CatalogCategory
  }
}
@customElement('catalog-category')
export class CatalogCategory extends LiteElement {
  @property({ type: String })
  accessor category = ''

  @property({ type: Array })
  accessor symbols: Catalog[number]['symbols'] = []

  @property({ type: Boolean, reflect: true })
  accessor open = false

  @property({ type: Boolean })
  accessor openedOnce = false

  @property({ type: Boolean })
  accessor searchActive = false

  @property({ type: Number })
  accessor matchCount = 0

  static styles = [styles]

  beforeRender(): void {
    if (this.open && !this.openedOnce) this.openedOnce = true
  }

  render() {
    return html`
      <button
        type="button"
        class="category-header"
        @click=${() => (this.open = !this.open)}
        aria-expanded=${this.open ? 'true' : 'false'}>
        <custom-toggle
          data-variant="icon"
          aria-label="Show items for ${this.category}"
          selected-aria-label="Hide items for ${this.category}"
          togglers='["tree_closed", "tree_open"]'
          active=${this.open ? 1 : 0}>
        </custom-toggle>
        <span class="category-line">
          <span>${this.category}</span>
          ${this.searchActive ? html`<span class="match-pill">${this.matchCount}</span>` : ''}
        </span>
      </button>
      ${this.open || this.searchActive
        ? html`<div class="divider"></div>
            <flex-column class="items">
              ${map(
                this.symbols,
                (symbol, i) => html`
                  <catalog-item
                    tabindex=${i + 1}
                    .symbol=${symbol}
                    .headline=${symbol.name}
                    .image=${symbol.path}></catalog-item>
                `
              )}
              <slot></slot>
            </flex-column> `
        : ''}
    `
  }
}
