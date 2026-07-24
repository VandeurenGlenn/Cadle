import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import pubsub from '../../pubsub.js'
import styles from './object-pane.css' with { type: 'css' }
import { buildKlemmenlijstTSV, buildLabelSheetHTML, downloadText } from './../../helpers/panel-labels.js'
import type { PanelLabelRow } from '../../helpers/panel-labels.js'
import { normalizeSelection, type BindingLabelSide, type SelectionPayload, type SelectionShapeElectrical, type SymbolTextField } from './object-pane/selection-model.js'
import { GOOGLE_FONTS_URL, SYSTEM_FONTS } from './object-pane/text-options.js'
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

  @property({ attribute: false })
  private accessor _nativeElectrical: SelectionShapeElectrical | null = null

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

  #onNativeSelectionChanged = (payload: SelectionPayload) => {
    this.#cancelBindingSave()
    const selection = normalizeSelection(payload)
    this._selectionCount = selection.selectionCount
    if (!selection.shape) {
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
      this._nativeElectrical = null
      return
    }

    const shape = selection.shape
    this._nativeSelectedId = shape.id
    this._nativeSelectedKind = shape.kind
    this._nativeBindingId = shape.bindingId
    this._nativeName = shape.name
    this._nativeText = shape.text
    this._nativeSymbolTextFields = shape.symbolTextFields
    this._nativeCanFlip = shape.canFlip
    this._nativeFlipSide = shape.flipSide
    this._nativeFlipX = shape.flipX
    this._nativeFlipY = shape.flipY
    this._nativeRotation = shape.rotation
    this._nativeScale = shape.scale
    this._nativeFill = shape.fill
    this._nativeStroke = shape.stroke
    this._nativeCanSetStrokeWidth = shape.canSetStrokeWidth
    this._nativeStrokeWidth = shape.strokeWidth
    this._nativeX = shape.x
    this._nativeY = shape.y
    this._nativeFontFamily = shape.fontFamily
    this._nativeLetterSpacing = shape.letterSpacing
    this._nativeBindingLabelSide = shape.bindingLabelSide
    this._nativeElectrical = shape.electrical
    this._activeObjectLabel = shape.label
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

  #updateElectrical = (field: keyof SelectionShapeElectrical, value: string) => {
    const numericFields = new Set(['breakerCurrentA', 'cableSectionMm2', 'poles', 'rcdSensitivityMa'])
    const parsed = numericFields.has(field) ? (value.trim() ? Number(value) : null) : value || null
    if (typeof parsed === 'number' && (!Number.isFinite(parsed) || parsed <= 0)) return
    this._nativeElectrical = { ...(this._nativeElectrical ?? {}), [field]: parsed ?? undefined }
    pubsub.publish('native.object.update', { electrical: { [field]: parsed } })
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
        ${!multiple && this._nativeSelectedKind === 'symbol'
          ? html`
              <div class="native-section-title">Circuit properties</div>
              <label class="native-label">Role</label>
              <select class="native-select" .value=${this._nativeElectrical?.role ?? ''} @change=${(event: Event) => this.#updateElectrical('role', (event.target as HTMLSelectElement).value)}>
                <option value="">Not classified</option><option value="switch">Switch</option><option value="load">Load</option><option value="protection">Protection</option><option value="junction">Junction</option><option value="neutral">Other</option>
              </select>
              <label class="native-label">Circuit type</label>
              <select class="native-select" .value=${this._nativeElectrical?.circuitType ?? ''} @change=${(event: Event) => this.#updateElectrical('circuitType', (event.target as HTMLSelectElement).value)}>
                <option value="">Infer from symbol</option><option value="lighting">Lighting</option><option value="sockets">Sockets</option><option value="motor">Motor</option><option value="mixed">Mixed</option><option value="other">Other</option>
              </select>
              <div class="native-row">
                <label><span class="native-label">Breaker (A)</span><input class="native-input" type="number" min="1" .value=${String(this._nativeElectrical?.breakerCurrentA ?? '')} @change=${(event: Event) => this.#updateElectrical('breakerCurrentA', (event.target as HTMLInputElement).value)} /></label>
                <label><span class="native-label">Cable (mm²)</span><input class="native-input" type="number" min="0.1" step="0.1" .value=${String(this._nativeElectrical?.cableSectionMm2 ?? '')} @change=${(event: Event) => this.#updateElectrical('cableSectionMm2', (event.target as HTMLInputElement).value)} /></label>
              </div>
              <div class="native-row">
                <label><span class="native-label">Poles</span><input class="native-input" type="number" min="1" step="1" .value=${String(this._nativeElectrical?.poles ?? '')} @change=${(event: Event) => this.#updateElectrical('poles', (event.target as HTMLInputElement).value)} /></label>
                <label><span class="native-label">Phase</span><select class="native-select" .value=${this._nativeElectrical?.phaseConfiguration ?? ''} @change=${(event: Event) => this.#updateElectrical('phaseConfiguration', (event.target as HTMLSelectElement).value)}><option value="">Project default</option><option value="single-phase">Single-phase</option><option value="three-phase">Three-phase</option></select></label>
              </div>
              <div class="native-note">Values apply to this symbol and are used for its bound circuit.</div>
              <div class="native-row">
                <label><span class="native-label">Breaker curve</span><select class="native-select" .value=${this._nativeElectrical?.breakerCurve ?? ''} @change=${(event: Event) => this.#updateElectrical('breakerCurve', (event.target as HTMLSelectElement).value)}><option value="">Not set</option><option value="B">B</option><option value="C">C</option><option value="D">D</option><option value="other">Other</option></select></label>
                <label><span class="native-label">RCD (mA)</span><input class="native-input" type="number" min="1" .value=${String(this._nativeElectrical?.rcdSensitivityMa ?? '')} @change=${(event: Event) => this.#updateElectrical('rcdSensitivityMa', (event.target as HTMLInputElement).value)} /></label>
              </div>
              <div class="native-row">
                <label><span class="native-label">RCD type</span><select class="native-select" .value=${this._nativeElectrical?.rcdType ?? ''} @change=${(event: Event) => this.#updateElectrical('rcdType', (event.target as HTMLSelectElement).value)}><option value="">Not set</option><option value="AC">AC</option><option value="A">A</option><option value="F">F</option><option value="B">B</option><option value="other">Other</option></select></label>
                <label><span class="native-label">Board</span><input class="native-input" .value=${this._nativeElectrical?.boardId ?? ''} @change=${(event: Event) => this.#updateElectrical('boardId', (event.target as HTMLInputElement).value)} placeholder="main" /></label>
              </div>
              <label class="native-label">Rail</label><input class="native-input" .value=${this._nativeElectrical?.railId ?? ''} @change=${(event: Event) => this.#updateElectrical('railId', (event.target as HTMLInputElement).value)} placeholder="rail-1" />
              <label class="native-label">Circuit notes</label><textarea class="native-input" .value=${this._nativeElectrical?.notes ?? ''} @change=${(event: Event) => this.#updateElectrical('notes', (event.target as HTMLTextAreaElement).value)}></textarea>
            `
          : ''}
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
