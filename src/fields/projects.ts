import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './projects.css' with { type: 'css' }
import { Projects, type UUID } from './../types.js'
import '@material/web/elevation/elevation.js'
import '@material/web/button/outlined-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/container.js'
import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { del, getProjects, upload } from '../api/project.js'
@customElement('projects-field')
export class ProjectsField extends LiteElement {
  @property({ attribute: false })
  accessor projects: Projects = []

  @query('.contextmenu')
  accessor contextmenu!: CustomDropdown

  _currentSelected
  _transitionEnd?: () => void
  static styles = [styles]

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    this.projects = await getProjects()
    this.shadowRoot?.addEventListener('click', this._click.bind(this))
  }

  _loadProject(key: string, projectName: string) {
    cadleShell.loadProject(key as unknown as UUID, projectName)
  }

  _click(event: Event) {
    const target = event.target as HTMLElement | null
    if (!target) return

    const action = target.getAttribute('data-action')
    const id = target.getAttribute('data-id')
    const name = target.getAttribute('data-name')
    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null

    if (action === 'showContextMenu') {
      if (!id) return
      if (this._transitionEnd) dropdown?.removeEventListener('transitionend', this._transitionEnd)
      if (this._currentSelected !== undefined && id !== this._currentSelected) {
        this._transitionEnd = () => {
          this._showContextMenu(id)
          this._currentSelected = id
          dropdown?.removeEventListener('transitionend', this._transitionEnd)
        }

        dropdown?.addEventListener('transitionend', this._transitionEnd)
        if (this._currentSelected) this._showContextMenu(this._currentSelected)
      } else {
        this._showContextMenu(id)
        if (!this.contextmenu.open) this._currentSelected = undefined
        else this._currentSelected = id
      }
      return
    }

    if (action === 'loadProject') {
      if (!id || !name) return
      this._loadProject(id, name)
      return
    }

    if (action === 'delete') {
      if (!id) return
      void this._delete(id)
      return
    }
  }

  async _delete(id: string) {
    await del(id)
    const projects: Projects = []
    for (const [key, value] of await getProjects()) {
      projects.push([key, value])
    }

    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null
    cadleShell.projects = projects
    if (dropdown) (dropdown as CustomDropdown & { shown?: boolean }).shown = false
  }

  __showContextMenu(projectName: string) {
    const target = this.shadowRoot.querySelector(`[data-id="${projectName}"]`) as HTMLElement | null
    if (!target) return
    const { top, height, width, right } = target.getBoundingClientRect()
    this.contextmenu.style.top = `${top - height / 2}px`
    this.contextmenu.style.left = `${right - width}px`
  }

  _showContextMenu(projectName) {
    this.contextmenu.open = !this.contextmenu.open
    if (this.contextmenu.open) this.__showContextMenu(projectName)
  }

  get #projectsTemplate() {
    return html`<div class="list">
      ${this.projects.map(
        ([key, name]) =>
          html` <custom-list-item
            type="one-line"
            data-id=${key}
            data-name=${name}
            data-action="loadProject"
            tabindex="0">
            <span>${name}</span>
            <custom-icon-button
              icon="more_vert"
              data-id=${key}
              data-action="showContextMenu"
              slot="end"></custom-icon-button>
          </custom-list-item>`
      )}
    </div> `
  }

  render() {
    return html`
      <custom-dropdown class="contextmenu">
        <custom-list-item data-action="rename">
          <span>rename</span>
          <custom-icon
            icon="abc"
            slot="end"></custom-icon>
        </custom-list-item>
        <custom-list-item data-action="delete">
          <span>delete</span>
          <custom-icon
            icon="delete"
            slot="end"></custom-icon>
        </custom-list-item>
      </custom-dropdown>
      <flex-container>
        <header class="header">
          <h1>Projects</h1>
          <p>Pick up where you left off, or start something new.</p>
        </header>
        <div class="actions-row">
          <md-outlined-button @click=${() => upload()}>Upload</md-outlined-button>
          <flex-it></flex-it>
          <md-filled-button @click=${() => (location.hash = '#!/create-project')}>Create</md-filled-button>
        </div>
        ${this.projects?.length > 0
          ? this.#projectsTemplate
          : html` <section class="empty-state">
              <h3>Welcome to Cadle</h3>
              <h4>Start by creating a project or uploading an existing one.</h4>
              <p>
                Projects save your pages, symbols, and one-line mappings so you can continue exactly where you left off.
              </p>
            </section>`}
      </flex-container>
    `
  }
}
