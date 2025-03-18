import { LitElement, html, css, render } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@material/web/button/text-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/icon.js'
import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { download, save, share, upload, create } from '../../api/project.js'
import { map } from 'lit/directives/map.js'

@customElement('project-actions')
export class ProjectActions extends LitElement {
  lastAction: string
  actions = {
    file: [
      {
        title: 'create project',
        action: 'create',
        icon: 'create_new_folder'
      },
      {
        title: 'upload project',
        action: 'upload',
        icon: 'upload_file'
      },
      {
        title: 'download project',
        action: 'download',
        icon: 'download'
      },
      {
        title: 'save project',
        action: 'save',
        icon: 'save'
      },
      {
        title: 'open project',
        action: 'open',
        icon: 'folder_open'
      },
      {
        title: 'share project',
        action: 'share',
        icon: 'share'
      }
    ],
    help: [
      {
        title: 'keyboard shortcuts',
        action: 'showShortcuts',
        icon: 'keyboard'
      }
    ]
  }

  static styles = [
    css`
      :host {
        display: block;
      }

      md-text-button {
        pointer-events: auto;
      }

      custom-dropdown {
        margin-left: 6px;
        margin-top: 6px;

        background-color: var(--md-sys-color-background);
        border-radius: var(--md-sys-shape-corner-medium);
        // border: 1px solid var(--md-sys-color-outline);
      }

      custom-elevation {
        border-radius: var(--md-sys-shape-corner-medium);
      }

      custom-button {
        border-radius: var(--md-sys-shape-corner-medium);
      }

      flex-row {
        width: 100%;
      }

      custom-icon {
        margin-right: 12px;
      }

      custom-list-item:active {
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
      }

      custom-list-item {
        color: var(--md-sys-color-on-surface-variant);
        font-family: var(--md-sys-typescale-label-large-font-family-name);
        font-style: var(--md-sys-typescale-label-large-font-family-style);
        font-weight: var(--md-sys-typescale-label-large-font-weight);
        font-size: var(--md-sys-typescale-label-large-font-size);
        letter-spacing: var(--md-sys-typescale-label-large-tracking);
        line-height: var(--md-sys-typescale-label-large-height);
        text-transform: var(--md-sys-typescale-label-large-text-transform);
        text-decoration: var(--md-sys-typescale-label-large-text-decoration);
      }

      custom-list-item:hover,
      custom-list-item:focus {
        background: var(--md-sys-color-secondary-container-hover);
        color: var(--md-sys-color-on-secondary-container);
      }
    `
  ]

  @query('custom-dropdown') dropdown: CustomDropdown

  connectedCallback(): void {
    super.connectedCallback()

    this._click = this._click.bind(this)
    this.shadowRoot.addEventListener('click', this._click)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.shadowRoot.removeEventListener('click', this._click)
  }

  _click(event) {
    const action = event.target.dataset.action
    console.log(action)

    switch (action) {
      case 'file':
        const handleFileDropdown = () => {
          this.dropdown.style.left = `${event.target.getBoundingClientRect().left}px`
          render(this._fileDropDownTemplate(), this.dropdown)
        }
        if (!this.dropdown.open) {
          handleFileDropdown()
        } else if (this.dropdown.open && this.lastAction === 'help') {
          this.dropdown.open = false
          handleFileDropdown()
        }
        break
      case 'help':
        const handleHelpDropdown = () => {
          this.dropdown.style.left = `${event.target.getBoundingClientRect().left}px`
          render(this._helpDropDownTemplate(), this.dropdown)
        }
        if (!this.dropdown.open) {
          handleHelpDropdown()
        } else if (this.dropdown.open && this.lastAction === 'file') {
          this.dropdown.open = false
          handleHelpDropdown()
        }
        break
      case 'save':
        save()
        break
      case 'upload':
        upload()
        break
      case 'download':
        download()
        break
      case 'share':
        share()
        break
      case 'create':
        cadleShell.createProject()
        break

      case 'showShortcuts':
        cadleShell.showShortcuts.call(this)
        break
      case 'open':
        location.hash = '#!/projects'
        break
      default:
        break
    }
    this.dropdown.open = !this.dropdown.open
    this.lastAction = action
  }

  _fileDropDownTemplate() {
    return html`
      ${map(
        this.actions.file,
        (action, i) => html`
          <custom-list-item
            title=${action.title}
            data-action=${action.action}
            tabindex=${i + 1}>
            <flex-row center>
              <custom-icon .icon=${action.icon}></custom-icon>
              <flex-it></flex-it>
              ${action.title}
            </flex-row>
          </custom-list-item>
        `
      )}
    `
  }

  _helpDropDownTemplate() {
    return html`
      ${map(
        this.actions.help,
        (action, i) => html`
          <custom-list-item
            title=${action.title}
            data-action=${action.action}
            tabindex=${i + 1}>
            <flex-row center>
              <custom-icon .icon=${action.icon}></custom-icon>
              <flex-it></flex-it>
              ${action.title}
            </flex-row>
          </custom-list-item>
        `
      )}
    `
  }

  render() {
    return html`
      <flex-row>
        <md-text-button data-action="file">File</md-text-button>
        <md-text-button data-action="help">Help</md-text-button>
      </flex-row>

      <custom-dropdown>
        <custom-elevation level="1"></custom-elevation>
      </custom-dropdown>
    `
  }
}
