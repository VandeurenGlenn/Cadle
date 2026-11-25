import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './status-bar.css' with { type: 'css' }
import pubsub from '../pubsub.js'
import { CONNECTION_NAMES, type ConnectionKind } from '../editor/model/electrical-connection.js'
import type { PersistenceState } from '../editor/controllers/persistence-queue.js'
declare global {
  interface HTMLElementTagNameMap {
    'status-bar': StatusBar
  }
}

type CadleShellLite = {
  action?: string
  freeDraw?: boolean
}

const TOOL_LABELS: Record<string, string> = {
  '': 'Select',
  select: 'Select',
  'draw-wall': 'Draw wall',
  'draw-room': 'Draw room',
  'draw-door': 'Draw door',
  'draw-sliding-door': 'Draw sliding door',
  'draw-sliding-window': 'Draw sliding window',
  'draw-built-in-cabinet': 'Draw built-in cabinet',
  'draw-stairs': 'Rechte trap tekenen',
  'draw-stairs-route': 'Traptraject tekenen',
  'draw-driveway': 'Oprit tekenen',
  'draw-stairs-quarter-turn': 'Kwartdraaitrap tekenen',
  'draw-stairs-double-quarter-turn': 'Trap met 2 kwartslagen tekenen',
  'draw-stairs-spiral': 'Wenteltrap tekenen',
  'draw-access-point': 'Place Wi-Fi access point',
  'draw-heat-pump': 'Warmtepomp plaatsen',
  'draw-gate': 'Draw gate',
  'draw-window': 'Draw window',
  'draw-line': 'Draw line',
  'draw-cable': 'Draw cable',
  'draw-circle': 'Draw circle',
  'draw-arc': 'Draw arc',
  'draw-square': 'Draw box',
  'draw-roof-left': 'Dakvlak · punt links',
  'draw-roof-straight': 'Dakvlak · zonder punt',
  'draw-roof-right': 'Dakvlak · punt rechts',
  draw: 'Freedraw',
  'draw-text': 'Insert text'
}
const ZOOM_CYCLE = [0.5, 1, 2]
@customElement('status-bar')
export class StatusBar extends LiteElement {
  static styles = [styles]

  @property({ type: String }) accessor action = ''
  @property({ attribute: false }) accessor connectionKind: ConnectionKind | null = null
  @property({ type: Number }) accessor cursorX = 0
  @property({ type: Number }) accessor cursorY = 0
  @property({ type: Boolean }) accessor hasCursor = false
  @property({ type: Number }) accessor zoom = 1
  @property({ type: Boolean }) accessor snap = true
  @property({ type: Object, attribute: false }) accessor persistenceState: PersistenceState = { status: 'idle' }
  @property({ type: Object, consumes: 'shell.pointer' }) accessor pointer!: { x: number; y: number }

  firstRender(): void {
    const shell = (globalThis as { cadleShell?: CadleShellLite }).cadleShell
    this.action = shell?.action ?? ''
    this.snap = !shell?.freeDraw
    pubsub.subscribe('shell.action', this.#onAction)
    pubsub.subscribe('editor.controls.state', this.#onControlsState)
    pubsub.subscribe('shell.snap', this.#onSnap)
  }

  willChange(propertyKey: string, value) {
    if (propertyKey === 'pointer') {
      const pointerValue = value as { x: number; y: number } | undefined
      this.cursorX = pointerValue?.x ?? 0
      this.cursorY = pointerValue?.y ?? 0
      this.hasCursor = !!pointerValue
    }
    return value
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.action', this.#onAction)
    pubsub.unsubscribe('editor.controls.state', this.#onControlsState)
    pubsub.unsubscribe('shell.snap', this.#onSnap)
  }

  #onAction = (value: string) => {
    this.action = value ?? ''
  }

  #onControlsState = (state: { connectionKind?: ConnectionKind | null; zoom?: number; persistenceState?: PersistenceState }) => {
    this.connectionKind = state.connectionKind ?? null
    if (typeof state.zoom === 'number') this.zoom = state.zoom
    if (state.persistenceState) this.persistenceState = state.persistenceState
  }

  #onSnap = (value: boolean) => {
    this.snap = !!value
  }

  #toggleSnap = () => {
    const shell = (globalThis as { cadleShell?: CadleShellLite }).cadleShell
    if (!shell) return
    shell.freeDraw = !shell.freeDraw
  }

  #cycleZoom = () => {
    const current = Math.round(this.zoom * 100) / 100
    const next = ZOOM_CYCLE.find((z) => z > current + 0.001) ?? ZOOM_CYCLE[0]
    pubsub.publish('editor.controls.command', { zoom: next })
  }

  render() {
    const saveState = this.persistenceState ?? { status: 'idle' }
    const toolLabel = this.action === 'draw-line' && this.connectionKind
      ? CONNECTION_NAMES[this.connectionKind] : TOOL_LABELS[this.action] ?? this.action ?? 'Select'
    return html`
      <span class="item tool">
        <span class="label">Tool</span>
        <span class="value">${toolLabel}</span>
      </span>
      <span
        class="separator cursor-detail"
        aria-hidden="true"></span>
      <span class="item cursor-detail">
        <span class="label">Cursor</span>
        <span class="value mono">${this.hasCursor ? `x ${Math.round(this.cursorX)}` : 'x —'}</span>
        <span class="value mono">${this.hasCursor ? `y ${Math.round(this.cursorY)}` : 'y —'}</span>
      </span>
      <span class="spacer"></span>
      <button
        type="button"
        title="Toggle snap to grid"
        aria-pressed=${this.snap}
        @click=${this.#toggleSnap}>
        Grid ${this.snap ? 'on' : 'off'}
      </button>
      <span
        class="separator"
        aria-hidden="true"></span>
      <button
        type="button"
        title="Cycle zoom(50% / 100% / 200%)"
        @click=${this.#cycleZoom}>
        <span class="mono">${Math.round(this.zoom * 100)}%</span>
      </button>
      <span class="status-pill visible ${saveState.status === 'error' ? 'unsaved' : 'saved'}"
        role="status" aria-live="polite" data-save-state=${saveState.status}
        title=${saveState.status === 'error'
          ? String(saveState.error instanceof Error ? saveState.error.message : saveState.error)
          : ''}>
        ${saveState.status === 'error' ? 'Opslaan mislukt'
          : saveState.status === 'saving' ? 'Bezig met opslaan'
          : saveState.status === 'saved' ? 'Opgeslagen' : 'Nog geen wijzigingen'}
      </span>
      ${saveState.status === 'error' ? html`
        <button type="button" @click=${() => pubsub.publish('editor.persistence.retry', undefined, true)}>Opnieuw proberen</button>
        <button type="button" @click=${() => pubsub.publish('editor.persistence.download', undefined, true)}>Herstelbestand downloaden</button>
      ` : ''}
    `
  }
}
