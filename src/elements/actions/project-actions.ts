import { LiteElement, html, customElement, query } from '@vandeurenglenn/lite'
import styles from './project-actions.css' with { type: 'css' }
import '@material/web/button/text-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/flex-elements/row.js'

import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { download, save, share, upload, importPlan } from '../../api/project.js'
import { map } from '@vandeurenglenn/lite/map.js'
import { render } from 'lit-html'
@customElement('project-actions')
export class ProjectActions extends LiteElement {
  lastAction: string = ''
  actions = {
    file: [
      {
        title: 'import plan',
        action: 'import-pdf',
        icon: 'upload_file'
      },
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
        title: 'new from template',
        action: 'new-from-template',
        icon: 'create_new_folder'
      },
      {
        title: 'import custom symbol',
        action: 'import-custom-symbol',
        icon: 'upload_file'
      },
      {
        title: 'validate bindings',
        action: 'validate-bindings',
        icon: 'check'
      },
      {
        title: 'export BOM',
        action: 'export-bom',
        icon: 'download'
      },
      {
        title: 'generate one-wire schema',
        action: 'generate-one-wire',
        icon: 'output'
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
      },
      {
        title: 'history panel',
        action: 'toggle-history-panel',
        icon: 'menu'
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

  static styles = [styles]

  @query('custom-dropdown') accessor dropdown!: CustomDropdown

  #openMenu(kind: 'file' | 'help', target: HTMLElement) {
    const { left, bottom } = target.getBoundingClientRect()
    this.dropdown.style.position = 'fixed'
    this.dropdown.style.left = `${left}px`
    this.dropdown.style.top = `${bottom}px`
    this.dropdown.style.zIndex = '10020'
    if (kind === 'file') {
      render(this._fileDropDownTemplate(), this.dropdown)
    } else {
      render(this._helpDropDownTemplate(), this.dropdown)
    }

    console.log('open menu', { kind, left, bottom })

    this.dropdown.open = true
    this.lastAction = kind
  }

  #handleMenuAction(action: string) {
    switch (action) {
      case 'import-pdf':
        importPlan()
        break
      case 'save':
        save()
        break
      case 'new-from-template':
        cadleShell.openTemplateLibrary()
        break
      case 'import-custom-symbol':
        cadleShell.openCustomSymbolImport()
        break
      case 'validate-bindings':
        cadleShell.validateBindingsForOneWire()
        break
      case 'export-bom':
        cadleShell.generateBOM()
        break
      case 'generate-one-wire':
        cadleShell.generateAutoOneWireSchema()
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
      case 'toggle-history-panel':
        cadleShell.toggleHistoryPanel()
        break
      case 'create':
        location.hash = '#!/create-project'
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
  }

  #toggleMenu = (event: Event) => {
    const target = event.currentTarget as HTMLElement | null
    const action = target?.getAttribute('data-action') as 'file' | 'help' | null
    console.log('toggle menu', { action, target })
    if (!target || !action) return
    if (this.dropdown.open && this.lastAction === action) {
      this.dropdown.open = false
      this.lastAction = ''
      return
    }

    this.#openMenu(action, target)
  }

  #onMenuItemClick = (event: Event) => {
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement | null
    const action = target?.getAttribute('data-action')
    if (!action) return
    this.#handleMenuAction(action)
    this.dropdown.open = false
    this.lastAction = ''
  }

  _fileDropDownTemplate() {
    return html`
      <custom-menu>
        ${map(
          this.actions.file,
          (action, i) => html`
            <custom-list-item
              title=${action.title}
              data-action=${action.action}
              @click=${this.#onMenuItemClick}
              tabindex=${i + 1}>
              <custom-icon
                slot="start"
                .icon=${action.icon}></custom-icon>
              <span slot="end">${action.title}</span>
            </custom-list-item>
          `
        )}
      </custom-menu>
    `
  }

  _helpDropDownTemplate() {
    return html`
      <custom-menu>
        ${map(
          this.actions.help,
          (action, i) => html`
            <custom-list-item
              title=${action.title}
              data-action=${action.action}
              @click=${this.#onMenuItemClick}
              tabindex=${i + 1}>
              <custom-icon
                slot="start"
                .icon=${action.icon}></custom-icon>
              <span slot="end">${action.title}</span>
            </custom-list-item>
          `
        )}
      </custom-menu>
    `
  }

  render() {
    return html`
      <flex-row>
        <md-text-button
          data-action="file"
          @click=${this.#toggleMenu}
          >File</md-text-button
        >
        <md-text-button
          data-action="help"
          @click=${this.#toggleMenu}
          >Help</md-text-button
        >
      </flex-row>
      <custom-dropdown>
        <custom-elevation level="1"></custom-elevation>
      </custom-dropdown>
    `
  }
}
