import { LitElement, html, css } from 'lit'
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit-labs/context'
import { Project, projectContext } from '../../context/project-context.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/iconbutton/filled-icon-button.js'
import '@vandeurenglenn/lit-elements/drawer-item.js'
import '@vandeurenglenn/lit-elements/selector.js'
import '@vandeurenglenn/lit-elements/button.js'
import '@vandeurenglenn/lit-elements/dropdown.js'
import '@vandeurenglenn/lit-elements/list-item.js'
import './../list/item.js'
import './contextmenu.js'

declare global {
  interface HTMLElementTagNameMap {
    'project-element': ProjectElement
  }
}

@customElement('project-element')
export class ProjectElement extends LitElement {
  @consume({ context: projectContext, subscribe: true })
  @property({ attribute: false })
  @state()
  project: Project

  @property()
  clipboard

  @query('.page-input')
  pageInput: HTMLInputElement

  set addingPage(value: boolean) {
    if (value !== this.addingPage)
      if (value) {
        this.pageInput.value = ''
        this.setAttribute('addingPage', '')
        this.pageInput.focus()
        this.addEventListener('keydown', this.#keydown.bind(this))
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
      project.pages.push({ name: page, schema: {}, creationTime: new Date().getTime() })
      cadleShell.project = project
      await cadleShell.save.bind(cadleShell)()
      this.#cleanupListeners()
      this.pageInput.value = ''
    }
  }

  async #keydown(event) {
    if (event.key === 'Escape') {
      this.addingPage = false
      this.renderRoot.querySelector('.add-page').selected = false
    } else if (event.key === 'Enter') {
      await this.handleInput()
      this.addingPage = false
      this.renderRoot.querySelector('.add-page').selected = false
    }
  }

  #cleanupListeners() {
    this.removeEventListener('keydown', this.#keydown)
  }

  #showMenu = event => {
    console.log(event.composedPath())
    console.log(event)

    const paths = event.composedPath()
    if (paths[0].localName === 'custom-drawer-item' || paths[0].localName === 'custom-selector') {
      event.preventDefault()
      const menu = this.renderRoot.querySelector('context-menu')
      paths[0].setAttribute('id', 'contextmenu-anchor')
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

  #contextMenuItemSelected({ detail }) {
    const menu = this.renderRoot.querySelector('context-menu')
    const action = detail.getAttribute('action')
    console.log({ action })

    if (action === 'copy') {
      this.clipboard = menu.currentTarget
    }

    console.log({ clipboard: this.clipboard })

    if (action === 'paste' || action === 'remove') {
      let i = 0
      for (const page of this.project.pages) {
        console.log(page.name === this.clipboard ? this.clipboard.dataset.project : menu.currentTarget.dataset.project)

        if (page.name === this.clipboard?.dataset.project || page.name == menu.currentTarget.dataset.project) {
          if (action === 'paste') {
            this.clipboard = undefined
            cadleShell.project.pages.push({ ...page, name: `${page.name} copy` })
          } else {
            cadleShell.project.pages.splice(i, 1)
          }
        }
        i += 1
      }
      this.requestUpdate()
    }
  }
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
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
    `
  ]

  get #projectTemplate() {
    return this.project.pages.map(
      item => html`
        <custom-drawer-item
          .headline=${item.name}
          data-project=${item.name}
          @click=${async event => {
            
            await cadleShell.savePage()
            cadleShell.loadPage(item.name)
            location.hash = '#!/draw'
          }}
          >${item.name}</custom-drawer-item
        >
      `
    )
  }

  render() {
    return html`
      <custom-selector> ${this.project?.pages?.length > 0 ? this.#projectTemplate : ''} </custom-selector>

      <flex-row
        class="input-container"
        slot="footer">
        <input class="page-input" />
        <flex-it></flex-it>
        <custom-icon-button
          class="add-page"
          icon="${this.addingPage ? 'done' : 'add'}"
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
