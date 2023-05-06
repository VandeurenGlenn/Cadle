import { LitElement, html, css, PropertyDeclarations } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import './item.js'
import { map } from 'lit/directives/map.js';

declare global {
  interface HTMLElementTagNameMap {
    'catalog-category': CatalogCategory;
  }
}

@customElement('catalog-category')
export class CatalogCategory extends LitElement {

  @property({ type: String })
  category: string

  @property({ type: Array })
  symbols: { name: string, path: string }[]

  @property({ type: Boolean, reflect: true})
  open: boolean

  
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 100%;
      }

      .symbol-container, .symbol-container catalog-item {
        height: 0;
        will-change: height;
        opacity: 0;
        pointer-events: none;
        padding-left: 12px;
      }
      
      :host([open]) .symbol-container, :host([open]) .symbol-container catalog-item {
        height: auto;
        pointer-events: auto;
        opacity: 1;
      }

      :host([open]) .symbol-container catalog-item {
        min-height: 40px;
      }
    `
  ];

  render() {
    return html`
    <catalog-item .headline="${this.category}" @click=${() => (this.open = !this.open)}>
      <flex-one></flex-one>
      <md-standard-icon-button
        toggle
        slot="end"
        data-variant="icon"
        aria-label="Show items for ${this.category}"
        selected-aria-label="Hide items for ${this.category}">
          expand_more
          <span slot="selectedIcon">expand_less</span>
      </md-standard-icon-button>
    </catalog-item>
    
    <flex-column class="symbol-container">
      ${map(this.symbols, (symbol => html`
        <catalog-item .headline="${symbol.name}" .image=${symbol.path}></catalog-item>
      `))}
      <slot></slot>
    </flex-column>
    `;
  }
}
