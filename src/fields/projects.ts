import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js'

import { consume } from '@lit-labs/context'
import { Projects, projectsContext } from '../context/projects.js'
import '@material/web/elevation/elevation.js'
import '@material/web/list/list-item.js'
import '@material/web/button/outlined-button.js'
import '@vandeurenglenn/lit-elements/dropdown.js'

import '@vandeurenglenn/flex-elements/container.js'
import { CustomDropdown } from '@vandeurenglenn/lit-elements/dropdown.js'

@customElement('projects-field')
export class ProjectsField extends LitElement {
  @consume({ context: projectsContext, subscribe: true })
  @property({ attribute: false })
  projects: Projects

  @query('.contextmenu')
  contextmenu: CustomDropdown

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
        background: var(--md-sys-color-surface-variant);
        border: 1px solid var(--md-sys-color-outline);
        width: 260px;
        left: none;
      }

      .contextmenu md-list-item {
        width: 260px;
      }

      md-list-item {
        width: 100%;
        cursor: pointer;
      }

      flex-container {
        gap: 4px;
      }

      flex-container md-list-item {
        background: var(--md-sys-color-surface-variant);
        color: var(--md-sys-color-on-surface-variant);
        border-radius: var(--md-sys-shape-corner-extra-large);
      }
    `
  ]

  _delete(event) {
    event.stopImmediatePropagation()
    event.stopPropagation()
    console.log(event)
  }

  __showContextMenu(projectName) {
    const target = this.shadowRoot.querySelector(`[data-project="${projectName}"]`)
    const { top, height, left, width, right } = target.getBoundingClientRect()
    this.contextmenu.style.top = `${top}px`
    this.contextmenu.style.left = `${right - width}px`
  }
  _showContextMenu(projectName) {
    this.contextmenu.open = !this.contextmenu.open
    if (this.contextmenu.open) this.__showContextMenu(projectName)
  }

  get #projectsTemplate() {
    console.log(this.projects)

    return this.projects.map(
      item => html`
        <md-list-item
          .headline=${item}
          data-project=${item}
          @click=${event => {
            cadleShell.loadProject(item)
          }}>
          <span slot="headline">${item}</span>
          <custom-icon
            icon="more_vert"
            @click=${() => this._showContextMenu(item)}
            slot="end"></custom-icon>
        </md-list-item>
      `
    )
  }

  render() {
    return html`
      <custom-dropdown class="contextmenu">
        <md-list-item
          headline="rename"
          data-action="rename">
          <span slot="headline">rename</span>
          <custom-icon
            icon="abc"
            slot="end"></custom-icon>
        </md-list-item>

        <md-list-item
          headline="delete"
          data-action="delete">
          <span slot="headline">delete</span>
          <custom-icon
            icon="delete"
            slot="end"></custom-icon>
        </md-list-item>
      </custom-dropdown>
      <flex-container>
        ${this.projects?.length > 0
          ? this.#projectsTemplate
          : html`<md-outlined-button @click=${cadleShell.uploadProject.bind(cadleShell)}>upload</md-outlined-button>
              <md-filled-button @click=${cadleShell.createProject.bind(cadleShell)}>create</md-filled-button>`}
      </flex-container>
    `
  }
}
