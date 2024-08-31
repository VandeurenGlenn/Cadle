import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import './category.js'
import { Catalog } from '../../context/catalog.js'
import { consume } from '@lit-labs/context'
import './../search.js'

declare global {
  interface HTMLElementTagNameMap {
    'catalog-element': CatalogElement
  }
}

@customElement('catalog-element')
export class CatalogElement extends LitElement {
  #catalogBackup

  @consume({ context: 'catalogContext', subscribe: true })
  @property({ attribute: false })
  set catalog(value: Catalog) {
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
      }
      flex-column {
        height: 100%;
        overflow-y: auto;
      }

      input[type='search'] {
        height: 40px;
        margin: 12px;
        padding: 6px 12px;
        box-sizing: border-box;
        border: none;
        border-radius: var(--md-sys-shape-corner-large);
      }
    `
  ]

  get #catalogTemplate() {
    console.log(this.catalog)

    return this.catalog.map(
      (item) => html`
        <catalog-category
          .category=${item.category}
          .symbols=${item.symbols}></catalog-category>
      `
    )
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('drop', this.#drop.bind(this))
    this.addEventListener('dragover', this.#dragover.bind(this))

    // this.addEventListener('mousedown', () => {
    //   const target = this.shadowRoot.querySelector('[open]')
    //   if (target) target.open = false
    // })
  }

  #dragover(event) {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  #drop(event) {
    event.preventDefault()
    console.log(event)
  }

  #search = (event: CustomEvent) => {
    if (!this.#catalogBackup) this.#catalogBackup = this._catalog
    if (!event.detail) {
      this.catalog = this.#catalogBackup
      this.#catalogBackup = undefined
    } else {
      this.catalog = JSON.parse(JSON.stringify(this.#catalogBackup)).filter((item) => {
        item.symbols = [...item.symbols].filter((symbol) => symbol.name.includes(event.detail))
        return item.symbols.length > 0 || item.category.includes(event.detail)
      })
    }
  }

  render() {
    return html`
      <flex-column>${this.catalog ? this.#catalogTemplate : ''}</flex-column>
      <search-element
        @search=${this.#search}
        name="search_catalog"
        placeholder="search symbol"></search-element>
    `
  }
}
