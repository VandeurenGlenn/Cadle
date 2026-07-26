import { LiteElement, html, property, customElement } from '@vandeurenglenn/lite'
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
    { action: 'draw-onewire-lighting', icon: 'electrical_services', title: 'Lighting preset', label: '💡' },
    { action: 'draw-onewire-sockets', icon: 'electrical_services', title: 'Sockets preset', label: '🔌' },
    { action: 'draw-onewire-motor', icon: 'electrical_services', title: 'Motor preset', label: '⚙️' },
    { action: 'draw-onewire-compose-breaker', icon: 'add', title: 'Add breaker', label: 'Breaker' },
    { action: 'draw-onewire-compose-switch', icon: 'add', title: 'Add switch', label: 'Switch' },
    { action: 'draw-onewire-compose-kamrail', icon: 'add', title: 'Add kamrail', label: 'KamRail' },
    { action: 'draw-onewire-compose-load', icon: 'add', title: 'Add load', label: 'Load' },
    { action: 'draw-onewire-next', icon: 'polyline', title: 'Next circuit', label: 'Next' },
    { action: 'draw-onewire-reset-panel', icon: 'layers', title: 'New panel', label: 'Panel' },
    { action: 'draw-onewire-realign', icon: 'align_horizontal_left', title: 'Realign one-wire', label: 'Align' }
  ]

  firstRender(): void {
    // The element can be lazy-loaded after the initial hashchange already
    // happened, so initialize visibility from the current route as well.
    this.isVisible = location.hash.includes('#!/native-draw')
    pubsub.subscribe('native.controls.state', this.#onStateChange)
    pubsub.subscribe('shell.action', this.#onActionChange)
    window.addEventListener('hashchange', this.#onHashChange)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('native.controls.state', this.#onStateChange)
    pubsub.unsubscribe('shell.action', this.#onActionChange)
    window.removeEventListener('hashchange', this.#onHashChange)
  }

  #onStateChange = (state: Record<string, unknown>) => {
    const preset = state.oneWirePreset as string | undefined
    if (preset) this.currentPreset = preset
  }

  #onActionChange = (_action: string) => {
    // Show one-wire actions when in native-draw mode
    this.isVisible = location.hash.includes('#!/native-draw')
  }

  #onHashChange = () => {
    this.isVisible = location.hash.includes('#!/native-draw')
  }

  #handleAction = (action: string) => {
    switch (action) {
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
