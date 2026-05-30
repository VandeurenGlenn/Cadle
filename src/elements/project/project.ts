import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './project.css' with { type: 'css' }
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/iconbutton/filled-icon-button.js'
import '@vandeurenglenn/lite-elements/drawer-item.js'
import '@vandeurenglenn/lite-elements/selector.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../list/item.js'
import '../../contextmenu.js'
import { Project, UUID } from '../../types.js'
import { addPage, getProjectData, setProjectData } from '../../api/project.js'
import { map } from '@vandeurenglenn/lite/map.js'
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

  currentSelected = ''
  @property({ attribute: false })
  accessor clipboard: unknown = undefined

  @query('.page-input')
  accessor pageInput!: HTMLInputElement

  firstRender(): void {
    this.addEventListener('keydown', this.#keydown.bind(this))
    this.addEventListener('contextmenu', this.#showMenu)
    this.shadowRoot?.addEventListener('click', this.#onclick.bind(this))

    const menu = this.shadowRoot?.querySelector('context-menu')
    menu?.addEventListener('selected', this.#contextMenuItemSelected.bind(this) as EventListener)
  }

  set addingPage(value: boolean) {
    if (value !== this.addingPage)
      if (value) {
        this.pageInput.value = ''
        this.setAttribute('addingPage', '')
        this.pageInput.focus()
      } else {
        this.removeAttribute('addingPage')
        this.handleInput()
      }

    this.requestRender()
  }

  async handleInput() {
    const page: string = this.pageInput.value
    if (page.length > 0 && this.projectKey) {
      addPage(this.projectKey, page, {})
      this.project = await getProjectData(this.projectKey)
      this.pageInput.value = ''
    }
  }

  async #keydown(event: KeyboardEvent) {
    console.log(event)
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
    console.log(event.composedPath())
    console.log(event)
    const paths = event.composedPath()
    const target = paths[0] as HTMLElement | undefined
    if (target?.localName === 'custom-drawer-item' || target?.localName === 'custom-selector') {
      event.preventDefault()
      const menu = this.shadowRoot?.querySelector('context-menu') as {
        show?: (args: { clientY: number; target: EventTarget }) => void
      } | null
      target.setAttribute('id', 'contextmenu-anchor')
      console.log(target)
      console.log(paths)
      console.log(target.dataset.project)
      this.currentSelected = target.dataset.project ?? ''
      console.log({ currentSelected: this.currentSelected })
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

  #contextMenuItemSelected(event: CustomEvent) {
    const detail = event.detail
    const menu = this.shadowRoot?.querySelector('context-menu') as {
      currentTarget?: { dataset?: { project?: string } }
    } | null
    const action = detail.getAttribute('action')
    const projectKey = menu?.currentTarget?.dataset?.project
    if (projectKey && (action === 'remove' || action === 'paste')) {
      const page = this.project?.pages?.[projectKey]
      console.log({ page })
      if (page) {
        if (action === 'paste') {
          this.clipboard = undefined
          addPage(this.projectKey, `${page.name} copy`, page.schema)
        } else if (action === 'remove') {
          delete this.project!.pages[projectKey]
          setProjectData(this.projectKey, this.project!)
        }
      }
    } else if (action === 'copy') {
      this.clipboard = this.currentSelected
    } else if (action === 'clone-page' && projectKey) {
      cadleShell.openClonePageDialog(projectKey)
    }

    console.log({ clipboard: this.clipboard })
    this.requestRender()
  }

  static styles = [styles]

  get #projectTemplate() {
    return Object.entries(this.project?.pages ?? {}).map(
      ([key, project]) => html`
        <custom-drawer-item
          .headline=${project.name}
          data-project=${key}
          @click=${async (_event: Event) => {
            await cadleShell.savePage()
            cadleShell.loadPage(key)
            location.hash = '#!/draw'
          }}
          >${project.name}</custom-drawer-item
        >
      `
    )
  }

  render() {
    return html`
      <custom-selector> ${this.project?.pages ? this.#projectTemplate : ''} </custom-selector>
      <flex-row class="input-container">
        <input class="page-input" />
        <custom-icon-button
          class="add-page"
          icon="${this.addingPage ? 'check' : 'add'}"
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
