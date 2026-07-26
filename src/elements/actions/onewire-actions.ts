import { LiteElement, html, property, customElement, listen } from '@vandeurenglenn/lite'
import '@material/web/icon/icon.js'
import '@material/web/iconbutton/icon-button.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import pubsub from '../../pubsub.js'
import styles from './onewire-actions.css' with { type: 'css' }

declare global {
  interface HTMLElementTagNameMap {
    'onewire-actions': OneWireActions
  }
}

type OneWireAction = {
  action: string
  icon: string
  title: string
  label: string
}

@customElement('onewire-actions')
export class OneWireActions extends LiteElement {
  static styles = [styles]

  @property({ type: Boolean }) accessor isVisible = false
  @property({ type: String }) accessor currentPreset: string = ''

  #actions: OneWireAction[] = [
    { action: 'draw-onewire-lighting', icon: 'lightbulb', title: 'Lighting preset', label: 'Lighting' },
    { action: 'draw-onewire-sockets', icon: 'outlet', title: 'Sockets preset', label: 'Sockets' },
    { action: 'draw-onewire-motor', icon: 'settings', title: 'Motor preset', label: 'Motor' },
    { action: 'draw-onewire-compose-breaker', icon: 'toggle_on', title: 'Add breaker', label: 'Breaker' },
    { action: 'draw-onewire-compose-switch', icon: 'toggle_off', title: 'Add switch', label: 'Switch' },
    { action: 'draw-onewire-compose-kamrail', icon: 'view_week', title: 'Add kamrail', label: 'KamRail' },
    { action: 'draw-onewire-compose-load', icon: 'power', title: 'Add load', label: 'Load' },
    { action: 'draw-onewire-next', icon: 'skip_next', title: 'Next circuit', label: 'Next' },
    { action: 'draw-onewire-reset-panel', icon: 'dashboard', title: 'New panel', label: 'Panel' },
    { action: 'draw-onewire-realign', icon: 'align_horizontal_left', title: 'Realign one-wire', label: 'Align' }
  ]

  firstRender(): void {
    // The element can be lazy-loaded after the initial hashchange already
    // happened, so initialize visibility from the current route as well.
    this.isVisible = location.hash.includes('#!/editor/model')
    pubsub.subscribe('editor.controls.state', this.#onStateChange)
    pubsub.subscribe('shell.action', this.#onActionChange)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('editor.controls.state', this.#onStateChange)
    pubsub.unsubscribe('shell.action', this.#onActionChange)
  }

  #onStateChange = (state: Record<string, unknown>) => {
    const preset = state.oneWirePreset as string | undefined
    if (preset) this.currentPreset = preset
  }

  #onActionChange = (_action: string) => {
    // Show one-wire actions when in editor/model mode
    this.isVisible = location.hash.includes('#!/editor/model')
  }

  @listen('hashchange', { target: 'window' })
  onHashChange() {
    this.isVisible = location.hash.includes('#!/editor/model')
  }

  #handleAction = (action: string) => {
    switch (action) {
      case 'draw-onewire-lighting':
        pubsub.publish('editor.controls.command', { onewirePreset: 'lighting' })
        break
      case 'draw-onewire-sockets':
        pubsub.publish('editor.controls.command', { onewirePreset: 'sockets' })
        break
      case 'draw-onewire-motor':
        pubsub.publish('editor.controls.command', { onewirePreset: 'motor' })
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
      case 'draw-onewire-next':
        pubsub.publish('editor.controls.command', { action: 'onewire-next' })
        break
      case 'draw-onewire-reset-panel':
        pubsub.publish('editor.controls.command', { action: 'onewire-reset-panel' })
        break
      case 'draw-onewire-realign':
        pubsub.publish('editor.controls.command', { action: 'onewire-realign' })
        break
    }
  }

  render() {
    if (!this.isVisible) return html``

    return html`
      <div class="onewire-actions-container">
        ${this.#actions.map(
          (action) => html`
            <button
              class="onewire-action-btn"
              title="${action.title}"
              aria-label="${action.title}"
              @click="${() => this.#handleAction(action.action)}">
              <custom-icon icon="${action.icon}"></custom-icon>
            </button>
          `
        )}
      </div>
    `
  }
}
