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
  kind: OneWireComposeKind
  icon: string
  title: string
  label: string
}

type OneWireComposeKind = 'breaker' | 'switch' | 'kamrail' | 'load'

@customElement('onewire-actions')
export class OneWireActions extends LiteElement {
  static styles = [styles]

  @property({ type: Boolean }) accessor isVisible = false
  @property({ type: String }) accessor activeKind: OneWireComposeKind = 'switch'

  #actions: OneWireAction[] = [
    { kind: 'kamrail', icon: 'power_input', title: 'Add kamrail', label: 'Kamrail' },
    { kind: 'breaker', icon: 'electric_bolt', title: 'Add breaker', label: 'Breaker' },
    { kind: 'switch', icon: 'toggle_off', title: 'Add switch', label: 'Switch' },
    { kind: 'load', icon: 'power', title: 'Add load', label: 'Load' }
  ]

  firstRender(): void {
    // The element can be lazy-loaded after the initial hashchange already
    // happened, so initialize visibility from the current route as well.
    this.isVisible = location.hash.includes('#!/editor/model')
    pubsub.subscribe('shell.action', this.#onActionChange)
    pubsub.subscribe('editor.controls.state', this.#onControlsState)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.action', this.#onActionChange)
    pubsub.unsubscribe('editor.controls.state', this.#onControlsState)
  }

  #onActionChange = (_action: string) => {
    // Show one-wire actions when in editor/model mode
    this.isVisible = location.hash.includes('#!/editor/model')
  }

  #onControlsState = (state: { oneWireComposeKind?: OneWireComposeKind }) => {
    if (state.oneWireComposeKind) this.activeKind = state.oneWireComposeKind
  }

  @listen('hashchange', { target: 'window' })
  onHashChange() {
    this.isVisible = location.hash.includes('#!/editor/model')
  }

  #handleAction = (kind: OneWireComposeKind) => {
    pubsub.publish('editor.controls.command', { onewireCompose: kind })
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
              aria-pressed=${this.activeKind === action.kind ? 'true' : 'false'}
              @click="${() => this.#handleAction(action.kind)}">
              <custom-icon icon="${action.icon}"></custom-icon>
              <span>${action.label}</span>
            </button>
          `
        )}
      </div>
    `
  }
}
