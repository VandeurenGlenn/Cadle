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
import {
  PROJECT_MENU_GROUPS,
  PROJECT_MENU_PRIMARY_ACTIONS,
  type ProjectMenuGroupId
} from './project-menu.js'
@customElement('project-actions')
export class ProjectActions extends LiteElement {
  lastAction: string = ''
  #menuZIndex = 12040
  #expandedFileGroup: ProjectMenuGroupId | '' = ''
  actions = {
    draw: [
      { title: 'A4 portrait', action: 'draw-paper-a4-portrait', icon: 'height' },
      { title: 'A4 landscape', action: 'draw-paper-a4-landscape', icon: 'width' },
      { title: 'A3 portrait', action: 'draw-paper-a3-portrait', icon: 'height' },
      { title: 'A3 landscape', action: 'draw-paper-a3-landscape', icon: 'width' },
      { title: 'Margin +1 mm', action: 'draw-margin-inc', icon: 'swap-horiz' },
      { title: 'Margin -1 mm', action: 'draw-margin-dec', icon: 'swap-horiz' },
      { title: 'Add breaker', action: 'draw-onewire-compose-breaker', icon: 'electric_bolt' },
      { title: 'Add switch', action: 'draw-onewire-compose-switch', icon: 'add' },
      { title: 'Add kamrail', action: 'draw-onewire-compose-kamrail', icon: 'linear_scale' },
      { title: 'Add load', action: 'draw-onewire-compose-load', icon: 'add' },
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
      this.#expandedFileGroup = ''
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
      case 'export-json':
      case 'export-pdf':
      case 'print-svg':
      case 'import-json':
        pubsub.publish('editor.controls.command', { action })
        break
      case 'generate-one-wire':
        cadleShell.generateAutoOneWireSchema()
        break
      case 'describe-one-wire':
        cadleShell.openOneWirePromptDialog()
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
      case 'open-onewire-training-data':
        cadleShell.openOneWireTrainingData()
        break
      case 'draw-paper-a4-portrait':
        pubsub.publish('editor.controls.command', { paper: 'a4-portrait' })
        break
      case 'draw-paper-a4-landscape':
        pubsub.publish('editor.controls.command', { paper: 'a4-landscape' })
        break
      case 'draw-paper-a3-portrait':
        pubsub.publish('editor.controls.command', { paper: 'a3-portrait' })
        break
      case 'draw-paper-a3-landscape':
        pubsub.publish('editor.controls.command', { paper: 'a3-landscape' })
        break
      case 'draw-margin-inc':
        pubsub.publish('editor.controls.command', { action: 'margin-inc' })
        break
      case 'draw-margin-dec':
        pubsub.publish('editor.controls.command', { action: 'margin-dec' })
        break
      case 'draw-onewire-compose-breaker':
        pubsub.publish('editor.controls.command', { onewireCompose: 'breaker' })
        break
      case 'draw-onewire-compose-switch':
        pubsub.publish('editor.controls.command', { onewireCompose: 'switch' })
        break
      case 'draw-onewire-compose-kamrail':
        pubsub.publish('editor.controls.command', { onewireCompose: 'kamrail' })
        break
      case 'draw-onewire-compose-load':
        pubsub.publish('editor.controls.command', { onewireCompose: 'load' })
        break
      case 'draw-clear':
        pubsub.publish('editor.controls.command', { action: 'clear' })
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

  #onFileGroupClick = (event: Event) => {
    event.stopPropagation()
    const target = event.currentTarget as HTMLElement | null
    const group = target?.dataset.group as ProjectMenuGroupId | undefined
    if (!group) return
    this.#expandedFileGroup = this.#expandedFileGroup === group ? '' : group
    render(this._fileDropDownTemplate(), this.dropdown)
  }

  #fileGroupIcon(group: ProjectMenuGroupId) {
    switch (group) {
      case 'new':
        return html`<custom-icon slot="start" icon="create_new_folder"></custom-icon>`
      case 'import':
        return html`<custom-icon slot="start" icon="upload_file"></custom-icon>`
      case 'export':
        return html`<custom-icon slot="start" icon="download"></custom-icon>`
      case 'onewire':
        return html`<custom-icon slot="start" icon="output"></custom-icon>`
      case 'tools':
        return html`<custom-icon slot="start" icon="edit"></custom-icon>`
    }
  }

  _fileDropDownTemplate() {
    return html`
      <custom-menu class="file-menu">
        ${map(
          PROJECT_MENU_PRIMARY_ACTIONS,
          (action) => html`
            <custom-list-item
              class="primary-menu-item"
              title=${action.title}
              data-action=${action.action}
              @click=${this.#onMenuItemClick}
              tabindex="0">
              <custom-icon slot="start" .icon=${action.icon}></custom-icon>
              <span>${action.title}</span>
            </custom-list-item>
          `
        )}
        ${PROJECT_MENU_GROUPS.map((group) => {
          const expanded = this.#expandedFileGroup === group.id
          return html`
            <custom-list-item
              class="submenu-toggle"
              title=${group.title}
              data-group=${group.id}
              role="menuitem"
              aria-expanded=${String(expanded)}
              @click=${this.#onFileGroupClick}
              tabindex="0">
              ${this.#fileGroupIcon(group.id)}
              <span>${group.title}</span>
              <span slot="end" class="submenu-chevron ${expanded ? 'expanded' : ''}" aria-hidden="true">›</span>
            </custom-list-item>
            ${expanded
              ? group.items.map((action) => html`
                  <custom-list-item
                    class="submenu-item"
                    title=${action.title}
                    data-action=${action.action}
                    @click=${this.#onMenuItemClick}
                    tabindex="0">
                    <custom-icon slot="start" .icon=${action.icon}></custom-icon>
                    <span>${action.title}</span>
                  </custom-list-item>
                `)
              : ''}
          `
        })}
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
        label: 'Drawing',
        items: this.actions.draw.filter((entry) => entry.action === 'draw-clear')
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
