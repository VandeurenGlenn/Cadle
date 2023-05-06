import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import './category.js'
import { Catalog, catalogContext } from '../../context/catalog.js';
import { consume } from '@lit-labs/context';
import {ContextRoot} from '@lit-labs/context';



declare global {
  interface HTMLElementTagNameMap {
    'catalog-element': CatalogElement;
  }
}

@customElement('catalog-element')
export class CatalogElement extends LitElement {
  @consume({context: catalogContext, subscribe: true})
  @property({attribute: false})
  set catalog(value : Catalog) {
    this._catalog = value
    this.requestUpdate('catalog')
  }

  get catalog() {
    return this._catalog
  }

  private _catalog: Catalog
  

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        overflow-y: auto;
      }
    `
  ];

  constructor() {
    super()

  }

  get #catalogTemplate() {
    console.log(this.catalog);
    
    return this.catalog.map(item => html`
      <catalog-category .category=${item.category} .symbols=${item.symbols}></catalog-category>
    `)
  }

  render() {
    return html`
      ${this.catalog ? this.#catalogTemplate : ''}
    `;
  }
}
