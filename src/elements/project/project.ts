import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './project.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/selector.js'
import '@vandeurenglenn/lite-elements/drawer-item.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../list/item.js'
import '../../contextmenu.js'
import { Project, type PageType, UUID } from '../../types.js'
import { addPage, getProjectData, getProjects, set, setProjectData } from '../../api/project.js'
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

  @property({ type: String })
  accessor projectName = ''

  @property({ type: String })
  accessor customer = ''

  @property({ type: String })
  accessor installer = ''

  @property({ type: String })
  accessor company = ''

  @property({ type: String })
  accessor street = ''

  @property({ type: String })
  accessor houseNumber = ''

  @property({ type: String })
  accessor postalCode = ''

  @property({ type: String })
  accessor city = ''

  @property({ type: String })
  accessor logoUrl = ''

  @property({ type: String })
  accessor logoColor = ''

  @property({ type: Number })
  accessor logoScale = 1

  @query('.page-input')
  accessor pageInput!: HTMLInputElement

  @query('.page-type-select')
  accessor pageTypeSelect!: HTMLSelectElement

  @property({ type: String })
  accessor newPageType: PageType = 'groundplan'

  firstRender(): void {
    this.addEventListener('keydown', this.#keydown.bind(this))
    this.addEventListener('contextmenu', this.#showMenu)
    this.shadowRoot?.addEventListener('click', this.#onclick.bind(this))

    const menu = this.shadowRoot?.querySelector('context-menu')
    menu?.addEventListener('selected', this.#contextMenuItemSelected.bind(this) as EventListener)
    this.#syncFormFromProject()
  }

  onChange(name: string): void {
    if (name === 'project') {
      this.#syncFormFromProject()
    }
    if (name === 'loadedPage') {
      queueMicrotask(() => {
        const selector = this.shadowRoot?.querySelector('custom-selector') as { selected?: string } | null
        if (selector) selector.selected = this.loadedPage
      })
    }
  }

  #syncFormFromProject() {
    this.projectName = this.project?.name ?? ''
    this.logoUrl = this.project?.logoUrl?.trim() ?? ''
    this.logoColor = this.project?.logoColor?.trim() ?? ''
    this.logoScale =
      typeof this.project?.logoScale === 'number' && Number.isFinite(this.project.logoScale)
        ? Math.max(0.4, Math.min(2.5, this.project.logoScale))
        : 1
    this.customer = [this.project?.customer?.name ?? '', this.project?.customer?.lastname ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
    this.installer = [this.project?.installer?.name ?? '', this.project?.installer?.lastname ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
    this.company = this.project?.company ?? ''
    this.street = this.project?.address?.street ?? ''
    this.houseNumber = this.project?.address?.number ?? ''
    this.postalCode = this.project?.address?.postalCode ?? ''
    this.city = this.project?.address?.city ?? ''
  }

  #onMetaInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    const field = target?.dataset.field ?? ''
    const value = target?.value ?? ''
    switch (field) {
      case 'projectName':
        this.projectName = value
        break
      case 'customer':
        this.customer = value
        break
      case 'installer':
        this.installer = value
        break
      case 'company':
        this.company = value
        break
      case 'street':
        this.street = value
        break
      case 'houseNumber':
        this.houseNumber = value
        break
      case 'postalCode':
        this.postalCode = value
        break
      case 'city':
        this.city = value
        break
      case 'logoUrl':
        this.logoUrl = value
        this.#syncLogoPreview()
        break
      case 'logoColor':
        this.logoColor = value
        this.#syncLogoPreview()
        break
      case 'logoScale':
        this.logoScale = Math.max(0.4, Math.min(2.5, Number(value) || 1))
        this.#syncLogoPreview()
        break
      default:
        break
    }
  }

  #logoPickerValue() {
    const value = this.logoColor.trim()
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#2d231c'
  }

  #onLogoFilePicked = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) return

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Unable to read logo file'))
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') resolve(result)
        else reject(new Error('Unsupported logo file payload'))
      }
      reader.readAsDataURL(file)
    })

    this.logoUrl = dataUrl
    this.#syncLogoPreview()
    if (input) input.value = ''
  }

  #clearLogo = () => {
    this.logoUrl = ''
    this.#syncLogoPreview()
  }

  #onLogoColorPick = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    this.logoColor = target?.value?.trim() ?? ''
    this.#syncLogoPreview()
  }

  #syncLogoPreview = () => {
    if (!this.project) return
    const nextProject = structuredClone(this.project)
    const logo = this.logoUrl.trim()
    const logoColor = this.logoColor.trim()
    nextProject.logoUrl = logo.length > 0 ? logo : undefined
    nextProject.logoColor = logoColor.length > 0 ? logoColor : undefined
    nextProject.logoScale = Math.max(0.4, Math.min(2.5, this.logoScale))
    this.project = nextProject
    cadleShell.project = nextProject
  }

  #saveProjectDetails = async () => {
    if (!this.project || !this.projectKey) return
    const splitPersonName = (value: string): { first: string; last: string } => {
      const parts = value.trim().split(/\s+/).filter(Boolean)
      if (parts.length === 0) return { first: '', last: '' }
      if (parts.length === 1) return { first: parts[0], last: '' }
      return {
        first: parts.slice(0, -1).join(' '),
        last: parts[parts.length - 1]
      }
    }

    const customerParts = this.customer.trim().split(/\s+/).filter(Boolean)
    const customerName = customerParts.length > 0 ? customerParts.slice(0, -1).join(' ') || customerParts[0] : ''
    const customerLastName = customerParts.length > 1 ? customerParts[customerParts.length - 1] : ''
    const installer = splitPersonName(this.installer)

    if (!this.project.customer) {
      this.project.customer = { name: '', lastname: '' }
    }
    if (!this.project.installer) {
      this.project.installer = { name: '', lastname: '' }
    }
    if (!this.project.address) {
      this.project.address = { street: '', number: '', postalCode: '', city: '' }
    }

    this.project.name = this.projectName.trim()
    const logo = this.logoUrl.trim()
    const logoColor = this.logoColor.trim()
    this.project.logoUrl = logo.length > 0 ? logo : undefined
    this.project.logoColor = logoColor.length > 0 ? logoColor : undefined
    this.project.logoScale = Math.max(0.4, Math.min(2.5, this.logoScale))
    this.project.customer.name = customerName
    this.project.customer.lastname = customerLastName
    this.project.installer.name = installer.first
    this.project.installer.lastname = installer.last
    this.project.company = this.company.trim()
    this.project.address.street = this.street.trim()
    this.project.address.number = this.houseNumber.trim()
    this.project.address.postalCode = this.postalCode.trim()
    this.project.address.city = this.city.trim()

    await setProjectData(this.projectKey, this.project)
    await set(this.projectKey, this.project.name)

    this.project = await getProjectData(this.projectKey)
    cadleShell.project = this.project
    cadleShell.projectName = this.project.name
    cadleShell.projects = await getProjects()
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

  async #keydown(event: KeyboardEvent) {
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

  #showMenu = (event: MouseEvent) => {
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

  #onclick() {
    const menu = this.shadowRoot?.querySelector('context-menu') as { open?: boolean } | null
    if (menu?.open) menu.open = false
  }

  async #contextMenuItemSelected(event: CustomEvent) {
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
