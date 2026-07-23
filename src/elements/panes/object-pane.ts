import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import pubsub from '../../pubsub.js'
import styles from './object-pane.css' with { type: 'css' }
import { buildKlemmenlijstTSV, buildLabelSheetHTML, downloadText } from './../../helpers/panel-labels.js'
import type { PanelLabelRow } from '../../helpers/panel-labels.js'
import '../header.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/lite-elements/icon.js'

type BindingLabelSide = 'auto' | 'left' | 'right' | 'top' | 'bottom'

type SymbolTextField = {
  key: string
  label: string
  value: string
}

const SYSTEM_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana',
  'Trebuchet MS',
  'Comic Sans MS',
  'Impact',
  'Palatino Linotype',
  'Lucida Console',
  'Tahoma',
  'Lucida Grande',
  'Segoe UI',
  'Calibri',
  'Menlo',
  'Monaco',
  'Consolas'
]

const GOOGLE_FONTS_URL = 'https://fonts.google.com'

const inferBindingLabelSide = (offset: { x: number; y: number } | null): BindingLabelSide => {
  if (!offset) return 'auto'
  if (Math.abs(offset.x) >= Math.abs(offset.y)) return offset.x < 0 ? 'left' : 'right'
  return offset.y < 0 ? 'top' : 'bottom'
}

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

  @property({ type: String, attribute: false })
  private accessor _nativeText = ''

  @property({ attribute: false })
  private accessor _nativeSymbolTextFields: SymbolTextField[] = []

  @property({ type: Boolean, attribute: false })
  private accessor _nativeCanFlip = false

  @property({ type: Boolean, attribute: false })
  private accessor _nativeFlipSide = false

  @property({ type: Number, attribute: false })
  private accessor _nativeRotation: number | null = null

  @property({ type: Number, attribute: false })
  private accessor _nativeScale: number | null = null

  @property({ type: Boolean, attribute: false })
  private accessor _nativeFlipX: boolean | null = null

  @property({ type: Boolean, attribute: false })
  private accessor _nativeFlipY: boolean | null = null

  @property({ type: String, attribute: false })
  private accessor _nativeFill = ''

  @property({ type: String, attribute: false })
  private accessor _nativeStroke = ''

  @property({ type: Number, attribute: false })
  private accessor _nativeStrokeWidth: number | null = null

  @property({ type: Boolean, attribute: false })
  private accessor _nativeCanSetStrokeWidth = false

  @property({ type: Number, attribute: false })
  private accessor _nativeX: number | null = null

  @property({ type: Number, attribute: false })
  private accessor _nativeY: number | null = null

  @property({ type: String, attribute: false })
  private accessor _nativeFontFamily = ''

  @property({ type: Number, attribute: false })
  private accessor _nativeLetterSpacing: number | null = null

  @property({ type: String, attribute: false })
  private accessor _nativeBindingLabelSide: BindingLabelSide = 'right'

  @query('.native-binding-input')
  private accessor _nativeBindingInput!: HTMLInputElement

  static styles = [styles]

  connectedCallback(): void {
    super.connectedCallback()
    pubsub.subscribe('native.selection.changed', this.#onNativeSelectionChanged)
    pubsub.subscribe('native.binding.focus-input', this.#focusBindingInput)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    pubsub.unsubscribe('native.selection.changed', this.#onNativeSelectionChanged)
    pubsub.unsubscribe('native.binding.focus-input', this.#focusBindingInput)
    this.#cancelBindingSave()
  }

  #focusBindingInput = () => {
    if (this._selectionCount === 0) return
    requestAnimationFrame(() => {
      const input = this._nativeBindingInput
      if (!input) return
      input.focus()
      input.select()
    })
  }

  #onNativeSelectionChanged = (payload: {
    selectionCount?: number
    shape?: {
      id?: string
      kind?: string
      text?: string
      path?: string
      symbolTextFields?: SymbolTextField[]
      bindingId?: string
      name?: string
      canFlip?: boolean
      flipSide?: boolean
      flipX?: boolean
      flipY?: boolean
      rotation?: number
      scale?: number
      fill?: string
      stroke?: string
      canSetStrokeWidth?: boolean
      strokeWidth?: number
      fontFamily?: string
      letterSpacing?: number
      x?: number
      y?: number
      bindingLabelOffset?: { x: number; y: number }
    }
  }) => {
    this.#cancelBindingSave()
    this._selectionCount = Number.isFinite(payload?.selectionCount) ? Number(payload.selectionCount) : 0
    if (!payload?.shape) {
      this._activeObjectLabel = this._selectionCount > 1 ? 'Multiple objects selected' : 'No selection'
      this._nativeSelectedId = ''
      this._nativeSelectedKind = ''
      if (this._selectionCount === 0) this._nativeBindingId = ''
      this._nativeName = ''
      this._nativeText = ''
      this._nativeCanFlip = false
      this._nativeFlipSide = false
      this._nativeSymbolTextFields = []
      this._nativeFlipX = null
      this._nativeFlipY = null
      this._nativeRotation = null
      this._nativeScale = null
      this._nativeFill = ''
      this._nativeStroke = ''
      this._nativeCanSetStrokeWidth = false
      this._nativeStrokeWidth = null
      this._nativeX = null
      this._nativeY = null
      this._nativeFontFamily = ''
      this._nativeLetterSpacing = null
      this._nativeBindingLabelSide = 'auto'
      return
    }

    const kind = typeof payload.shape.kind === 'string' ? payload.shape.kind : 'shape'
    this._nativeSelectedId = typeof payload.shape.id === 'string' ? payload.shape.id : ''
    this._nativeSelectedKind = kind
    this._nativeBindingId = typeof payload.shape.bindingId === 'string' ? payload.shape.bindingId : ''
    this._nativeName = typeof payload.shape.name === 'string' ? payload.shape.name : ''
    this._nativeText = typeof payload.shape.text === 'string' ? payload.shape.text : ''
    this._nativeSymbolTextFields = Array.isArray(payload.shape.symbolTextFields)
      ? payload.shape.symbolTextFields
          .filter(
            (field): field is SymbolTextField =>
              Boolean(field) &&
              typeof field === 'object' &&
              typeof field.key === 'string' &&
              typeof field.label === 'string' &&
              typeof field.value === 'string'
          )
          .map((field) => ({ ...field }))
      : []
    this._nativeCanFlip = payload.shape.canFlip === true
    this._nativeFlipSide = payload.shape.flipSide === true
    this._nativeFlipX = typeof payload.shape.flipX === 'boolean' ? payload.shape.flipX : null
    this._nativeFlipY = typeof payload.shape.flipY === 'boolean' ? payload.shape.flipY : null
    this._nativeRotation = typeof payload.shape.rotation === 'number' ? payload.shape.rotation : null
    this._nativeScale =
      typeof payload.shape.scale === 'number' && Number.isFinite(payload.shape.scale) ? payload.shape.scale : null
    this._nativeFill = typeof payload.shape.fill === 'string' ? payload.shape.fill : ''
    this._nativeStroke = typeof payload.shape.stroke === 'string' ? payload.shape.stroke : ''
    this._nativeCanSetStrokeWidth = payload.shape.canSetStrokeWidth === true
    this._nativeStrokeWidth =
      typeof payload.shape.strokeWidth === 'number' && Number.isFinite(payload.shape.strokeWidth)
        ? payload.shape.strokeWidth
        : null
    this._nativeX = typeof payload.shape.x === 'number' && Number.isFinite(payload.shape.x) ? payload.shape.x : null
    this._nativeY = typeof payload.shape.y === 'number' && Number.isFinite(payload.shape.y) ? payload.shape.y : null
    this._nativeFontFamily = typeof payload.shape.fontFamily === 'string' ? payload.shape.fontFamily : ''
    this._nativeLetterSpacing =
      typeof payload.shape.letterSpacing === 'number' && Number.isFinite(payload.shape.letterSpacing)
        ? payload.shape.letterSpacing
        : null
    this._nativeBindingLabelSide = inferBindingLabelSide(payload.shape.bindingLabelOffset ?? null)
    this._activeObjectLabel = kind.charAt(0).toUpperCase() + kind.slice(1)
  }

  #onBindingLabelSideChange = (event: Event) => {
    const target = event.target as HTMLSelectElement | null
    const value = target?.value
    if (value !== 'auto' && value !== 'left' && value !== 'right' && value !== 'top' && value !== 'bottom') return
    this._nativeBindingLabelSide = value
    pubsub.publish('native.object.update', { bindingLabelSide: value })
  }

  #setBindingLabelSide = (side: BindingLabelSide) => {
    this._nativeBindingLabelSide = side
    pubsub.publish('native.object.update', { bindingLabelSide: side })
  }

  #bindingSaveTimer: ReturnType<typeof setTimeout> | null = null

  #onNativeBindingInput = (event: Event) => {
    const target = event.target as HTMLInputElement | null
    const value = (target?.value ?? '').trim().toUpperCase()
    this._nativeBindingId = value
    if (this.#bindingSaveTimer !== null) clearTimeout(this.#bindingSaveTimer)
    this.#bindingSaveTimer = setTimeout(() => {
      this.#bindingSaveTimer = null
      this.#saveNativeBinding()
    }, 350)
  }

  #cancelBindingSave = () => {
    if (this.#bindingSaveTimer === null) return
    clearTimeout(this.#bindingSaveTimer)
    this.#bindingSaveTimer = null
  }

  #saveNativeBinding = () => {
    this.#cancelBindingSave()
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

  #onScaleInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 1)
    if (!Number.isFinite(raw)) return
    const next = Math.max(0.1, Math.min(20, raw))
    this._nativeScale = next
    pubsub.publish('native.object.update', { scale: next })
  }

  #onTextInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeText = input?.value ?? ''
    pubsub.publish('native.object.update', { text: this._nativeText })
  }

  #onSymbolTextInput = (key: string, value: string) => {
    this._nativeSymbolTextFields = this._nativeSymbolTextFields.map((field) =>
      field.key === key ? { ...field, value } : field
    )
    const symbolTextOverrides = Object.fromEntries(
      this._nativeSymbolTextFields
        .map((field) => [field.key, field.value] as const)
        .filter((entry) => typeof entry[0] === 'string' && Boolean(entry[0]) && typeof entry[1] === 'string')
    )
    pubsub.publish('native.object.update', { symbolTextOverrides })
  }

  #toggleFlipX = () => {
    const next = !(this._nativeFlipX === true)
    this._nativeFlipX = next
    pubsub.publish('native.object.update', { flipX: next })
  }

  #toggleFlipY = () => {
    const next = !(this._nativeFlipY === true)
    this._nativeFlipY = next
    pubsub.publish('native.object.update', { flipY: next })
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

  #onStrokeWidthInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    const next = Math.max(0.5, Math.min(40, raw))
    this._nativeStrokeWidth = next
    pubsub.publish('native.object.update', { strokeWidth: next })
  }

  #onXInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeX = raw
    pubsub.publish('native.object.update', { x: raw })
  }

  #onYInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeY = raw
    pubsub.publish('native.object.update', { y: raw })
  }

  #onFontFamilyInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeFontFamily = input?.value ?? ''
    pubsub.publish('native.object.update', { fontFamily: this._nativeFontFamily })
  }

  #onLetterSpacingInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeLetterSpacing = raw
    pubsub.publish('native.object.update', { letterSpacing: raw })
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
                <span>Id</span>
                <span
                  class="native-mono native-kv-value native-kv-truncate"
                  title=${this._nativeSelectedId || '-'}
                  >${this._nativeSelectedId || '-'}</span
                >
              </div>
              ${this._nativeName
                ? html`<div class="native-kv">
                    <span>Name</span>
                    <span
                      class="native-kv-value native-kv-truncate"
                      title=${this._nativeName}
                      >${this._nativeName}</span
                    >
                  </div>`
                : ''}
            `}
        <label class="native-label">Binding ID</label>
        <input
          class="native-input native-binding-input"
          .value=${this._nativeBindingId}
          maxlength="24"
          @input=${this.#onNativeBindingInput}
          @change=${this.#saveNativeBinding}
          placeholder="e.g. Q1" />
        <label class="native-label">Label position</label>
        <div
          class="native-chip-row"
          role="radiogroup"
          aria-label="Label position">
          <button
            type="button"
            class="native-chip"
            data-active=${this._nativeBindingLabelSide === 'auto' ? 'true' : 'false'}
            @click=${() => this.#setBindingLabelSide('auto')}>
            Auto
          </button>
          <button
            type="button"
            class="native-chip"
            data-active=${this._nativeBindingLabelSide === 'left' ? 'true' : 'false'}
            @click=${() => this.#setBindingLabelSide('left')}>
            Left
          </button>
          <button
            type="button"
            class="native-chip"
            data-active=${this._nativeBindingLabelSide === 'right' ? 'true' : 'false'}
            @click=${() => this.#setBindingLabelSide('right')}>
            Right
          </button>
          <button
            type="button"
            class="native-chip"
            data-active=${this._nativeBindingLabelSide === 'top' ? 'true' : 'false'}
            @click=${() => this.#setBindingLabelSide('top')}>
            Top
          </button>
          <button
            type="button"
            class="native-chip"
            data-active=${this._nativeBindingLabelSide === 'bottom' ? 'true' : 'false'}
            @click=${() => this.#setBindingLabelSide('bottom')}>
            Bottom
          </button>
        </div>
        ${this._nativeX !== null && this._nativeY !== null
          ? html`
              <label class="native-label">Position</label>
              <div class="native-row">
                <span class="native-unit">X</span>
                <input
                  type="number"
                  class="native-input native-input-sm"
                  step="1"
                  .value=${String(Math.round(this._nativeX))}
                  @change=${this.#onXInput} />
                <span class="native-unit">Y</span>
                <input
                  type="number"
                  class="native-input native-input-sm"
                  step="1"
                  .value=${String(Math.round(this._nativeY))}
                  @change=${this.#onYInput} />
              </div>
            `
          : ''}
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
        ${this._nativeScale !== null
          ? html`
              <label class="native-label">Scale</label>
              <div class="native-row">
                <input
                  type="number"
                  class="native-input native-input-sm"
                  min="0.1"
                  max="20"
                  step="0.1"
                  .value=${String(this._nativeScale)}
                  @change=${this.#onScaleInput} />
                <span class="native-unit">x</span>
              </div>
            `
          : ''}
        ${this._nativeSelectedKind === 'text'
          ? html`
              <label class="native-label">Text</label>
              <input
                type="text"
                class="native-input"
                .value=${this._nativeText}
                @input=${this.#onTextInput}
                placeholder="Label" />
              <label class="native-label">Font family</label>
              <div class="native-row">
                <select
                  class="native-input native-select"
                  .value=${this._nativeFontFamily}
                  @change=${(event: Event) => {
                    const select = event.target as HTMLSelectElement | null
                    if (!select) return
                    const value = select.value
                    if (value === '__import__') {
                      window.open(GOOGLE_FONTS_URL, '_blank')
                      select.value = this._nativeFontFamily
                    } else {
                      this._nativeFontFamily = value
                      pubsub.publish('native.object.update', { fontFamily: value })
                    }
                  }}>
                  <option value="">—</option>
                  ${SYSTEM_FONTS.map((font) => html`<option value=${font}>${font}</option>`)}
                  <option
                    value="__import__"
                    style="font-style: italic;">
                    + Import from Google Fonts
                  </option>
                </select>
              </div>
              <input
                type="text"
                class="native-input"
                .value=${this._nativeFontFamily}
                @input=${this.#onFontFamilyInput}
                placeholder="Custom font (e.g. 'Open Sans')" />
              ${this._nativeLetterSpacing !== null
                ? html`
                    <label class="native-label">Letter spacing</label>
                    <div class="native-row">
                      <input
                        type="number"
                        class="native-input native-input-sm"
                        min="-10"
                        max="10"
                        step="0.1"
                        .value=${String(this._nativeLetterSpacing)}
                        @change=${this.#onLetterSpacingInput} />
                      <span class="native-unit">px</span>
                    </div>
                  `
                : ''}
            `
          : ''}
        ${this._nativeSelectedKind === 'symbol' && this._nativeSymbolTextFields.length > 0
          ? html`
              <label class="native-label">Symbol text fields</label>
              ${this._nativeSymbolTextFields.map(
                (field) => html`
                  <div class="native-kv"><span>${field.label}</span></div>
                  <input
                    type="text"
                    class="native-input"
                    .value=${field.value}
                    @input=${(event: Event) =>
                      this.#onSymbolTextInput(field.key, (event.target as HTMLInputElement | null)?.value ?? '')}
                    placeholder=${field.label} />
                `
              )}
            `
          : ''}
        ${this._nativeFlipX !== null || this._nativeFlipY !== null
          ? html`
              <label class="native-label">Flip</label>
              <div class="native-row">
                ${this._nativeFlipX !== null
                  ? html`<button
                      type="button"
                      class="native-btn-icon"
                      title="Flip horizontally"
                      data-active=${this._nativeFlipX ? 'true' : 'false'}
                      @click=${this.#toggleFlipX}>
                      ⇋
                    </button>`
                  : ''}
                ${this._nativeFlipY !== null
                  ? html`<button
                      type="button"
                      class="native-btn-icon"
                      title="Flip vertically"
                      data-active=${this._nativeFlipY ? 'true' : 'false'}
                      @click=${this.#toggleFlipY}>
                      ⇵
                    </button>`
                  : ''}
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
        ${this._nativeCanSetStrokeWidth && this._nativeStrokeWidth !== null
          ? html`
              <label class="native-label">Line thickness</label>
              <div class="native-row">
                <input
                  type="number"
                  class="native-input native-input-sm"
                  min="0.1"
                  max="40"
                  step="0.01"
                  .value=${String(this._nativeStrokeWidth)}
                  @change=${this.#onStrokeWidthInput} />
                <span class="native-unit">px</span>
              </div>
            `
          : ''}
        <div class="native-actions">
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
    return html`${this.#renderNativeSelection()}`
  }

  exportPanelLabels() {
    const groups: Array<{
      bindingId: string
      letter?: string
      number?: number
      wireSection?: string
      breakerAmperage?: number
      switches?: number
      loads?: number
      ready?: boolean
    }> = []
    // Map draw.ts group objects to PanelLabelRow[]
    const rows: PanelLabelRow[] = groups.map((g) => ({
      bindingId: g.bindingId,
      letter: g.letter ?? '',
      number: g.number ?? 0,
      description: '',
      wireSection: (g.wireSection ?? '2.5') as PanelLabelRow['wireSection'],
      breakerAmperage: g.breakerAmperage ?? 0,
      switches: g.switches ?? 0,
      loads: g.loads ?? 0,
      ready: g.ready ?? false
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
