import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './styles/catalog.css' with { type: 'css' }
import './category.js'
import type { Catalog } from '../../types.js'
import {
  ensureCustomCatalogLoaded,
  getStoredCustomCategories,
  getStoredCustomFolders,
  createCustomCatalogFolder,
  renameCustomCatalogFolder,
  deleteCustomCatalogFolder,
  createCustomCatalogCategory,
  renameCustomCatalogCategory,
  deleteCustomCatalogCategory,
  moveCustomCatalogCategory,
  moveCustomCatalogSymbol,
  type CustomCatalogCategory
} from '../../shell/custom-symbols.js'
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
  private accessor _folders: string[] = []

  @property({ type: Array })
  private accessor _categories: CustomCatalogCategory[] = []

  @property({ type: String })
  private accessor _selectedFolder = ''

  @property({ type: String })
  private accessor _selectedCategoryKey = ''

  @property({ type: Array })
  private accessor _recentSymbols: RecentSymbolEntry[] = []

  static styles = [styles]

  async firstRender() {
    await ensureCustomCatalogLoaded()
    this.#refreshStructure()
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

  #categorySort = (left: CustomCatalogCategory, right: CustomCatalogCategory) => {
    const leftFolder = left.folder ?? ''
    const rightFolder = right.folder ?? ''
    if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
    return left.name.localeCompare(right.name)
  }

  #refreshStructure = () => {
    this._folders = getStoredCustomFolders()
    this._categories = getStoredCustomCategories().sort(this.#categorySort)
    if (this._selectedFolder && !this._folders.includes(this._selectedFolder)) {
      this._selectedFolder = ''
    }

    const selectedCategoryExists = this._categories.some(
      (category) => this.#categoryKey(category) === this._selectedCategoryKey
    )
    if (this._selectedCategoryKey && !selectedCategoryExists) {
      this._selectedCategoryKey = ''
    }
  }

  #dispatchCatalogUpdated = () => {
    this.dispatchEvent(
      new CustomEvent('catalog-structure-updated', {
        bubbles: true,
        composed: true
      })
    )
  }

  #categoryKey = (category: CustomCatalogCategory) => `${category.folder ?? ''}::${category.name}`

  #parseCategoryKey = (key: string) => {
    const [folder, ...rest] = key.split('::')
    return {
      folder: folder || undefined,
      name: rest.join('::')
    }
  }

  #createFolder = async () => {
    const name = globalThis.prompt('Folder name', this._selectedFolder)?.trim()
    if (!name) return
    await createCustomCatalogFolder(name)
    this.#refreshStructure()
    this._selectedFolder = name
    this.#dispatchCatalogUpdated()
  }

  #renameFolder = async () => {
    if (!this._selectedFolder) return
    const nextName = globalThis.prompt('Rename folder', this._selectedFolder)?.trim()
    if (!nextName || nextName === this._selectedFolder) return
    await renameCustomCatalogFolder(this._selectedFolder, nextName)
    this.#refreshStructure()
    this._selectedFolder = nextName
    this.#dispatchCatalogUpdated()
  }

  #deleteFolder = async () => {
    if (!this._selectedFolder) return
    const accepted = globalThis.confirm(
      `Delete folder "${this._selectedFolder}"? Categories and symbols will move to the root catalog.`
    )
    if (!accepted) return
    await deleteCustomCatalogFolder(this._selectedFolder)
    this.#refreshStructure()
    this._selectedFolder = ''
    this.#dispatchCatalogUpdated()
  }

  #createCategory = async () => {
    const name = globalThis.prompt('Category name', '')?.trim()
    if (!name) return
    await createCustomCatalogCategory(name, this._selectedFolder || undefined)
    this.#refreshStructure()
    this._selectedCategoryKey = `${this._selectedFolder || ''}::${name}`
    this.#dispatchCatalogUpdated()
  }

  #renameCategory = async () => {
    if (!this._selectedCategoryKey) return
    const category = this.#parseCategoryKey(this._selectedCategoryKey)
    if (!category.name) return
    const nextName = globalThis.prompt('Rename category', category.name)?.trim()
    if (!nextName || nextName === category.name) return
    await renameCustomCatalogCategory(category.name, nextName, category.folder)
    this.#refreshStructure()
    this._selectedCategoryKey = `${category.folder ?? ''}::${nextName}`
    this.#dispatchCatalogUpdated()
  }

  #deleteCategory = async () => {
    if (!this._selectedCategoryKey) return
    const category = this.#parseCategoryKey(this._selectedCategoryKey)
    if (!category.name) return
    const accepted = globalThis.confirm(`Delete category "${category.name}"? Symbols in it will move to "My Symbols".`)
    if (!accepted) return
    await deleteCustomCatalogCategory(category.name, category.folder)
    this.#refreshStructure()
    this._selectedCategoryKey = ''
    this.#dispatchCatalogUpdated()
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

  get #filteredCatalog() {
    const query = this._searchQuery.trim().toLowerCase()
    if (!query) return this.catalog ?? []
    return (this.catalog ?? [])
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
    return (this.catalog ?? []).reduce((count, item) => count + item.symbols.length, 0)
  }

  get #filteredRecentSymbols() {
    const query = this._searchQuery.trim().toLowerCase()
    if (!query) return this._recentSymbols
    return this._recentSymbols.filter((entry) => {
      const haystack = `${entry.category} ${entry.folder ?? ''} ${entry.symbol.name} ${entry.symbol.path}`.toLowerCase()
      return haystack.includes(query)
    })
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
          this.#refreshStructure()
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
      this.#refreshStructure()
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
      this.#refreshStructure()
      this.#dispatchCatalogUpdated()
    }
  }

  #search = (event: CustomEvent) => {
    this._searchQuery = String(event.detail ?? '')
  }

  render() {
    return html`
      <section class="manage-panel">
        <div class="manage-row">
          <label
            class="manage-label"
            for="catalog-folder-select"
            >Folder</label
          >
          <select
            id="catalog-folder-select"
            .value=${this._selectedFolder}
            @change=${(event: Event) => {
              this._selectedFolder = (event.currentTarget as HTMLSelectElement).value
            }}>
            <option value="">Root</option>
            ${this._folders.map((folder) => html`<option value=${folder}>${folder}</option>`)}
          </select>
          <button
            type="button"
            @click=${this.#createFolder}>
            New
          </button>
          <button
            type="button"
            @click=${this.#renameFolder}
            ?disabled=${!this._selectedFolder}>
            Rename
          </button>
          <button
            type="button"
            @click=${this.#deleteFolder}
            ?disabled=${!this._selectedFolder}>
            Delete
          </button>
        </div>
        <div class="manage-row">
          <label
            class="manage-label"
            for="catalog-category-select"
            >Category</label
          >
          <select
            id="catalog-category-select"
            .value=${this._selectedCategoryKey}
            @change=${(event: Event) => {
              this._selectedCategoryKey = (event.currentTarget as HTMLSelectElement).value
            }}>
            <option value="">Select category</option>
            ${this._categories.map((category) => {
              const key = this.#categoryKey(category)
              const label = category.folder ? `${category.folder} / ${category.name}` : category.name
              return html`<option value=${key}>${label}</option>`
            })}
          </select>
          <button
            type="button"
            @click=${this.#createCategory}>
            New
          </button>
          <button
            type="button"
            @click=${this.#renameCategory}
            ?disabled=${!this._selectedCategoryKey}>
            Rename
          </button>
          <button
            type="button"
            @click=${this.#deleteCategory}
            ?disabled=${!this._selectedCategoryKey}>
            Delete
          </button>
        </div>
      </section>
      <div class="catalog-meta">
        <span>${(this.catalog ?? []).length} categories</span>
        <span>${this.#catalogSymbolCount} symbols</span>
      </div>
      <search-element
        @search=${this.#search}
        name="search_catalog"
        placeholder="search symbol"></search-element>
      ${this._searchQuery
        ? html`<div class="search-status">
            ${this.#resultCount} result${this.#resultCount === 1 ? '' : 's'} for "${this._searchQuery}"
          </div>`
        : ''}
      ${this.#filteredRecentSymbols.length > 0
        ? html`<catalog-category
            .category=${'Recent symbols'}
            .symbols=${this.#filteredRecentSymbols.map((entry) => ({
              ...entry.symbol,
              folder: entry.folder ?? entry.symbol.folder
            }))}
            .searchActive=${Boolean(this._searchQuery)}
            .matchCount=${this.#filteredRecentSymbols.length}
            .open=${true}
            .openedOnce=${true}></catalog-category>`
        : ''}
      <flex-column>${this.catalog ? this.#catalogTemplate : ''}</flex-column>
    `
  }
}
