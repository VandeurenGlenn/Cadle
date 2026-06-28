import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import pubsub from '../../pubsub.js'
import styles from './object-pane.css' with { type: 'css' }
import { buildKlemmenlijstTSV, buildLabelSheetHTML, downloadText } from './../../helpers/panel-labels.js'
import '../header.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/lite-elements/icon.js'
@customElement('object-pane')
export class ObjectPane extends LiteElement {
  @property()
  private accessor _activeObjectLabel = 'No selection'

  @property({ type: Number })
  private accessor _selectionCount = 0

  @property({ type: String, attribute: false })
  private accessor _nativeSelectedId = ''

  @property({ type: String, attribute: false })
  private accessor _nativeSelectedKind = ''

  @property({ type: String, attribute: false })
  private accessor _nativeBindingId = ''

  @property({ type: String, attribute: false })
  private accessor _nativeName = ''

  @property({ type: Boolean, attribute: false })
  private accessor _nativeCanFlip = false

  @property({ type: Boolean, attribute: false })
  private accessor _nativeFlipSide = false

  @property({ type: Number, attribute: false })
  private accessor _nativeRotation: number | null = null

  @property({ type: String, attribute: false })
  private accessor _nativeFill = ''

  @property({ type: String, attribute: false })
  private accessor _nativeStroke = ''

  static styles = [styles]

