import { LiteElement, html, property, customElement } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/it.js'
import { Textbox } from 'fabric'
import state from '../../state.js'
import { field, positionObject, shell } from '../../utils.js'
import pubsub from '../../pubsub.js'
import styles from './actions.css' with { type: 'css' }
import { map } from '@vandeurenglenn/lite/map.js'

declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions
  }
}
type DrawTool = { action: string; icon: string; title: string }
const DRAW_TOOLS: DrawTool[] = [
  { action: 'select', icon: 'arrow_selector_tool', title: 'Select' },
  { action: 'resize', icon: 'open_with', title: 'Resize' },
  { action: 'draw-wall', icon: 'polyline', title: 'Draw wall' },
  { action: 'draw-door', icon: 'door_front', title: 'Draw door' },
  { action: 'draw-gate', icon: 'fence', title: 'Draw gate' },
  { action: 'draw-window', icon: 'window', title: 'Draw window' },
  { action: 'draw-line', icon: 'horizontal_rule', title: 'Draw line' },
  { action: 'draw-cable', icon: 'polyline', title: 'Draw cable route' },
  { action: 'draw-circle', icon: 'circle', title: 'Draw circle' },
  { action: 'draw-arc', icon: 'arc', title: 'Draw arc' },
  { action: 'draw-square', icon: 'square', title: 'Draw box' },
  { action: 'draw', icon: 'draw', title: 'Freedraw' }
]
@customElement('cadle-actions')
export class CadleActions extends LiteElement {
  @property({ type: Boolean }) accessor snap = true
  @property({ type: Boolean }) accessor measurements = false
  @property({ type: String }) accessor currentAction = ''
  static styles = [styles]

  firstRender(): void {
    const sh = window.cadleShell
    this.snap = !sh?.freeDraw
    this.measurements = !!sh?.showMeasurements
    this.currentAction = sh?.action ?? ''
    pubsub.subscribe('shell.snap', this.#onSnap)
    pubsub.subscribe('shell.measurements', this.#onMeasurements)
    pubsub.subscribe('shell.action', this.#onAction)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.snap', this.#onSnap)
    pubsub.unsubscribe('shell.measurements', this.#onMeasurements)
    pubsub.unsubscribe('shell.action', this.#onAction)
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

  drawText = () => {
    shell.action = 'draw-text'
    const { left, top } = positionObject()
    field._current = new Textbox(state.text.current, {
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      controls: false,
      left,
      top
    })
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
        DRAW_TOOLS,
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
      <button
        class="tool"
        title="Insert text"
        aria-label="Insert text"
        ?active=${this.currentAction === 'draw-text'}
        @click=${this.drawText}>
        <custom-icon icon="insert_text"></custom-icon>
      </button>
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
