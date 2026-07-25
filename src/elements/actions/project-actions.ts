import { LiteElement, html, customElement, query } from '@vandeurenglenn/lite'
import styles from './project-actions.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/flex-elements/row.js'

import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { download, share, upload, importPlan } from '../../api/project.js'
import { map } from '@vandeurenglenn/lite/map.js'
import { render } from 'lit-html'
import pubsub from '../../pubsub.js'
@customElement('project-actions')
export class ProjectActions extends LiteElement {
  lastAction: string = ''
  #menuZIndex = 12040
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
        title: 'edit project details',
        action: 'edit-project-details',
        icon: 'edit'
      },
      {
        title: 'history panel',
        action: 'toggle-history-panel',
        icon: 'menu'
      }
    ],
    draw: [
      { title: 'A4 portrait', action: 'draw-paper-a4-portrait', icon: 'height' },
      { title: 'A4 landscape', action: 'draw-paper-a4-landscape', icon: 'width' },
      { title: 'A3 portrait', action: 'draw-paper-a3-portrait', icon: 'height' },
      { title: 'A3 landscape', action: 'draw-paper-a3-landscape', icon: 'width' },
      { title: 'Margin +1 mm', action: 'draw-margin-inc', icon: 'swap-horiz' },
      { title: 'Margin -1 mm', action: 'draw-margin-dec', icon: 'swap-horiz' },
      { title: 'Lighting preset', action: 'draw-onewire-lighting', icon: 'electrical_services' },
      { title: 'Sockets preset', action: 'draw-onewire-sockets', icon: 'electrical_services' },
      { title: 'Motor preset', action: 'draw-onewire-motor', icon: 'electrical_services' },
      { title: 'Add breaker', action: 'draw-onewire-compose-breaker', icon: 'add' },
      { title: 'Add switch', action: 'draw-onewire-compose-switch', icon: 'add' },
      { title: 'Add kamrail', action: 'draw-onewire-compose-kamrail', icon: 'add' },
      { title: 'Add load', action: 'draw-onewire-compose-load', icon: 'add' },
      { title: 'Next circuit', action: 'draw-onewire-next', icon: 'polyline' },
      { title: 'New panel', action: 'draw-onewire-reset-panel', icon: 'layers' },
      { title: 'Realign one-wire', action: 'draw-onewire-realign', icon: 'align_horizontal_left' },
      { title: 'Export JSON', action: 'draw-export-json', icon: 'download' },
      { title: 'Export PDF', action: 'draw-export-pdf', icon: 'save' },
      { title: 'Print', action: 'draw-print-svg', icon: 'save' },
      { title: 'Import JSON', action: 'draw-import-json', icon: 'upload_file' },
      { title: 'Clear drawing', action: 'draw-clear', icon: 'delete' }
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

  #openMenu(kind: 'file' | 'draw' | 'help', target: HTMLElement) {
    const { left, bottom } = target.getBoundingClientRect()
    this.dropdown.style.position = 'fixed'
    this.dropdown.style.left = `${left}px`
    this.dropdown.style.top = `${bottom}px`
    this.dropdown.style.zIndex = String(this.#menuZIndex)
    if (kind === 'file') {
      render(this._fileDropDownTemplate(), this.dropdown)
    } else if (kind === 'draw') {
      render(this._drawDropDownTemplate(), this.dropdown)
    } else {
      render(this._helpDropDownTemplate(), this.dropdown)
    }

    this.dropdown.open = true
    this.lastAction = kind
  }

  #handleMenuAction(action: string) {
    switch (action) {
      case 'import-pdf':
        importPlan()
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
      case 'edit-project-details':
        cadleShell.openProjectDetailsDialog()
        break
      case 'toggle-history-panel':
        cadleShell.toggleHistoryPanel()
        break
      case 'draw-paper-a4-portrait':
        pubsub.publish('native.controls.command', { paper: 'a4-portrait' })
        break
      case 'draw-paper-a4-landscape':
        pubsub.publish('native.controls.command', { paper: 'a4-landscape' })
        break
      case 'draw-paper-a3-portrait':
        pubsub.publish('native.controls.command', { paper: 'a3-portrait' })
        break
      case 'draw-paper-a3-landscape':
        pubsub.publish('native.controls.command', { paper: 'a3-landscape' })
        break
      case 'draw-margin-inc':
        pubsub.publish('native.controls.command', { action: 'margin-inc' })
        break
      case 'draw-margin-dec':
        pubsub.publish('native.controls.command', { action: 'margin-dec' })
        break
      case 'draw-onewire-lighting':
        pubsub.publish('native.controls.command', { onewirePreset: 'lighting' })
        break
      case 'draw-onewire-sockets':
        pubsub.publish('native.controls.command', { onewirePreset: 'sockets' })
        break
      case 'draw-onewire-motor':
        pubsub.publish('native.controls.command', { onewirePreset: 'motor' })
        break
      case 'draw-onewire-compose-breaker':
        pubsub.publish('native.controls.command', { onewireCompose: 'breaker' })
        break
      case 'draw-onewire-compose-switch':
        pubsub.publish('native.controls.command', { onewireCompose: 'switch' })
        break
      case 'draw-onewire-compose-kamrail':
        pubsub.publish('native.controls.command', { onewireCompose: 'kamrail' })
        break
      case 'draw-onewire-compose-load':
        pubsub.publish('native.controls.command', { onewireCompose: 'load' })
        break
      case 'draw-onewire-next':
        pubsub.publish('native.controls.command', { action: 'onewire-next' })
        break
      case 'draw-onewire-reset-panel':
        pubsub.publish('native.controls.command', { action: 'onewire-reset-panel' })
        break
      case 'draw-onewire-realign':
        pubsub.publish('native.controls.command', { action: 'onewire-realign' })
        break
      case 'draw-export-json':
        pubsub.publish('native.controls.command', { action: 'export-json' })
        break
      case 'draw-export-pdf':
        pubsub.publish('native.controls.command', { action: 'export-pdf' })
        break
      case 'draw-print-svg':
        pubsub.publish('native.controls.command', { action: 'print-svg' })
        break
      case 'draw-import-json':
        pubsub.publish('native.controls.command', { action: 'import-json' })
        break
      case 'draw-clear':
        pubsub.publish('native.controls.command', { action: 'clear' })
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
    const action = target?.getAttribute('data-action') as 'file' | 'draw' | 'help' | null
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
              <span>${action.title}</span>
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
              <span>${action.title}</span>
            </custom-list-item>
          `
        )}
      </custom-menu>
    `
  }

  _drawDropDownTemplate() {
    const groups = [
      {
        label: 'Paper',
        items: this.actions.draw.filter(
          (entry) => entry.action.startsWith('draw-paper') || entry.action.startsWith('draw-margin')
        )
      },
      {
        label: 'One-wire',
        items: this.actions.draw.filter((entry) => entry.action.startsWith('draw-onewire'))
      },
      {
        label: 'Export',
        items: this.actions.draw.filter((entry) =>
          ['draw-export-json', 'draw-export-pdf', 'draw-print-svg', 'draw-import-json', 'draw-clear'].includes(
            entry.action
          )
        )
      }
    ]
    let tabindex = 1
    return html`
      <custom-menu class="draw-menu">
        ${groups.map(
          (group) => html`
            <div class="menu-group-label">${group.label}</div>
            ${map(
              group.items,
              (action) => html`
                <custom-list-item
                  title=${action.title}
                  data-action=${action.action}
                  @click=${this.#onMenuItemClick}
                  tabindex=${tabindex++}>
                  <custom-icon
                    slot="start"
                    .icon=${action.icon}></custom-icon>
                  <span>${action.title}</span>
                </custom-list-item>
              `
            )}
          `
        )}
      </custom-menu>
    `
  }

  render() {
    return html`
      <flex-row>
        <custom-button
          type="text"
          label="File"
          data-action="file"
          @click=${this.#toggleMenu}></custom-button>
        <custom-button
          type="text"
          label="Draw"
          data-action="draw"
          @click=${this.#toggleMenu}></custom-button>
        <custom-button
          type="text"
          label="Help"
          data-action="help"
          @click=${this.#toggleMenu}></custom-button>
      </flex-row>
      <custom-dropdown>
        <custom-elevation level="1"></custom-elevation>
      </custom-dropdown>
    `
  }
}