  connectedCallback(): void {
    super.connectedCallback()
    pubsub.subscribe('native.selection.changed', this.#onNativeSelectionChanged)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    pubsub.unsubscribe('native.selection.changed', this.#onNativeSelectionChanged)
  }

  #onNativeSelectionChanged = (payload: {
    selectionCount?: number
    shape?: {
      id?: string
      kind?: string
      bindingId?: string
      name?: string
      canFlip?: boolean
      flipSide?: boolean
      rotation?: number
      fill?: string
      stroke?: string
    }
  }) => {
    this._selectionCount = Number.isFinite(payload?.selectionCount) ? Number(payload.selectionCount) : 0
    if (!payload?.shape) {
      this._activeObjectLabel = this._selectionCount > 1 ? 'Multiple objects selected' : 'No selection'
      this._nativeSelectedId = ''
      this._nativeSelectedKind = ''
      this._nativeBindingId = ''
      this._nativeName = ''
      this._nativeCanFlip = false
      this._nativeFlipSide = false
      this._nativeRotation = null
      this._nativeFill = ''
      this._nativeStroke = ''
      return
    }

    const kind = typeof payload.shape.kind === 'string' ? payload.shape.kind : 'shape'
    this._nativeSelectedId = typeof payload.shape.id === 'string' ? payload.shape.id : ''
    this._nativeSelectedKind = kind
    this._nativeBindingId = typeof payload.shape.bindingId === 'string' ? payload.shape.bindingId : ''
    this._nativeName = typeof payload.shape.name === 'string' ? payload.shape.name : ''
    this._nativeCanFlip = payload.shape.canFlip === true
    this._nativeFlipSide = payload.shape.flipSide === true
    this._nativeRotation = typeof payload.shape.rotation === 'number' ? payload.shape.rotation : null
    this._nativeFill = typeof payload.shape.fill === 'string' ? payload.shape.fill : ''
    this._nativeStroke = typeof payload.shape.stroke === 'string' ? payload.shape.stroke : ''
    this._activeObjectLabel = kind.charAt(0).toUpperCase() + kind.slice(1)
  }

  #onNativeBindingInput = (event: Event) => {
    const target = event.target as HTMLInputElement | null
    const value = (target?.value ?? '').trim().toUpperCase()
    this._nativeBindingId = value
  }

  #saveNativeBinding = () => {
    if (this._selectionCount === 0) return
    pubsub.publish('native.object.update', {
      bindingId: this._nativeBindingId
    })
  }

  #onRotationInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const value = Number(input?.value ?? 0)
    if (!Number.isFinite(value)) return
    this._nativeRotation = ((value % 360) + 360) % 360
    pubsub.publish('native.object.update', { rotation: this._nativeRotation })
  }

  #rotateBy = (delta: number) => {
    const next = ((((this._nativeRotation ?? 0) + delta) % 360) + 360) % 360
    this._nativeRotation = next
    pubsub.publish('native.object.update', { rotation: next })
  }

  #onFillChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeFill = input?.value ?? ''
    pubsub.publish('native.object.update', { fill: this._nativeFill })
  }

  #clearFill = () => {
    this._nativeFill = ''
    pubsub.publish('native.object.update', { fill: '' })
  }

  #onStrokeChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeStroke = input?.value ?? ''
    pubsub.publish('native.object.update', { stroke: this._nativeStroke })
  }

  #clearStroke = () => {
    this._nativeStroke = ''
    pubsub.publish('native.object.update', { stroke: '' })
  }

  #flipNativeShape = () => {
    if (!this._nativeCanFlip) return
    pubsub.publish('native.object.flip-side', {})
  }

  #deleteNativeSelection = () => {
    if (this._selectionCount === 0) return
    pubsub.publish('native.object.delete', {})
  }

  #renderNativeSelection() {
    const hasSelection = this._selectionCount > 0
    if (!hasSelection) {
      return html`
        <div class="empty-state">
          <div class="empty-card">
            <custom-icon icon="arrow_selector_tool"></custom-icon>
            <span class="empty-title">No selection</span>
            <span class="empty-hint">Select a native object to inspect.</span>
          </div>
        </div>
      `
    }

    const multiple = this._selectionCount > 1
    return html`
      <cadle-header>
        <div class="title">${multiple ? 'Multiple objects selected' : this._activeObjectLabel}</div>
        <div
          class="meta"
          slot="end">
          ${this._selectionCount} selected
        </div>
      </cadle-header>
      <section>
        ${multiple
          ? html`<div class="native-note">Binding updates apply to all selected objects.</div>`
          : html`
              <div class="native-kv"><span>Type</span><strong>${this._nativeSelectedKind || '-'}</strong></div>
              <div class="native-kv">
                <span>Id</span><span class="native-mono">${this._nativeSelectedId || '-'}</span>
              </div>
              ${this._nativeName
                ? html`<div class="native-kv"><span>Name</span><span>${this._nativeName}</span></div>`
                : ''}
            `}
        <label class="native-label">Binding ID</label>
        <input
          class="native-input"
          .value=${this._nativeBindingId}
          maxlength="24"
          @input=${this.#onNativeBindingInput}
          placeholder="e.g. Q1" />
        ${this._nativeRotation !== null
          ? html`
              <label class="native-label">Rotation</label>
              <div class="native-row">
                <button
                  type="button"
                  class="native-btn-icon"
                  title="−90°"
                  @click=${() => this.#rotateBy(-90)}>
                  ↺
                </button>
                <input
                  type="number"
                  class="native-input native-input-sm"
                  min="0"
                  max="359"
                  step="1"
                  .value=${String(Math.round(this._nativeRotation))}
                  @change=${this.#onRotationInput} />
                <span class="native-unit">°</span>
                <button
                  type="button"
                  class="native-btn-icon"
                  title="+90°"
                  @click=${() => this.#rotateBy(90)}>
                  ↻
                </button>
              </div>
            `
          : ''}
        <label class="native-label">Fill color</label>
        <div class="native-row">
          <input
            type="color"
            class="native-color"
            .value=${this._nativeFill || '#000000'}
            @input=${this.#onFillChange} />
          <span class="native-color-value">${this._nativeFill || 'none'}</span>
          ${this._nativeFill
            ? html`<button
                type="button"
                class="native-btn-clear"
                title="Clear fill"
                @click=${this.#clearFill}>
                ✕
              </button>`
            : ''}
        </div>
        <label class="native-label">Border color</label>
        <div class="native-row">
          <input
            type="color"
            class="native-color"
            .value=${this._nativeStroke || '#000000'}
            @input=${this.#onStrokeChange} />
          <span class="native-color-value">${this._nativeStroke || 'none'}</span>
          ${this._nativeStroke
            ? html`<button
                type="button"
                class="native-btn-clear"
                title="Clear border"
                @click=${this.#clearStroke}>
                ✕
              </button>`
            : ''}
        </div>
        <div class="native-actions">
          <button
            type="button"
            class="native-button"
            @click=${this.#saveNativeBinding}>
            Save binding
          </button>
          ${this._nativeCanFlip
            ? html`<button
                type="button"
                class="native-button"
                @click=${this.#flipNativeShape}>
                ${this._nativeFlipSide ? '← Flip back' : 'Flip side →'}
              </button>`
            : ''}
          <button
            type="button"
            class="native-button danger"
            @click=${this.#deleteNativeSelection}>
            Delete
          </button>
        </div>
      </section>
    `
  }

  render() {
    return this.#renderNativeSelection()
  }

  exportPanelLabels() {
    const groups: Array<{
      bindingId: string
      letter?: string
      number?: number
      wireSection?: string
      breakerAmperage?: string
      switches?: number
      loads?: number
      ready?: boolean
    }> = []
    // Map draw.ts group objects to PanelLabelRow[]
    const rows = groups.map((g) => ({
      bindingId: g.bindingId,
      letter: g.letter,
      number: g.number,
      description: '',
      wireSection: g.wireSection,
      breakerAmperage: g.breakerAmperage,
      switches: g.switches,
      loads: g.loads,
      ready: g.ready
    }))
    // Export TSV
    const tsv = buildKlemmenlijstTSV(rows)
    downloadText('panel-klemmenlijst.tsv', tsv, 'text/tab-separated-values')
    // Export printable label sheet (HTML)
    const html = buildLabelSheetHTML(rows, cadleShell?.projectName || 'Project')
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
    }
  }
}
