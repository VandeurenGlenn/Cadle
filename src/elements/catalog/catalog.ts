import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './styles/catalog.css' with { type: 'css' }
import './category.js'
import './catalog-editor.js'
import type { Catalog } from '../../types.js'
import {
  ensureCustomCatalogLoaded,
  moveCustomCatalogCategory,
  moveCustomCatalogSymbol
} from '../../shell/custom-symbols.js'
import {
  applyCatalogSymbolOverrides,
  ensureCatalogSymbolOverridesLoaded
} from '../../shell/catalog-symbol-overrides.js'
import './../search.js'

const RECENT_SYMBOLS_KEY = 'cadle.catalog.recentSymbols'
const MAX_RECENT_SYMBOLS = 10

type CatalogSymbol = Catalog[number]['symbols'][number]

type RecentSymbolEntry = {
  category: string
  folder?: string
  symbol: CatalogSymbol
}

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

  @property({ type: Array })
  private accessor _recentSymbols: RecentSymbolEntry[] = []

  @property({ type: Boolean })
  private accessor _editorOpen = false

  static styles = [styles]

  async firstRender() {
    await Promise.all([ensureCustomCatalogLoaded(), ensureCatalogSymbolOverridesLoaded()])
    this._recentSymbols = this.#readRecentSymbols()
    this.addListener('dragover', this.#dragover)
    this.addListener('dragleave', () => this.removeAttribute('show-drop'))
    this.addListener('drop', this.#drop)
    this.addListener('catalog-move-request', this.#onCatalogMoveRequest as EventListener)
    this.addListener('catalog-symbol-picked', this.#onSymbolPicked as EventListener)
  }

  #readRecentSymbols(): RecentSymbolEntry[] {
    try {
      const raw = localStorage.getItem(RECENT_SYMBOLS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const candidate = entry as Record<string, unknown>
          const category = typeof candidate.category === 'string' ? candidate.category : ''
          const symbolCandidate = candidate.symbol as CatalogSymbol | undefined
          const name = typeof symbolCandidate?.name === 'string' ? symbolCandidate.name : ''
          const path = typeof symbolCandidate?.path === 'string' ? symbolCandidate.path : ''
          if (!category || !name || !path) return null
          return {
            category,
            folder: typeof candidate.folder === 'string' ? candidate.folder : undefined,
            symbol: {
              kind: typeof symbolCandidate.kind === 'string' ? symbolCandidate.kind : category,
              name,
              path,
              folder: typeof symbolCandidate.folder === 'string' ? symbolCandidate.folder : undefined,
              metadata:
                symbolCandidate.metadata && typeof symbolCandidate.metadata === 'object'
                  ? symbolCandidate.metadata
                  : undefined
            }
          } as RecentSymbolEntry
        })
        .filter((entry): entry is RecentSymbolEntry => Boolean(entry))
        .slice(0, MAX_RECENT_SYMBOLS)
    } catch {
      return []
    }
  }

  #writeRecentSymbols() {
    localStorage.setItem(RECENT_SYMBOLS_KEY, JSON.stringify(this._recentSymbols.slice(0, MAX_RECENT_SYMBOLS)))
  }

  #rememberRecentSymbol(entry: RecentSymbolEntry) {
    const key = `${entry.category}::${entry.symbol.name}::${entry.symbol.path}`
    const deduped = this._recentSymbols.filter(
      (item) => `${item.category}::${item.symbol.name}::${item.symbol.path}` !== key
    )
    this._recentSymbols = [entry, ...deduped].slice(0, MAX_RECENT_SYMBOLS)
    this.#writeRecentSymbols()
  }

  #onSymbolPicked = (event: CustomEvent) => {
    const detail = event.detail as { category?: string; folder?: string; symbol?: CatalogSymbol } | undefined
    if (!detail?.symbol || !detail?.category) return
    const symbol = detail.symbol
    if (!symbol.name || !symbol.path) return
    this.#rememberRecentSymbol({
      category: detail.category,
      folder: detail.folder,
      symbol
    })
  }

  #dispatchCatalogUpdated = () => {
    this.dispatchEvent(
      new CustomEvent('catalog-structure-updated', {
        bubbles: true,
        composed: true
      })
    )
  }

  get #catalogTemplate() {
    return this.#filteredCatalog.map(
      (item) => html`
        <catalog-category
          .folder=${item.folder}
          .category=${item.category}
          .symbols=${item.symbols}
          .searchActive=${Boolean(this._searchQuery)}
          .matchCount=${item.symbols.length}></catalog-category>
      `
    )
  }

  get #visibleCatalog() {
    return applyCatalogSymbolOverrides(this.catalog ?? [])
  }

  get #filteredCatalog() {
    const query = this._searchQuery.trim().toLowerCase()
    if (!query) return this.#visibleCatalog
    return this.#visibleCatalog
      .map((item) => {
        const categoryMatch = item.category.toLowerCase().includes(query)
        const symbols = categoryMatch
          ? item.symbols
          : item.symbols.filter((symbol) => {
              const haystack =
                `${item.folder ?? ''} ${symbol.folder ?? ''} ${symbol.name} ${symbol.path} ${JSON.stringify(symbol.metadata ?? {})}`.toLowerCase()
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

  get #catalogSymbolCount() {
    return this.#visibleCatalog.reduce((count, item) => count + item.symbols.length, 0)
  }

  get #filteredRecentSymbols() {
    const query = this._searchQuery.trim().toLowerCase()
    const recentEntries = query
      ? this._recentSymbols.filter((entry) => {
          const haystack =
            `${entry.category} ${entry.folder ?? ''} ${entry.symbol.name} ${entry.symbol.path}`.toLowerCase()
          return haystack.includes(query)
        })
      : this._recentSymbols
    const [recentSection] = applyCatalogSymbolOverrides([
      {
        category: 'Recent symbols',
        symbols: recentEntries.map((entry) => ({
          ...entry.symbol,
          folder: entry.folder ?? entry.symbol.folder
        }))
      }
    ])
    return recentSection?.symbols ?? []
  }

  #dragover = (event) => {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  #drop = (event) => {
    event.preventDefault()
    this.removeAttribute('show-drop')

    const payload = event.dataTransfer?.getData('application/x-cadle-catalog-dnd')
    if (!payload) return
    try {
      const source = JSON.parse(payload) as Record<string, string>
      if (source.kind === 'category' && source.category) {
        void moveCustomCatalogCategory(source.category, source.fromFolder, undefined).then(() => {
          this.#dispatchCatalogUpdated()
        })
      }
    } catch {
      // Ignore malformed drag payloads.
    }
  }

  #onCatalogMoveRequest = async (event: CustomEvent) => {
    const detail = event.detail as {
      source?: Record<string, string>
      target?: { category?: string; folder?: string }
    }
    const source = detail?.source
    const target = detail?.target
    if (!source || !target?.category) return

    if (source.kind === 'category' && source.category) {
      if (source.category === target.category && (source.fromFolder ?? '') === (target.folder ?? '')) return
      await moveCustomCatalogCategory(source.category, source.fromFolder, target.folder)
      this.#dispatchCatalogUpdated()
      return
    }

    if (source.kind === 'symbol' && source.name && source.path && source.fromCategory) {
      await moveCustomCatalogSymbol(
        source.name,
        source.path,
        source.fromCategory,
        source.fromFolder,
        target.category,
        target.folder
      )
      this.#dispatchCatalogUpdated()
    }
  }

  #openEditor = () => {
    this._editorOpen = true
  }

  #closeEditor = () => {
    this._editorOpen = false
  }

  #onEditorUpdated = () => {
    this.#dispatchCatalogUpdated()
    this.requestRender()
  }

  #search = (event: CustomEvent) => {
    this._searchQuery = String(event.detail ?? '')
  }

  render() {
    return html`
      <div class="catalog-tools">
        <div class="catalog-header-row">
          <div class="catalog-meta">
            <span>${this.#visibleCatalog.length} categories</span>
            <span>${this.#catalogSymbolCount} symbols</span>
          </div>
          <button
            type="button"
            class="editor-button"
            @click=${this.#openEditor}>
            Edit catalog
          </button>
        </div>
        <search-element
          @search=${this.#search}
          name="search_catalog"
          placeholder="Search symbols"></search-element>
        ${this._searchQuery
          ? html`<div class="search-status">
              ${this.#resultCount} result${this.#resultCount === 1 ? '' : 's'} for "${this._searchQuery}"
            </div>`
          : ''}
      </div>
      ${this.#filteredRecentSymbols.length > 0
        ? html`<catalog-category
            .category=${'Recent symbols'}
            .symbols=${this.#filteredRecentSymbols}
            .searchActive=${Boolean(this._searchQuery)}
            .matchCount=${this.#filteredRecentSymbols.length}
            .open=${true}
            .openedOnce=${true}></catalog-category>`
        : ''}
      <flex-column>${this.catalog ? this.#catalogTemplate : ''}</flex-column>
      <catalog-editor
        .catalog=${this.catalog ?? []}
        .open=${this._editorOpen}
        @close=${this.#closeEditor}
        @catalog-editor-updated=${this.#onEditorUpdated}></catalog-editor>
    `
  }
}
