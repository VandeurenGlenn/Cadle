import { LiteElement, html, property, customElement } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/it.js'
import pubsub from '../../pubsub.js'
import styles from './actions.css' with { type: 'css' }
import { map } from '@vandeurenglenn/lite/map.js'

declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions
  }
}
type DrawTool = { action: string; icon: string; title: string; nativeOnly?: boolean; classicOnly?: boolean }
const DRAW_TOOLS: DrawTool[] = [
  { action: 'select', icon: 'arrow_selector_tool', title: 'Select' },
  { action: 'draw-wall', icon: 'polyline', title: 'Draw wall' },
  { action: 'draw-door', icon: 'door_front', title: 'Draw door' },
  { action: 'draw-gate', icon: 'fence', title: 'Draw gate' },
  { action: 'draw-window', icon: 'window', title: 'Draw window' },
  { action: 'draw-line', icon: 'horizontal_rule', title: 'Draw line' },
  { action: 'draw-onewire', icon: 'electrical_services', title: 'Draw one-wire schematic' },
  { action: 'draw-square', icon: 'square', title: 'Draw box' },
  { action: 'draw-circle', icon: 'radio_button_unchecked', title: 'Draw circle' },
  { action: 'draw-arc', icon: 'line_curve', title: 'Draw arc' },
  { action: 'draw-text', icon: 'insert_text', title: 'Insert text' },
  { action: 'draw-symbol', icon: 'category', title: 'Place symbol' }
]
@customElement('cadle-actions')
export class CadleActions extends LiteElement {
  @property({ type: Boolean }) accessor snap = true
  @property({ type: Boolean }) accessor measurements = false
  @property({ type: String }) accessor currentAction = ''
  @property({ type: Boolean }) accessor isNativeRoute = false
  static styles = [styles]

  firstRender(): void {
    const sh = window.cadleShell
    this.snap = !sh?.freeDraw
    this.measurements = !!sh?.showMeasurements
    this.currentAction = sh?.action ?? ''
    this.isNativeRoute = location.hash.includes('#!/native-draw')
    pubsub.subscribe('shell.snap', this.#onSnap)
    pubsub.subscribe('shell.measurements', this.#onMeasurements)
    pubsub.subscribe('shell.action', this.#onAction)
    window.addEventListener('hashchange', this.#onHashChange)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.snap', this.#onSnap)
    pubsub.unsubscribe('shell.measurements', this.#onMeasurements)
    pubsub.unsubscribe('shell.action', this.#onAction)
    window.removeEventListener('hashchange', this.#onHashChange)
  }

  #onSnap = (value: boolean) => {
    this.snap = !!value
  }

  #onMeasurements = (value: boolean) => {
    this.measurements = !!value
  }

  #onAction = (value: string) => {
    this.currentAction = value ?? ''
  }

  #onHashChange = () => {
    this.isNativeRoute = location.hash.includes('#!/native-draw')
  }

  drawText = () => {
    const sh = window.cadleShell
    if (!sh) return
    sh.action = 'draw-text'
  }

  #undo = () => window.cadleShell?.undo?.()
  #redo = () => window.cadleShell?.redo?.()
  #toggleSnap = () => {
    const sh = window.cadleShell
    if (sh) sh.freeDraw = !sh.freeDraw
  }

  #toggleMeasurements = () => {
    const sh = window.cadleShell
    if (sh) sh.showMeasurements = !sh.showMeasurements
  }

  #pickTool = (tool: DrawTool) => {
    const sh = window.cadleShell
    if (!sh) return
    sh.action = tool.action
  }

  #isToolActive(tool: DrawTool) {
    if (tool.action === '') return !this.currentAction || this.currentAction === 'select'
    return this.currentAction === tool.action
  }

  #visibleTools(): DrawTool[] {
    return DRAW_TOOLS.filter((t) => {
      if (this.isNativeRoute && t.classicOnly) return false
      if (!this.isNativeRoute && t.nativeOnly) return false
      return true
    })
  }

  render() {
    return html`
      <button
        class="tool"
        title="Undo"
        aria-label="Undo"
        @click=${this.#undo}>
        <custom-icon icon="undo"></custom-icon>
      </button>
      <button
        class="tool"
        title="Redo"
        aria-label="Redo"
        @click=${this.#redo}>
        <custom-icon icon="redo"></custom-icon>
      </button>
      <flex-it></flex-it>
      ${map(
        this.#visibleTools(),
        (tool) => html`
          <button
            class="tool"
            title=${tool.title}
            aria-label=${tool.title}
            ?active=${this.#isToolActive(tool)}
            @click=${() => this.#pickTool(tool)}>
            <custom-icon icon=${tool.icon}></custom-icon>
          </button>
        `
      )}
      <flex-it></flex-it>
      <button
        class="tool"
        title="Snap to grid"
        aria-label="Snap to grid"
        ?active=${this.snap}
        @click=${this.#toggleSnap}>
        <custom-icon icon=${this.snap ? 'grid_on' : 'grid_off'}></custom-icon>
      </button>
      <button
        class="tool"
        title="Toggle measurements"
        aria-label="Toggle measurements"
        ?active=${this.measurements}
        @click=${this.#toggleMeasurements}>
        <custom-icon icon="measuring_tape"></custom-icon>
      </button>
    `
  }
}
