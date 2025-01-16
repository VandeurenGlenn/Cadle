import { LitElement, html, css, PropertyDeclarations, PropertyValueMap } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './item.js'
import { map } from 'lit/directives/map.js'

declare global {
  interface HTMLElementTagNameMap {
    'catalog-category': CatalogCategory
  }
}

@customElement('catalog-category')
export class CatalogCategory extends LitElement {
  @property({ type: String })
  category: string

  @property({ type: Array })
  symbols: { name: string; path: string }[]

  @property({ type: Boolean, reflect: true })
  open: boolean

  @property({ type: Boolean })
  openedOnce: boolean

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .symbol-container,
      .symbol-container catalog-item {
        height: 0;
        will-change: height;
        opacity: 0;
        pointer-events: none;
        padding-left: 24px;
      }

      :host([open]) .symbol-container,
      :host([open]) .symbol-container catalog-item {
        height: auto;
        pointer-events: auto;
        opacity: 1;
      }

      :host([open]) .symbol-container catalog-item {
        min-height: 40px;
      }

      custom-list-item:active,
      catalog-item:active {
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
      }

      custom-list-item,
      catalog-item {
        color: var(--md-sys-color-on-surface-variant);
        font-family: var(--md-sys-typescale-label-large-font-family-name);
        font-style: var(--md-sys-typescale-label-large-font-family-style);
        font-weight: var(--md-sys-typescale-label-large-font-weight);
        font-size: var(--md-sys-typescale-label-large-font-size);
        letter-spacing: var(--md-sys-typescale-label-large-tracking);
        line-height: var(--md-sys-typescale-label-large-height);
        text-transform: var(--md-sys-typescale-label-large-text-transform);
        text-decoration: var(--md-sys-typescale-label-large-text-decoration);
      }

      custom-list-item:hover,
      custom-list-item:focus,
      catalog-item:hover,
      catalog-item:focus {
        background: var(--md-sys-color-secondary-container-hover);
        color: var(--md-sys-color-on-secondary-container);
      }
    `
  ]

  protected willUpdate(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
    if (!this.openedOnce && _changedProperties.has('open')) {
      if (this.open) this.openedOnce = true
    }
  }

  render() {
    return html`
      <custom-list-item
        @click=${() => (this.open = !this.open)}
        tabindex="0">
        <custom-toggle
          slot="start"
          data-variant="icon"
          aria-label="Show items for ${this.category}"
          selected-aria-label="Hide items for ${this.category}"
          togglers='["tree_closed", "tree_open"]'
          active=${this.open ? 1 : 0}>
        </custom-toggle>
        <flex-it></flex-it>
        ${this.category}
      </custom-list-item>

      <flex-column class="symbol-container">
        ${this.openedOnce
          ? map(
              this.symbols,
              (symbol, i) => html`
                <catalog-item
                  tabindex=${i + 1}
                  .headline=${symbol.name}
                  image=${symbol.path}></catalog-item>
              `
            )
          : ''}

        <slot></slot>
      </flex-column>
    `
  }
}
