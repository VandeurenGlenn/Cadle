import { LiteElement, html, property, customElement, listen } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/it.js'
import pubsub from '../../pubsub.js'
import styles from './actions.css' with { type: 'css' }

declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions
  }
}
type DrawTool = { action: string; icon: string; title: string; nativeOnly?: boolean; classicOnly?: boolean }
const DRAW_TOOLS: DrawTool[] = [
  { action: 'select', icon: 'arrow_selector_tool', title: 'Select' },
  { action: 'draw-wall', icon: 'polyline', title: 'Draw wall' },
  { action: 'draw-room', icon: 'pentagon', title: 'Draw room' },
  { action: 'draw-door', icon: 'door_front', title: 'Draw door' },
  { action: 'draw-gate', icon: 'fence', title: 'Draw gate' },
  { action: 'draw-window', icon: 'window', title: 'Draw window' },
  { action: 'draw-line', icon: 'horizontal_rule', title: 'Draw line' },
  { action: 'draw-square', icon: 'square', title: 'Draw box' },
  { action: 'draw-circle', icon: 'radio_button_unchecked', title: 'Draw circle' },
  { action: 'draw-arc', icon: 'line_curve', title: 'Draw arc' },
  { action: 'draw-text', icon: 'insert_text', title: 'Insert text' },
  { action: 'draw-symbol', icon: 'category', title: 'Place symbol' }
]
@customElement('cadle-actions')
export class CadleActions extends LiteElement {
  @property({ type: String, attribute: 'page-type' }) accessor pageType = 'groundplan'
  @property({ type: Boolean }) accessor toolsOpen = false
  @property({ type: Boolean }) accessor canUndo = false
  @property({ type: Boolean }) accessor canRedo = false
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
    this.isNativeRoute = location.hash.includes('#!/editor/model')
    pubsub.subscribe('shell.snap', this.#onSnap)
    pubsub.subscribe('shell.measurements', this.#onMeasurements)
    pubsub.subscribe('shell.action', this.#onAction)
    pubsub.subscribe('editor.controls.state', this.#onControlsState)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('shell.snap', this.#onSnap)
    pubsub.unsubscribe('shell.measurements', this.#onMeasurements)
    pubsub.unsubscribe('shell.action', this.#onAction)
    pubsub.unsubscribe('editor.controls.state', this.#onControlsState)
  }

  #onControlsState = (state: { canUndo?: boolean; canRedo?: boolean }) => {
    this.canUndo = Boolean(state.canUndo)
    this.canRedo = Boolean(state.canRedo)
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

  @listen('hashchange', { target: 'window' })
  onHashChange() {
    this.isNativeRoute = location.hash.includes('#!/editor/model')
  }

  drawText = () => {
    const sh = window.cadleShell
    if (!sh) return
    sh.action = 'draw-text'
  }

  #undo = () => window.cadleShell?.undo?.()
  #redo = () => window.cadleShell?.redo?.()
  #toggleMeasurements = () => {
    const sh = window.cadleShell
    if (sh) sh.showMeasurements = !sh.showMeasurements
  }

  #pickTool = (tool: DrawTool) => {
    const sh = window.cadleShell
    if (!sh) return
    sh.action = tool.action
    this.shadowRoot?.querySelector<HTMLElement>('#drawing-tools')?.hidePopover()
  }

  #isToolActive(tool: DrawTool) {
    if (tool.action === 'select') return !this.currentAction || this.currentAction === 'select'
    return this.currentAction === tool.action
  }

  #visibleTools(): DrawTool[] {
    return DRAW_TOOLS.filter((t) => {
      if (this.isNativeRoute && t.classicOnly) return false
      if (!this.isNativeRoute && t.nativeOnly) return false
      return true
    })
  }

  #toolButton(tool: DrawTool, menu = false) {
    return html`<button type="button" class=${menu ? 'tool menu-tool' : 'tool'}
      title=${tool.title} aria-label=${tool.title}
      aria-pressed=${this.#isToolActive(tool) ? 'true' : 'false'}
      ?active=${this.#isToolActive(tool)} @click=${() => this.#pickTool(tool)}>
      <custom-icon icon=${tool.icon}></custom-icon>
      ${menu ? html`<span>${tool.title}</span>${this.#isToolActive(tool) ? html`<custom-icon class="tool-check" icon="check"></custom-icon>` : ''}` : ''}
    </button>`
  }

  #openTools = (event: MouseEvent) => {
    const trigger = event.currentTarget as HTMLElement
    const menu = this.shadowRoot?.querySelector<HTMLElement>('#drawing-tools')
    if (!menu) return
    if (menu.matches(':popover-open')) { menu.hidePopover(); return }
    const rect = trigger.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 256))}px`
    menu.style.top = `${rect.bottom + 8}px`
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`
    menu.showPopover({ source: trigger })
    if (!event.detail) menu.querySelector<HTMLButtonElement>('button')?.focus()
  }

  @listen('resize', { target: 'window' })
  closeToolsOnResize() {
    this.shadowRoot?.querySelector<HTMLElement>('#drawing-tools')?.hidePopover()
  }

  render() {
    const tools = this.#visibleTools()
    const oneWire = this.pageType === 'onewire'
    const planTools = tools.filter((tool) => ['draw-wall', 'draw-room', 'draw-door', 'draw-window', 'draw-gate'].includes(tool.action))
    const extraTools = tools.filter((tool) => tool.action !== 'select' && !['draw-text', 'draw-symbol'].includes(tool.action) &&
      (oneWire || !planTools.includes(tool)))
    const extraActive = extraTools.find((tool) => this.#isToolActive(tool))
    return html`
      <div class="tool-group history-tools" role="group" aria-label="Undo and redo">
        <button type="button" class="tool" title="Undo (⌘/Ctrl Z)" aria-label="Undo" ?disabled=${this.isNativeRoute && !this.canUndo} @click=${this.#undo}>
          <custom-icon icon="undo"></custom-icon>
        </button>
        <button type="button" class="tool" title="Redo (⌘/Ctrl Shift Z)" aria-label="Redo" ?disabled=${this.isNativeRoute && !this.canRedo} @click=${this.#redo}>
          <custom-icon icon="redo"></custom-icon>
        </button>
      </div>
      <div class="tool-group selection-tools" role="group" aria-label="Selection">
        ${this.#toolButton(tools.find((tool) => tool.action === 'select')!)}
      </div>
      <slot></slot>
      ${!oneWire ? html`<div class="tool-group" role="group" aria-label="Floor plan tools">
        ${planTools.map((tool) => this.#toolButton(tool))}
      </div>` : ''}
      <div class="tool-group drawing-tools" role="group" aria-label="Drawing and annotations">
        ${tools.filter((tool) => ['draw-text', 'draw-symbol'].includes(tool.action)).map((tool) => this.#toolButton(tool))}
        <button type="button" class="tool more-tools" title=${extraActive ? `Drawing tools · ${extraActive.title}` : 'More drawing tools'}
          aria-label="More drawing tools" aria-expanded=${this.toolsOpen ? 'true' : 'false'} aria-controls="drawing-tools"
          ?active=${Boolean(extraActive)} @click=${this.#openTools}>
          <custom-icon icon=${extraActive?.icon ?? 'more_vert'}></custom-icon>
          <custom-icon class="menu-chevron" icon="keyboard_arrow_down"></custom-icon>
        </button>
      </div>
      <div class="tool-group view-tools" role="group" aria-label="Drawing aids">
        <button type="button" class="tool" title="Toggle measurements" aria-label="Toggle measurements"
          aria-pressed=${this.measurements ? 'true' : 'false'} ?active=${this.measurements} @click=${this.#toggleMeasurements}>
          <custom-icon icon="measuring_tape"></custom-icon>
        </button>
      </div>
      <div id="drawing-tools" class="tool-popover" popover="auto" aria-label="Drawing tools"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          this.shadowRoot?.querySelector<HTMLElement>('#drawing-tools')?.hidePopover()
          requestAnimationFrame(() => this.shadowRoot?.querySelector<HTMLButtonElement>('.more-tools')?.focus())
        }}
        @toggle=${(event: ToggleEvent) => { this.toolsOpen = event.newState === 'open' }}>
        <div class="popover-heading">Drawing tools</div>
        ${extraTools.map((tool) => this.#toolButton(tool, true))}
      </div>
    `
  }
}
