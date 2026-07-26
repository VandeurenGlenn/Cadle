import { LiteElement, html, property, customElement, listen } from '@vandeurenglenn/lite'
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

  #actions: OneWireAction[] = [
    { action: 'draw-onewire-compose-kamrail', icon: 'power_input', title: 'Add kamrail', label: 'KamRail' },
    { action: 'draw-onewire-compose-breaker', icon: 'electric_bolt', title: 'Add breaker', label: 'Breaker' },
    { action: 'draw-onewire-compose-switch', icon: 'toggle_off', title: 'Add switch', label: 'Switch' },
    { action: 'draw-onewire-compose-load', icon: 'power', title: 'Add load', label: 'Load' }
  ]

  firstRender(): void {
    // The element can be lazy-loaded after the initial hashchange already
    // happened, so initialize visibility from the current route as well.
    this.isVisible = location.hash.includes('#!/editor/model')
    pubsub.subscribe('shell.action', this.#onActionChange)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.action', this.#onActionChange)
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
