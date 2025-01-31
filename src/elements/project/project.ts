import { LitElement, html, css, PropertyValues } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit/context'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/iconbutton/filled-icon-button.js'
import '@vandeurenglenn/lite-elements/drawer-item.js'
import '@vandeurenglenn/lite-elements/selector.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import './../list/item.js'
import '../../contextmenu.js'
import { Project } from '../../types.js'
import { addPage, getProjectData, setProjectData } from '../../api/project.js'

declare global {
  interface HTMLElementTagNameMap {
    'project-element': ProjectElement
  }
}

@customElement('project-element')
export class ProjectElement extends LitElement {
  @consume({ context: 'projectContext', subscribe: true })
  @property({ attribute: false })
  @state()
  project: Project

  currentSelected: string

  @property()
  clipboard

  @query('.page-input')
  pageInput: HTMLInputElement

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.addEventListener('keydown', this.#keydown.bind(this))
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
    this.requestUpdate('addingPage')
  }

  async handleInput() {
    const page: string = this.pageInput.value
    if (page.length > 0) {
      const project = cadleShell.project
      addPage(cadleShell.projectKey, page, {})
      cadleShell.project = await getProjectData(cadleShell.projectKey)
      this.project = cadleShell.project
      this.pageInput.value = ''
    }
  }

  async #keydown(event) {
    console.log(event)

    if (event.key === 'Escape') {
      this.addingPage = false
      this.shadowRoot.querySelector('context-menu').open = false
      this.renderRoot.querySelector('.add-page').selected = false
    } else if (event.key === 'Enter') {
      await this.handleInput()
      this.addingPage = false
      this.renderRoot.querySelector('.add-page').selected = false
    }
  }

  #showMenu = (event) => {
    console.log(event.composedPath())
    console.log(event)

    const paths = event.composedPath()
    if (paths[0].localName === 'custom-drawer-item' || paths[0].localName === 'custom-selector') {
      event.preventDefault()
      const menu = this.renderRoot.querySelector('context-menu')
      paths[0].setAttribute('id', 'contextmenu-anchor')
      console.log(paths[0])
      console.log(paths)
      console.log(paths[0].dataset.project)
      this.currentSelected = paths[0].dataset.project
      menu.show({ clientY: event.clientY, target: paths[0] })
    }
  }

  get addingPage() {
    return this.hasAttribute('addingPage')
  }

  #onclick() {
    const menu = this.renderRoot.querySelector('context-menu')
    if (menu.open) menu.open = false
  }

  async connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('contextmenu', this.#showMenu)
    this.shadowRoot.addEventListener('click', this.#onclick.bind(this))
    await this.updateComplete

    const menu = this.renderRoot.querySelector('context-menu')
    menu.addEventListener('selected', this.#contextMenuItemSelected.bind(this))
  }

  #contextMenuItemSelected(event) {
    const detail = event.detail
    const menu = this.renderRoot.querySelector('context-menu')
    const action = detail.getAttribute('action')
    console.log({ action })
    console.log(event)

    this.clipboard = this.currentSelected
    if (action === 'remove' || action === 'paste') {
      const page = this.project.pages[this.clipboard]
      if (action === 'paste') {
        this.clipboard = undefined
        addPage(cadleShell.projectKey, `${page.name} copy`, page.schema)
      } else if (action === 'remove') {
        delete this.project.pages[this.clipboard]
        setProjectData(cadleShell.projectKey, this.project)
      }
    }

    console.log({ clipboard: this.clipboard })

    this.requestUpdate()
  }
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .page-input {
        pointer-events: none;
        opacity: 0;
        padding: 3px;
        outline: 1px solid #eee;
        border: none;
        background: var(--md-sys-color-surface, #fef7ff);
      }

      :host([addingPage]) .page-input {
        pointer-events: auto;
        opacity: 1;
      }

      .add-container {
        box-sizing: border-box;
        padding: 12px 24px;
        align-items: center;
        bottom: 12px;
        right: 12px;
        width: 240px;
      }

      .input-container {
        box-sizing: border-box;
        padding: 12px 24px;
        align-items: center;
      }

      custom-selector {
        height: 100%;
      }
    `
  ]

  get #projectTemplate() {
    return Object.entries(this.project.pages).map(
      ([key, project]) => html`
        <custom-drawer-item
          .headline=${project.name}
          data-project=${key}
          @click=${async (event) => {
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

      <flex-row
        class="input-container"
        slot="footer">
        <input class="page-input" />
        <flex-it></flex-it>
        <custom-icon-button
          class="add-page"
          icon="${this.addingPage ? 'check' : 'add'}"
          @click=${() => (this.addingPage = !this.addingPage)}></custom-icon-button>
      </flex-row>

      <context-menu>
        <custom-list-item
          type="menu"
          action="copy">
          <custom-icon-font slot="start">copy</custom-icon-font>
          copy
        </custom-list-item>

        <custom-list-item
          type="menu"
          ?disabled=${!this.clipboard}
          action="paste">
          <custom-icon-font slot="start">paste</custom-icon-font>
          paste
        </custom-list-item>

        <custom-list-item
          type="menu"
          action="remove">
          <custom-icon-font slot="start">delete</custom-icon-font>
          delete
        </custom-list-item>
      </context-menu>
    `
  }
}
