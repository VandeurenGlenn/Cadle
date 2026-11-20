import { LiteElement, html, customElement, property, query, listen } from '@vandeurenglenn/lite'
import styles from './project.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/selector.js'
import '@vandeurenglenn/lite-elements/drawer-item.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '../../ui/context-menu/context-menu.js'
import { Project, type PageType, UUID } from '../../types.js'
import { addPage, getProjectData, setProjectData } from '../../api/project.js'
declare global {
  interface HTMLElementTagNameMap {
    'project-element': ProjectElement
  }
}
@customElement('project-element')
export class ProjectElement extends LiteElement {
  @property({ attribute: false, consumes: 'project' })
  accessor project: Project | null = null

  @property({ attribute: false, consumes: 'projectKey' })
  accessor projectKey: UUID = '' as UUID

  @property({ attribute: false, consumes: 'loadedPage' })
  accessor loadedPage: string = ''

  currentSelected = ''
  @property({ attribute: false })
  accessor clipboard = undefined

  @query('.page-input')
  accessor pageInput!: HTMLInputElement

  @property({ type: String })
  accessor newPageType: PageType = 'groundplan'

  @property({ type: String })
  accessor newPageName = ''

  onChange(name: string): void {
    if (name === 'loadedPage') {
      queueMicrotask(() => {
        const selector = this.shadowRoot?.querySelector('custom-selector') as { selected?: string } | null
        if (selector) selector.selected = this.loadedPage
      })
    }
  }

  set addingPage(value: boolean) {
    if (value === this.addingPage) return
    if (value) {
      this.newPageName = ''
      this.newPageType = 'groundplan'
      this.setAttribute('addingPage', '')
    } else {
      this.removeAttribute('addingPage')
      this.newPageName = ''
    }
    this.requestRender()
    if (value) requestAnimationFrame(() => this.pageInput?.focus())
  }

