import { LiteElement, html, css, customElement, property } from '@vandeurenglenn/lite'
import styles from './styles/catalog.css' with { type: 'css' }
import './category.js'
import type { Catalog } from '../../types.js'
import './../search.js'
declare global {
  interface HTMLElementTagNameMap {
    'catalog-element': CatalogElement
  }
}
@customElement('catalog-element')
export class CatalogElement extends LiteElement {
  @property({ attribute: false, consumes: 'catalog' })
  accessor catalog: Catalog = []

  @property()
  private accessor _searchQuery = ''

  static styles = [styles]

  firstRender() {
    this.addListener('dragover', this.#dragover)
    this.addListener('dragleave', () => this.removeAttribute('show-drop'))
    this.addListener('drop', this.#drop)
  }

  get #catalogTemplate() {
    return this.#filteredCatalog.map(
      (item) => html`
        <catalog-category
          .category=${item.category}
          .symbols=${item.symbols}
          .searchActive=${Boolean(this._searchQuery)}
          .matchCount=${item.symbols.length}></catalog-category>
      `
    )
  }

  get #filteredCatalog() {
    const query = this._searchQuery.trim().toLowerCase()
    if (!query) return this.catalog ?? []
    return (this.catalog ?? [])
      .map((item) => {
        const categoryMatch = item.category.toLowerCase().includes(query)
        const symbols = categoryMatch
          ? item.symbols
          : item.symbols.filter((symbol) => {
              const haystack = `${symbol.name} ${symbol.path} ${JSON.stringify(symbol.metadata ?? {})}`.toLowerCase()
              return haystack.includes(query)
            })
        return {
          ...item,
          symbols
        }
      })
      .filter((item) => item.symbols.length > 0)
  }

  get #resultCount() {
    return this.#filteredCatalog.reduce((count, item) => count + item.symbols.length, 0)
  }

  #dragover = (event) => {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  #drop = (event) => {
    event.preventDefault()
    console.log(event)
  }

  #search = (event: CustomEvent) => {
    this._searchQuery = String(event.detail ?? '')
  }

  render() {
    return html`
      <search-element
        @search=${this.#search}
        name="search_catalog"
        placeholder="search symbol"></search-element>
      ${this._searchQuery
        ? html`<div class="search-status">
            ${this.#resultCount} result${this.#resultCount === 1 ? '' : 's'} for "${this._searchQuery}"
          </div>`
        : ''}
      <flex-column>${this.catalog ? this.#catalogTemplate : ''}</flex-column>
    `
  }
}
