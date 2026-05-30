import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './status-bar.css' with { type: 'css' }
import pubsub from '../pubsub.js'
declare global {
  interface HTMLElementTagNameMap {
    'status-bar': StatusBar
  }
}

type CadleShellLite = {
  action?: string
  freeDraw?: boolean
  field?: { setZoom?: (zoom: number) => void }
}

const TOOL_LABELS: Record<string, string> = {
  '': 'Select',
  select: 'Select',
  'draw-wall': 'Draw wall',
  'draw-door': 'Draw door',
  'draw-gate': 'Draw gate',
  'draw-window': 'Draw window',
  draw: 'Freedraw',
  'draw-text': 'Insert text'
}
const ZOOM_CYCLE = [0.5, 1, 2]
@customElement('status-bar')
export class StatusBar extends LiteElement {
  static styles = [styles]

  @property({ type: String }) accessor action = ''
  @property({ type: Number }) accessor cursorX = 0
  @property({ type: Number }) accessor cursorY = 0
  @property({ type: Boolean }) accessor hasCursor = false
  @property({ type: Number }) accessor zoom = 1
  @property({ type: Boolean }) accessor snap = true
  @property({ type: Object, consumes: 'shell.pointer' }) accessor pointer

  firstRender(): void {
    const shell = (globalThis as unknown as { cadleShell?: CadleShellLite }).cadleShell
    this.action = shell?.action ?? ''
    this.snap = !shell?.freeDraw
    pubsub.subscribe('shell.action', this.#onAction)
    pubsub.subscribe('shell.snap', this.#onSnap)
  }

  willChange(propertyKey: string, value): any {
    if (propertyKey === 'pointer') {
      value = value as { x: number; y: number } | undefined
      this.cursorX = value?.x ?? 0
      this.cursorY = value?.y ?? 0
      this.hasCursor = !!value
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.action', this.#onAction)
    pubsub.unsubscribe('shell.snap', this.#onSnap)
  }

  #onAction = (value: string) => {
    this.action = value ?? ''
  }

  #onPointerMove = (point?: { x: number; y: number }) => {
    this.cursorX = point?.x ?? 0
    this.cursorY = point?.y ?? 0
    this.hasCursor = true
  }

  #onZoom = (value: number) => {
    if (typeof value === 'number') this.zoom = value
  }

  #onSnap = (value: boolean) => {
    this.snap = !!value
  }

  #toggleSnap = () => {
    const shell = (globalThis as unknown as { cadleShell?: CadleShellLite }).cadleShell
    if (!shell) return
    shell.freeDraw = !shell.freeDraw
  }

  #cycleZoom = () => {
    const shell = (globalThis as unknown as { cadleShell?: CadleShellLite }).cadleShell
    const field = shell?.field
    if (!field) return
    const current = Math.round(this.zoom * 100) / 100
    const next = ZOOM_CYCLE.find((z) => z > current + 0.001) ?? ZOOM_CYCLE[0]
    field.setZoom?.(next)
  }

  render() {
    const toolLabel = TOOL_LABELS[this.action] ?? this.action ?? 'Select'
    return html`
      <span class="item tool">
        <span class="label">Tool</span>
        <span class="value">${toolLabel}</span>
      </span>
      <span
        class="separator"
        aria-hidden="true"></span>
      <span class="item">
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
    `
  }
}