  #shouldUseOneWirePageType(pageName: string): boolean {
    return /\bone[-\s]?wire\b|\beendraads?(?:chema)?\b/i.test(pageName)
  }

  #onPageInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    const pageName = target?.value ?? ''
    this.newPageName = pageName
    if (this.#shouldUseOneWirePageType(pageName)) this.newPageType = 'onewire'
  }

  #defaultPageName(pageType: PageType) {
    const baseName = pageType === 'onewire'
      ? 'One-wire diagram'
      : pageType === 'circuit-schedule'
        ? 'Circuit overview'
        : 'Groundplan'
    const existing = new Set(this.#orderedPages.map(([, page]) => page.name.trim().toLocaleLowerCase()))
    let name = baseName
    for (let suffix = 2; existing.has(name.toLocaleLowerCase()); suffix += 1) {
      name = `${baseName} ${suffix}`
    }
    return name
  }

  async handleInput(): Promise<boolean> {
    if (!this.projectKey) return false
    const typedName = this.newPageName.trim()
    if (this.#shouldUseOneWirePageType(typedName)) this.newPageType = 'onewire'
    const pageName = typedName || this.#defaultPageName(this.newPageType)
    try {
      await addPage(this.projectKey, pageName, { version: '6.0.0', objects: [] }, this.newPageType)
      this.project = await getProjectData(this.projectKey)
      cadleShell.project = this.project
      this.newPageName = ''
      return true
    } catch (error) {
      console.error('Pagina toevoegen mislukt.', error)
      globalThis.alert('De pagina kon niet worden toegevoegd. Probeer opnieuw.')
      return false
    }
  }

  @listen('keydown')
  async onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.addingPage) {
        event.preventDefault()
        this.addingPage = false
      }
      const menu = this.shadowRoot?.querySelector('context-menu') as { open?: boolean } | null
      if (menu) menu.open = false
    } else if (event.key === 'Enter' && this.addingPage) {
      event.preventDefault()
      if (await this.handleInput()) this.addingPage = false
    }
  }

  @listen('contextmenu')
  onShowMenu(event: MouseEvent) {
    const paths = event.composedPath()
    const target = paths[0] as HTMLElement | undefined
    if (target?.localName === 'custom-drawer-item' || target?.localName === 'custom-selector') {
      event.preventDefault()
      const menu = this.shadowRoot?.querySelector('context-menu') as {
        show?: (args: { clientY: number; target: EventTarget }) => void
      } | null
      target.setAttribute('id', 'contextmenu-anchor')
      this.currentSelected = target.dataset.project ?? ''
      menu?.show?.({ clientY: event.clientY, target })
    }
  }

  get addingPage() {
    return this.hasAttribute('addingPage')
  }

  @listen('click', { target: (host: ProjectElement) => host.shadowRoot })
  onShadowClick() {
    const menu = this.shadowRoot?.querySelector('context-menu') as { open?: boolean } | null
    if (menu?.open) menu.open = false
  }

  @listen('selected', { target: 'context-menu' })
  async onContextMenuItemSelected(event: CustomEvent) {
    const detail = event.detail
    const menu = this.shadowRoot?.querySelector('context-menu') as {
      currentTarget?: { dataset?: { project?: string } }
    } | null
    const action = detail.getAttribute('action')
    const projectKey = menu?.currentTarget?.dataset?.project
    if (projectKey && (action === 'remove' || action === 'paste')) {
      const page = this.project?.pages?.[projectKey]
      if (page) {
        if (action === 'paste') {
          this.clipboard = undefined
          await addPage(this.projectKey, `${page.name} copy`, page.schema, page.pageType ?? 'groundplan')
          this.project = await getProjectData(this.projectKey)
          cadleShell.project = this.project
        } else if (action === 'remove') {
          delete this.project!.pages[projectKey]
          setProjectData(this.projectKey, this.project!)
          cadleShell.project = this.project
        }
      }
    } else if (projectKey && (action === 'move-page-up' || action === 'move-page-down')) {
      this.#movePage(projectKey, action === 'move-page-up' ? -1 : 1)
    } else if (action === 'copy') {
      this.clipboard = this.currentSelected
    } else if (action === 'rename-page' && projectKey) {
      cadleShell.openRenamePageDialog(projectKey)
    } else if (action === 'clone-page' && projectKey) {
      cadleShell.openClonePageDialog(projectKey)
    }

    this.requestRender()
  }

  async #movePage(pageKey: string, direction: -1 | 1) {
    const ordered = this.#orderedPages.map(([key, project], index) => ({ key, project, index }))
    const currentIndex = ordered.findIndex((item) => item.key === pageKey)
    if (currentIndex === -1) return
    const targetIndex = currentIndex + direction
    if (targetIndex < 0 || targetIndex >= ordered.length) return

    const current = ordered[currentIndex]
    const target = ordered[targetIndex]
    const currentOrder = typeof current.project.order === 'number' ? current.project.order : currentIndex
    const targetOrder = typeof target.project.order === 'number' ? target.project.order : targetIndex

    current.project.order = targetOrder
    target.project.order = currentOrder

    ordered.sort((a, b) => {
      const orderA = typeof a.project.order === 'number' ? a.project.order : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.project.order === 'number' ? b.project.order : Number.MAX_SAFE_INTEGER
      return orderA - orderB || a.project.creationTime - b.project.creationTime
    })

    ordered.forEach((entry, index) => {
      this.project!.pages[entry.key].order = index
    })

    await setProjectData(this.projectKey, this.project!)
    this.project = await getProjectData(this.projectKey)
    cadleShell.project = this.project
    this.requestRender()
  }

  static styles = [styles]

  get #orderedPages() {
    return Object.entries(this.project?.pages ?? {}).sort(([, a], [, b]) => {
      const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER
      return orderA - orderB || a.creationTime - b.creationTime
    })
  }

  get #projectTemplate() {
    return this.#orderedPages.map(
      ([key, project]) => html`
        <custom-drawer-item
          .headline=${project.name}
          data-project=${key}
          @click=${async () => {
            await cadleShell.savePage()
            cadleShell.loadPage(key)
          }}
          >${project.name}</custom-drawer-item
        >
      `
    )
  }

  render() {
    const projectTemplate = this.#projectTemplate
    return html`
      <custom-selector
        .selected=${this.loadedPage}
        attr-for-selected="data-project">
        ${projectTemplate}
      </custom-selector>
      <section class="page-add-area">
        ${this.addingPage ? html`
          <div class="page-add-form">
            <header class="page-add-heading">
              <span class="add-mark" aria-hidden="true">+</span>
              <div>
                <strong>Nieuwe pagina</strong>
                <small>Een naam wordt automatisch gekozen als je dit veld leeg laat.</small>
              </div>
            </header>
            <label class="page-field">
              <span>Naam</span>
              <input
                class="page-input"
                aria-label="Paginanaam"
                autocomplete="off"
                placeholder="Bijv. Verdieping"
                .value=${this.newPageName}
                @input=${this.#onPageInput} />
            </label>
            <label class="page-field">
              <span>Type</span>
              <select
                class="page-type-select"
                aria-label="Paginatype"
                .value=${this.newPageType}
                @change=${(event: Event) => {
                  const target = event.currentTarget as HTMLSelectElement | null
                  this.newPageType = target?.value === 'onewire'
                    ? 'onewire'
                    : target?.value === 'circuit-schedule'
                      ? 'circuit-schedule'
                      : 'groundplan'
                }}>
                <option value="groundplan">Grondplan</option>
                <option value="onewire">Eendraadschema</option>
                <option value="circuit-schedule">Kringentabel</option>
              </select>
            </label>
            <div class="page-add-actions">
              <button type="button" class="cancel-page" @click=${() => (this.addingPage = false)}>Annuleren</button>
              <button type="button" class="confirm-page" @click=${async () => {
                if (await this.handleInput()) this.addingPage = false
              }}>Pagina toevoegen</button>
            </div>
          </div>
        ` : html`
          <button
            type="button"
            class="add-page"
            aria-label="Nieuwe pagina"
            @click=${() => (this.addingPage = true)}>
            <span class="add-mark" aria-hidden="true">+</span>
            <span>Pagina toevoegen</span>
          </button>
        `}
      </section>
      <context-menu>
        <custom-list-item
          type="menu"
          action="copy">
          <custom-icon
            slot="start"
            icon="content_copy"></custom-icon>
          <p>copy</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          ?disabled=${!this.clipboard}
          action="paste">
          <custom-icon
            slot="start"
            icon="content_paste"></custom-icon>
          <p>paste</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="move-page-up">
          <custom-icon
            slot="start"
            icon="arrow_upward"></custom-icon>
          <p>move up</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="move-page-down">
          <custom-icon
            slot="start"
            icon="arrow_downward"></custom-icon>
          <p>move down</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="rename-page">
          <custom-icon
            slot="start"
            icon="edit"></custom-icon>
          <p>rename</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="clone-page">
          <custom-icon
            slot="start"
            icon="content_copy"></custom-icon>
          <p>clone page</p>
        </custom-list-item>
        <custom-list-item
          type="menu"
          action="remove">
          <custom-icon
            slot="start"
            icon="delete"></custom-icon>
          <p>delete</p>
        </custom-list-item>
      </context-menu>
    `
  }
}
