import { LiteElement, html, property, customElement, listen } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import pubsub from '../../pubsub.js'
import styles from './onewire-actions.css' with { type: 'css' }
import { CONNECTION_NAMES, type ConnectionKind } from '../../editor/model/electrical-connection.js'

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

  @property({ type: Boolean }) accessor menuOpen = false
  @property({ type: Boolean }) accessor isVisible = false
  @property({ type: String }) accessor activeKind: OneWireComposeKind = 'switch'
  @property({ attribute: false }) accessor connectionKind: ConnectionKind | null = null
  @property({ type: String }) accessor activeTool = 'select'

  #connections: ConnectionKind[] = ['wire', 'cable', 'branch', 'bridge']

  #connectionIcon(kind: ConnectionKind = 'cable') {
    const path = kind === 'bridge' ? 'M3 18V6H21V18'
      : kind === 'branch' ? 'M3 12H21M12 12V3'
      : kind === 'cable' ? 'M3 12H21M10 7L14 17' : 'M3 12H21'
    return html`<svg class="connection-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d=${path}></path>${kind === 'branch' ? html`<circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"></circle>` : ''}
    </svg>`
  }

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

  #onControlsState = (state: { oneWireComposeKind?: OneWireComposeKind; connectionKind?: ConnectionKind | null; activeTool?: string }) => {
    if (state.oneWireComposeKind) this.activeKind = state.oneWireComposeKind
    this.connectionKind = state.connectionKind ?? null
    if (state.activeTool) this.activeTool = state.activeTool
  }

  @listen('hashchange', { target: 'window' })
  onHashChange() {
    this.isVisible = location.hash.includes('#!/editor/model')
  }

  #openConnections = (event: MouseEvent) => {
    const trigger = event.currentTarget as HTMLElement
    const menu = this.shadowRoot?.querySelector<HTMLElement>('#connection-options')
    if (!menu) return
    if (menu.matches(':popover-open')) { menu.hidePopover(); return }
    const rect = trigger.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 232))}px`
    menu.style.top = `${rect.bottom + 8}px`
    menu.showPopover({ source: trigger })
    if (!event.detail) menu.querySelector<HTMLButtonElement>('button')?.focus()
  }

  @listen('resize', { target: 'window' })
  closeConnectionsOnResize() {
    this.shadowRoot?.querySelector<HTMLElement>('#connection-options')?.hidePopover()
  }

  #handleAction = (kind: OneWireComposeKind) => {
    pubsub.publish('editor.controls.command', { onewireCompose: kind })
  }

  render() {
    if (!this.isVisible) return html``

    return html`
      <div class="onewire-actions-container" role="group" aria-label="Electrical tools">
        ${this.#actions.map(
          (action) => html`
            <button
              class="onewire-action-btn"
              title="${action.title}"
              aria-label="${action.title}"
              aria-pressed=${this.activeTool === 'onewire' && this.activeKind === action.kind ? 'true' : 'false'}
              @click="${() => this.#handleAction(action.kind)}">
              <custom-icon icon="${action.icon}"></custom-icon>
              <span>${action.label}</span>
            </button>
          `
        )}
        <div class="connection-menu">
          <button type="button" class="connection-trigger" title="Elektrische verbindingen" aria-label="Elektrische verbindingen"
            aria-controls="connection-options" aria-expanded=${this.menuOpen ? 'true' : 'false'}
            @click=${this.#openConnections} data-active=${this.connectionKind ? 'true' : 'false'}>
            ${this.#connectionIcon(this.connectionKind ?? 'cable')}
            <span>${this.connectionKind ? CONNECTION_NAMES[this.connectionKind] : 'Verbinding'}</span>
            <custom-icon class="menu-chevron" icon="keyboard_arrow_down"></custom-icon>
          </button>
          <div id="connection-options" class="connection-options" popover="auto" aria-label="Electrical connections"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          this.shadowRoot?.querySelector<HTMLElement>('#connection-options')?.hidePopover()
          requestAnimationFrame(() => this.shadowRoot?.querySelector<HTMLButtonElement>('.connection-trigger')?.focus())
        }}
            @toggle=${(event: ToggleEvent) => { this.menuOpen = event.newState === 'open' }}>
            <div class="popover-heading">Electrical connections</div>
            ${this.#connections.map((kind) => html`
              <button class="onewire-action-btn" aria-label=${`Teken ${CONNECTION_NAMES[kind].toLowerCase()}`}
                aria-pressed=${this.connectionKind === kind ? 'true' : 'false'} @click=${(event: Event) => {
                  pubsub.publish('editor.controls.command', { connectionKind: kind })
                  ;(event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover()
                }}>${this.#connectionIcon(kind)}<span>${CONNECTION_NAMES[kind]}</span></button>
            `)}
          </div>
        </div>
      </div>
    `
  }
}
