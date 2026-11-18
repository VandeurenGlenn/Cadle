import { LiteElement, css, html, customElement, property } from '@vandeurenglenn/lite'
import { repeat } from 'lit/directives/repeat.js'
import type { Catalog } from '../../types.js'
import './item.js'

@customElement('catalog-symbol-list')
export class CatalogSymbolList extends LiteElement {
  @property({ attribute: false }) accessor sections: Catalog = []

  static styles = [css`
    :host { display: contents; }
    catalog-item {
      opacity: 1;
      pointer-events: auto;
      transition: opacity var(--cadle-motion-fast), transform var(--cadle-motion-fast);
    }
    catalog-item:hover {
      background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
      border-color: var(--md-sys-color-outline-variant);
    }
    catalog-item:focus-visible {
      outline: none;
      box-shadow: var(--cadle-focus-ring);
      border-color: var(--md-sys-color-outline-variant);
    }
    catalog-item:active {
      background: color-mix(in srgb, var(--md-sys-color-primary) 14%, transparent);
      border-color: color-mix(in srgb, var(--md-sys-color-primary) 45%, var(--md-sys-color-outline-variant));
      color: var(--md-sys-color-primary);
    }
  `]

  render() {
    return html`${repeat(this.sections, (section) => `${section.folder ?? ''}::${section.category}`,
      (section) => repeat(section.symbols, (symbol) => `${symbol.path}::${symbol.name}`, (symbol) => html`
        <catalog-item tabindex="0"
          .category=${section.category} .folder=${section.folder ?? ''}
          .symbol=${symbol} .headline=${symbol.name} .image=${symbol.path}></catalog-item>
      `))}`
  }
}
