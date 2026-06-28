import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './catalog-editor.css' with { type: 'css' }
import type { Catalog } from '../../types.js'
import {
  createCustomCatalogCategory,
  createCustomCatalogFolder,
  deleteCustomCatalogCategory,
  deleteCustomCatalogFolder,
  ensureCustomCatalogLoaded,
  getStoredCustomCategories,
  getStoredCustomFolders,
  renameCustomCatalogCategory,
  renameCustomCatalogFolder,
  type CustomCatalogCategory
} from '../../shell/custom-symbols.js'
import {
  ensureCatalogSymbolOverridesLoaded,
  getStoredCatalogSymbolOverrides,
  setStoredCatalogSymbolOverride,
  type CatalogSymbolOverride
} from '../../shell/catalog-symbol-overrides.js'

const symbolKey = (symbol: Catalog[number]['symbols'][number]) => symbol.path

@customElement('catalog-editor')
export class CatalogEditor extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ attribute: false }) accessor catalog: Catalog = []
  @property({ type: String }) private accessor _selectedFolder = ''
  @property({ type: String }) private accessor _selectedCategoryKey = ''
  @property({ type: String }) private accessor _symbolQuery = ''
  @property({ type: Array }) private accessor _folders: string[] = []
  @property({ type: Array }) private accessor _categories: CustomCatalogCategory[] = []
  @property({ type: Array }) private accessor _overrides: CatalogSymbolOverride[] = []

  static styles = [styles]

  async firstRender() {
    await Promise.all([ensureCustomCatalogLoaded(), ensureCatalogSymbolOverridesLoaded()])
    this.#refreshState()
  }

  #categoryKey = (category: CustomCatalogCategory) => `${category.folder ?? ''}::${category.name}`

  #parseCategoryKey = (key: string) => {
    const [folder, ...rest] = key.split('::')
    return {
      folder: folder || undefined,
      name: rest.join('::')
    }
  }

  #refreshState() {
    this._folders = getStoredCustomFolders()
    this._categories = getStoredCustomCategories().sort((left, right) => {
      const leftFolder = left.folder ?? ''
      const rightFolder = right.folder ?? ''
      if (leftFolder !== rightFolder) return leftFolder.localeCompare(rightFolder)
      return left.name.localeCompare(right.name)
    })
    this._overrides = getStoredCatalogSymbolOverrides()

    if (this._selectedFolder && !this._folders.includes(this._selectedFolder)) this._selectedFolder = ''
    if (this._selectedCategoryKey) {
      const selectedExists = this._categories.some(
        (category) => this.#categoryKey(category) === this._selectedCategoryKey
      )
      if (!selectedExists) this._selectedCategoryKey = ''
    }
  }

  #dispatchUpdated() {
    this.#refreshState()
    this.dispatchEvent(new CustomEvent('catalog-editor-updated', { bubbles: true, composed: true }))
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #createFolder = async () => {
    const name = globalThis.prompt('Folder name', this._selectedFolder)?.trim()
    if (!name) return
    await createCustomCatalogFolder(name)
    this._selectedFolder = name
    this.#dispatchUpdated()
  }

  #renameFolder = async () => {
    if (!this._selectedFolder) return
    const nextName = globalThis.prompt('Rename folder', this._selectedFolder)?.trim()
    if (!nextName || nextName === this._selectedFolder) return
    await renameCustomCatalogFolder(this._selectedFolder, nextName)
    this._selectedFolder = nextName
    this.#dispatchUpdated()
  }

  #deleteFolder = async () => {
    if (!this._selectedFolder) return
    const accepted = globalThis.confirm(
      `Delete folder "${this._selectedFolder}"? Categories and symbols will move to the root catalog.`
    )
    if (!accepted) return
    await deleteCustomCatalogFolder(this._selectedFolder)
    this._selectedFolder = ''
    this.#dispatchUpdated()
  }

  #createCategory = async () => {
    const name = globalThis.prompt('Category name', '')?.trim()
    if (!name) return
    await createCustomCatalogCategory(name, this._selectedFolder || undefined)
    this._selectedCategoryKey = `${this._selectedFolder || ''}::${name}`
    this.#dispatchUpdated()
  }

  #renameCategory = async () => {
    if (!this._selectedCategoryKey) return
    const category = this.#parseCategoryKey(this._selectedCategoryKey)
    if (!category.name) return
    const nextName = globalThis.prompt('Rename category', category.name)?.trim()
    if (!nextName || nextName === category.name) return
    await renameCustomCatalogCategory(category.name, nextName, category.folder)
    this._selectedCategoryKey = `${category.folder ?? ''}::${nextName}`
    this.#dispatchUpdated()
  }

  #deleteCategory = async () => {
    if (!this._selectedCategoryKey) return
    const category = this.#parseCategoryKey(this._selectedCategoryKey)
    if (!category.name) return
    const accepted = globalThis.confirm(`Delete category "${category.name}"? Symbols in it will move to "My Symbols".`)
    if (!accepted) return
    await deleteCustomCatalogCategory(category.name, category.folder)
    this._selectedCategoryKey = ''
    this.#dispatchUpdated()
  }

  #overrideFor(path: string) {
    return this._overrides.find((override) => override.path === path)
  }

  #allSymbols() {
    return this.catalog.flatMap((section) =>
      section.symbols.map((symbol) => ({
        section,
        symbol,
        key: symbolKey(symbol)
      }))
    )
  }

  #filteredSymbols() {
    const query = this._symbolQuery.trim().toLowerCase()
    const seen = new Set<string>()
    return this.#allSymbols().filter((entry) => {
      if (seen.has(entry.key)) return false
      seen.add(entry.key)
      if (!query) return true
      const override = this.#overrideFor(entry.key)
      const haystack =
        `${entry.section.folder ?? ''} ${entry.section.category} ${entry.symbol.name} ${override?.name ?? ''} ${entry.symbol.path}`.toLowerCase()
      return haystack.includes(query)
    })
  }

  #setSymbolName = async (path: string, baseName: string, value: string) => {
    const override = this.#overrideFor(path)
    const name = value.trim()
    await setStoredCatalogSymbolOverride(path, {
      name: name && name !== baseName ? name : undefined,
      disabled: override?.disabled
    })
    this.#dispatchUpdated()
  }

  #setSymbolDisabled = async (path: string, disabled: boolean) => {
    const override = this.#overrideFor(path)
    await setStoredCatalogSymbolOverride(path, {
      name: override?.name,
      disabled
    })
    this.#dispatchUpdated()
  }

  render() {
    const filteredSymbols = this.#filteredSymbols()
    return html`
      <div
        class="panel"
        @click=${(event: Event) => event.stopPropagation()}>
        <header class="header">
          <div>
            <h2>Catalog editor</h2>
            <p>Manage custom folders and categories, rename symbols, or hide symbols from the drawer.</p>
          </div>
          <button
            type="button"
            class="close-button"
            @click=${this.#close}>
            Close
          </button>
        </header>
        <div class="content">
          <section class="structure">
            <div class="group">
              <h3 class="group-title">Folders</h3>
              <label>
                Folder
                <select
                  .value=${this._selectedFolder}
                  @change=${(event: Event) => {
                    this._selectedFolder = (event.currentTarget as HTMLSelectElement).value
                  }}>
                  <option value="">Root</option>
                  ${this._folders.map((folder) => html`<option value=${folder}>${folder}</option>`)}
                </select>
              </label>
              <div class="editor-row">
                <button
                  type="button"
                  @click=${this.#createFolder}>
                  New folder
                </button>
                <button
                  type="button"
                  @click=${this.#renameFolder}
                  ?disabled=${!this._selectedFolder}>
                  Rename
                </button>
              </div>
              <button
                type="button"
                @click=${this.#deleteFolder}
                ?disabled=${!this._selectedFolder}>
                Delete selected folder
              </button>
            </div>
            <div class="group">
              <h3 class="group-title">Categories</h3>
              <label>
                Category
                <select
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
              </label>
              <div class="editor-row">
                <button
                  type="button"
                  @click=${this.#createCategory}>
                  New category
                </button>
                <button
                  type="button"
                  @click=${this.#renameCategory}
                  ?disabled=${!this._selectedCategoryKey}>
                  Rename
                </button>
              </div>
              <button
                type="button"
                @click=${this.#deleteCategory}
                ?disabled=${!this._selectedCategoryKey}>
                Delete selected category
              </button>
            </div>
          </section>
          <section class="symbols">
            <div class="symbol-toolbar">
              <label>
                Search symbols
                <input
                  type="search"
                  .value=${this._symbolQuery}
                  @input=${(event: Event) => {
                    this._symbolQuery = (event.currentTarget as HTMLInputElement).value
                  }} />
              </label>
              <h3 class="symbols-title">${filteredSymbols.length} symbols</h3>
            </div>
            <div class="symbol-list">
              ${filteredSymbols.length
                ? filteredSymbols.map(({ section, symbol, key }) => {
                    const override = this.#overrideFor(key)
                    const disabled = override?.disabled === true
                    return html`
                      <article
                        class="symbol-row"
                        aria-disabled=${disabled ? 'true' : 'false'}>
                        <div class="preview">
                          <img
                            src=${symbol.path}
                            alt="" />
                        </div>
                        <div class="symbol-main">
                          <div class="symbol-name">${override?.name ?? symbol.name}</div>
                          <div class="symbol-meta">
                            ${section.folder ? `${section.folder} / ` : ''}${section.category}
                          </div>
                          <label>
                            Drawer name
                            <input
                              type="text"
                              .value=${override?.name ?? symbol.name}
                              @change=${(event: Event) => {
                                void this.#setSymbolName(
                                  key,
                                  symbol.name,
                                  (event.currentTarget as HTMLInputElement).value
                                )
                              }} />
                          </label>
                        </div>
                        <div class="symbol-actions">
                          <label class="checkbox-label">
                            <input
                              type="checkbox"
                              .checked=${disabled}
                              @change=${(event: Event) => {
                                void this.#setSymbolDisabled(key, (event.currentTarget as HTMLInputElement).checked)
                              }} />
                            Hidden
                          </label>
                        </div>
                      </article>
                    `
                  })
                : html`<p class="empty">No symbols match the current search.</p>`}
            </div>
          </section>
        </div>
      </div>
    `
  }
}
