import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js'

import { consume } from '@lit/context'
import { Projects, projectsContext } from '../context/projects.js'
import '@material/web/elevation/elevation.js'
import '@material/web/button/outlined-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon-button.js'

import '@vandeurenglenn/flex-elements/container.js'
import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { del, getProjects, upload } from '../api/project.js'
import { get } from 'http'

@customElement('projects-field')
export class ProjectsField extends LitElement {
  @consume({ context: projectsContext, subscribe: true })
  @property({ attribute: false })
  projects: Projects

  @query('.contextmenu')
  contextmenu: CustomDropdown

  _currentSelected

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        align-items: center;
        justify-content: center;
      }

      .contextmenu {
        transform-origin: top right;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface);
        color: var(--md-sys-color-on-surface);
        border: 1px solid var(--md-sys-color-outline);
        width: 260px;
        left: none;
      }

      .contextmenu custom-list-item {
        width: 260px;
      }

      custom-list-item {
        width: 100%;
        max-width: none;
        cursor: pointer;
        overflow: hidden;
        padding: 8px 8px 8px 16px;
      }

      custom-icon-button {
        pointer-events: auto;
      }

      summary {
        border-radius: var(--md-sys-shape-corner-large);
        border: 1px solid var(--md-sys-color-outline);
        padding: 12px 24px;
        box-sizing: border-box;
      }

      flex-container {
        align-items: center;
        gap: 4px;
      }

      flex-container custom-list-item {
        background: var(--md-sys-color-surface-variant);
        color: var(--md-sys-color-on-surface-variant);
        border-radius: var(--md-sys-shape-corner-extra-large);
      }

      flex-row {
        width: 100%;
        margin-top: 24px;
      }

      custom-list-item:hover {
        background: var(--md-sys-color-secondary-container-hover);
        color: var(--md-sys-color-on-secondary-container);
      }
    `
  ]

  connectedCallback(): void {
    super.connectedCallback()
    this.shadowRoot?.addEventListener('click', this._click.bind(this))
  }

  _loadProject(key, projectName) {
    cadleShell.loadProject(key, projectName)
  }

  _click(event: Event) {
    console.log(event.target)

    const action = event.target.getAttribute('data-action')

    if (this[`_${action}`]) {
      const dropdown = this.shadowRoot?.querySelector('custom-dropdown')
      if (this._transitionEnd) dropdown?.removeEventListener('transitionend', this._transitionEnd)
      const id = event.target.getAttribute('data-id')
      const name = event.target.getAttribute('data-name')
      console.log({ id })

      if (action === 'showContextMenu') {
        if (this._currentSelected !== undefined && id !== this._currentSelected) {
          // close open menu & reopen on new location
          this._transitionEnd = () => {
            this[`_${action}`](id)
            this._currentSelected = id
            dropdown?.removeEventListener('transitionend', this._transitionEnd)
          }
          dropdown.addEventListener('transitionend', this._transitionEnd)
          this[`_${action}`](this._currentSelected)
        } else {
          this[`_${action}`](id)
          if (!this.contextmenu.open) this._currentSelected = undefined
          else this._currentSelected = id
        }
      } else {
        this[`_${action}`](this._currentSelected ?? id, name)
      }
    }
  }

  async _delete(id) {
    await del(id)
    const projects = []

    for (const [key, value] of await getProjects()) {
      projects.push([key, value])
    }
    const dropdown = this.shadowRoot?.querySelector('custom-dropdown')

    cadleShell.projects = projects
    dropdown.shown = false
  }

  __showContextMenu(projectName) {
    const target = this.shadowRoot.querySelector(`[data-id="${projectName}"]`)
    const { top, height, left, width, right } = target.getBoundingClientRect()
    this.contextmenu.style.top = `${top - height / 2}px`
    this.contextmenu.style.left = `${right - width}px`
  }

  _showContextMenu(projectName) {
    this.contextmenu.open = !this.contextmenu.open
    if (this.contextmenu.open) this.__showContextMenu(projectName)
  }

  get #projectsTemplate() {
    return html`${this.projects.map(
        ([key, name]) => html` <custom-list-item
          data-id=${key}
          data-name=${name}
          data-action="loadProject">
          <span>${name}</span>
          <custom-icon-button
            icon="more_vert"
            data-id=${key}
            data-action="showContextMenu"
            slot="end"></custom-icon-button>
        </custom-list-item>`
      )}
      <flex-row>
        <md-outlined-button @click=${() => upload()}>upload</md-outlined-button>
        <flex-it></flex-it>
        <md-filled-button @click=${() => (location.hash = '#!/create-project')}>create</md-filled-button>
      </flex-row> `
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
        ${this.projects?.length > 0
          ? this.#projectsTemplate
          : html` <summary>
              <h3>Welcome to Cadle</h3>
              <h4>Seems this is your first time here</h4>
              <h5>Next time I wont be greeting you like this<br />Go and create or upload (or else...)</h5>
              <h5>Kind regards, HAL 9000</h5>
              <h6>small note: This project is not finished at all!</h6>
              <flex-row>
                <md-outlined-button @click=${upload}>upload</md-outlined-button>
                <flex-it></flex-it>
                <md-filled-button @click=${() => (location.hash = '#!/create-project')}>create</md-filled-button>
              </flex-row>
            </summary>`}
      </flex-container>
    `
  }
}
