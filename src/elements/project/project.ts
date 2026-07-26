import { LiteElement, html, customElement, property, query, listen } from '@vandeurenglenn/lite'
import styles from './project.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/selector.js'
import '@vandeurenglenn/lite-elements/drawer-item.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '../../contextmenu.js'
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

  @query('.page-type-select')
  accessor pageTypeSelect!: HTMLSelectElement

  @property({ type: String })
  accessor newPageType: PageType = 'groundplan'

  onChange(name: string): void {
    if (name === 'loadedPage') {
      queueMicrotask(() => {
        const selector = this.shadowRoot?.querySelector('custom-selector') as { selected?: string } | null
        if (selector) selector.selected = this.loadedPage
      })
    }
  }

  set addingPage(value: boolean) {
    if (value !== this.addingPage)
      if (value) {
        this.pageInput.value = ''
        this.newPageType = 'groundplan'
        if (this.pageTypeSelect) this.pageTypeSelect.value = this.newPageType
        this.setAttribute('addingPage', '')
        this.pageInput.focus()
      } else {
        this.removeAttribute('addingPage')
        this.handleInput()
      }

    this.requestRender()
  }

  #shouldUseOneWirePageType(pageName: string): boolean {
    return /\bone[-\s]?wire\b|\beendraads\b/i.test(pageName)
  }

  #onPageInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    const pageName = target?.value ?? ''
    if (!this.#shouldUseOneWirePageType(pageName)) return

    this.newPageType = 'onewire'
    if (this.pageTypeSelect) this.pageTypeSelect.value = 'onewire'
  }

  async handleInput() {
    const page: string = this.pageInput.value
    if (page.length > 0 && this.projectKey) {
      if (this.#shouldUseOneWirePageType(page)) {
        this.newPageType = 'onewire'
        if (this.pageTypeSelect) this.pageTypeSelect.value = 'onewire'
      }
      const pageType = (this.pageTypeSelect?.value as PageType) || this.newPageType || 'groundplan'
      await addPage(this.projectKey, page, { version: '6.0.0', objects: [] }, pageType)
      this.project = await getProjectData(this.projectKey)
      cadleShell.project = this.project
      this.pageInput.value = ''
    }
  }

  @listen('keydown')
  async onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.addingPage = false
      const menu = this.shadowRoot?.querySelector('context-menu') as { open?: boolean } | null
      const addPageButton = this.shadowRoot?.querySelector('.add-page') as { selected?: boolean } | null
      if (menu) menu.open = false
      if (addPageButton) addPageButton.selected = false
    } else if (event.key === 'Enter') {
      await this.handleInput()
      this.addingPage = false
      const addPageButton = this.shadowRoot?.querySelector('.add-page') as { selected?: boolean } | null
      if (addPageButton) addPageButton.selected = false
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
      <flex-row class="input-container">
        <input
          class="page-input"
          @input=${this.#onPageInput} />
        <select
          class="page-type-select"
          .value=${this.newPageType}
          @change=${(event: Event) => {
            const target = event.currentTarget as HTMLSelectElement | null
            const value = target?.value === 'onewire' ? 'onewire' : 'groundplan'
            this.newPageType = value
          }}>
          <option value="groundplan">Groundplan</option>
          <option value="onewire">One-wire</option>
        </select>
        <custom-icon-button
          class="add-page"
          .icon="${this.addingPage ? 'check' : 'add'}"
          @click=${() => (this.addingPage = !this.addingPage)}></custom-icon-button>
      </flex-row>
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
