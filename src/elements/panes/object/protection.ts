import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import { FabricObject } from 'fabric'
import { ProtectionSymbolClassifier } from '../../../helpers/protection-symbol.js'
import styles from './protection.css' with { type: 'css' }
import '@material/web/textfield/filled-text-field.js'
import '@material/web/select/filled-select.js'
import '@material/web/select/select-option.js'
import '../../items/object.js'

type ValueInput = HTMLElement & { value: string }

type ProtectionObject = FabricObject & {
  symbolName?: string
  symbolPath?: string
  type?: string
  breakerAmperageA?: number
  breakerShortCircuitKA?: number
  breakerCurve?: string
  breakerPoles?: number
  breakerLabel?: string
  bindingGroupBreakerAmperage?: number
  rcdResidualCurrentMa?: number
  rcdType?: string
  set: (props: Record<string, unknown>) => FabricObject
}

interface FabricEvent {
  target: FabricObject
}

@customElement('object-protection')
export class ObjectProtection extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active = false

  @property({ type: Boolean, attribute: false })
  private accessor _isProtectionSelection = false

  @property({ type: Boolean, attribute: false })
  private accessor _isResidualSelection = false

  @query('#protection-amp')
  private accessor _ampInput!: ValueInput

  @query('#protection-ika')
  private accessor _ikaInput!: ValueInput

  @query('#protection-curve')
  private accessor _curveInput!: ValueInput

  @query('#protection-poles')
  private accessor _polesInput!: ValueInput

  @query('#protection-rcd-ma')
  private accessor _rcdMaInput!: ValueInput

  @query('#protection-rcd-type')
  private accessor _rcdTypeInput!: ValueInput

  private _selectionHandlersBound = false

  static styles = [styles]

  firstRender(): void {
    this.shadowRoot?.addEventListener('click', this.#onClick)
    this.#ensureCanvasBindings()

    window.addEventListener('cadle-open-protection-pane', this.#openFromEvent as EventListener)
    this.#syncFromCanvas()
  }

  disconnectedCallback(): void {
    const canvas = cadleShell?.field?.canvas
    if (canvas && this._selectionHandlersBound) {
      canvas.off('selection:created', this.#syncFromCanvas)
      canvas.off('selection:updated', this.#syncFromCanvas)
      canvas.off('selection:cleared', this.#syncFromCanvas)
      canvas.off('object:modified', this.#syncFromCanvas)
      this._selectionHandlersBound = false
    }

    window.removeEventListener('cadle-open-protection-pane', this.#openFromEvent as EventListener)
    super.disconnectedCallback()
  }

  #ensureCanvasBindings = () => {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) {
      requestAnimationFrame(this.#ensureCanvasBindings)
      return
    }

    if (!this._selectionHandlersBound) {
      canvas.on('selection:created', this.#syncFromCanvas)
      canvas.on('selection:updated', this.#syncFromCanvas)
      canvas.on('selection:cleared', this.#syncFromCanvas)
      canvas.on('object:modified', this.#syncFromCanvas)
      this._selectionHandlersBound = true
    }

    this.#syncFromCanvas()
  }

  #onClick = (event: Event) => {
    const target = event.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  #openFromEvent = () => {
    this.#syncFromCanvas()
    if (this._isProtectionSelection) {
      this.active = true
      return
    }

    requestAnimationFrame(() => {
      this.#syncFromCanvas()
      if (this._isProtectionSelection) this.active = true
    })
  }

  #collectNestedFabricObjects(object: FabricObject) {
    const group = object as FabricObject & { _objects?: FabricObject[]; objects?: FabricObject[] }
    const nested: FabricObject[] = []
    if (Array.isArray(group._objects)) nested.push(...group._objects)
    if (Array.isArray(group.objects)) nested.push(...group.objects)
    return nested
  }

  #applyProtectionVisualState(
    object: FabricObject,
    amperage: number,
    poles: number,
    curve: string,
    residualMa: number,
    residualType: string,
    isResidual: boolean
  ) {
    const textLikeObject = object as FabricObject & {
      text?: string
      set: (key: string, value: string) => void
    }
    const nested = this.#collectNestedFabricObjects(object)

    for (const child of nested) {
      this.#applyProtectionVisualState(child, amperage, poles, curve, residualMa, residualType, isResidual)
      const typedChild = child as FabricObject & {
        text?: string
        set: (key: string, value: string) => void
      }
      const childText = String(typedChild.text ?? '').trim()
      if (!childText) continue
      const normalized = childText.toLowerCase()

      if (normalized === 'np' || normalized.endsWith('p')) {
        typedChild.set('text', `${poles}P`)
        continue
      }

      if (/^\d+\s*a$/i.test(childText)) {
        typedChild.set('text', `${amperage}A`)
        continue
      }

      if (isResidual && /^\d+\s*ma$/i.test(childText)) {
        typedChild.set('text', `${residualMa}mA`)
        continue
      }

      if (normalized === 'i' && isResidual) {
        typedChild.set('text', residualType)
        continue
      }

      if (
        normalized === 'n' ||
        normalized === 'b' ||
        normalized === 'c' ||
        normalized === 'd' ||
        normalized === 'k' ||
        normalized === 'z'
      ) {
        typedChild.set('text', curve)
      }
    }

    if (!nested.length && typeof textLikeObject.text === 'string') {
      const normalized = textLikeObject.text.trim().toLowerCase()
      if (normalized === 'np' || normalized.endsWith('p')) {
        textLikeObject.set('text', `${poles}P`)
      } else if (/^\d+\s*a$/i.test(textLikeObject.text)) {
        textLikeObject.set('text', `${amperage}A`)
      } else if (isResidual && /^\d+\s*ma$/i.test(textLikeObject.text)) {
        textLikeObject.set('text', `${residualMa}mA`)
      } else if (normalized === 'i' && isResidual) {
        textLikeObject.set('text', residualType)
      } else if (
        normalized === 'n' ||
        normalized === 'b' ||
        normalized === 'c' ||
        normalized === 'd' ||
        normalized === 'k' ||
        normalized === 'z'
      ) {
        textLikeObject.set('text', curve)
      }
    }
  }

  #activeProtectionObjects() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return { canvas: null as typeof canvas, objects: [] as ProtectionObject[] }
    const objects = (canvas.getActiveObjects?.() ?? []).filter((object) =>
      ProtectionSymbolClassifier.isProtectionSymbol(object as FabricObject)
    ) as ProtectionObject[]
    return { canvas, objects }
  }

  #syncFromCanvas = () => {
    const canvas = cadleShell?.field?.canvas
    const activeObjects = (canvas?.getActiveObjects?.() ?? []) as ProtectionObject[]
    const firstProtectionObject =
      activeObjects.find((object) => ProtectionSymbolClassifier.isProtectionSymbol(object as FabricObject)) ?? null
    if (!firstProtectionObject) {
      this._isProtectionSelection = false
      this._isResidualSelection = false
      return
    }

    this._isProtectionSelection = true
    this._isResidualSelection = ProtectionSymbolClassifier.isResidualProtection(firstProtectionObject)

    const amperage = Number(
      firstProtectionObject.breakerAmperageA ?? firstProtectionObject.bindingGroupBreakerAmperage ?? 16
    )
    const shortCircuit = Number(firstProtectionObject.breakerShortCircuitKA ?? 6)
    const curve = String(firstProtectionObject.breakerCurve ?? 'C').toUpperCase()
    const poles = Number(firstProtectionObject.breakerPoles ?? 2)
    const residualMa = Number(firstProtectionObject.rcdResidualCurrentMa ?? 300)
    const residualType = String(firstProtectionObject.rcdType ?? 'AC').toUpperCase()

    if (this._ampInput) this._ampInput.value = String(Number.isFinite(amperage) ? amperage : 16)
    if (this._ikaInput) this._ikaInput.value = String(Number.isFinite(shortCircuit) ? shortCircuit : 6)
    if (this._curveInput) this._curveInput.value = curve
    if (this._polesInput) this._polesInput.value = String(Number.isFinite(poles) ? poles : 2)
    if (this._rcdMaInput) this._rcdMaInput.value = String(Number.isFinite(residualMa) ? residualMa : 300)
    if (this._rcdTypeInput) this._rcdTypeInput.value = residualType
  }

  #applyFormToSelection() {
    const { canvas, objects } = this.#activeProtectionObjects()
    if (!canvas || objects.length === 0) return

    const amperageValue = Number(this._ampInput?.value ?? '16')
    const shortCircuitValue = Number(this._ikaInput?.value ?? '6')
    const polesValue = Number(this._polesInput?.value ?? '2')
    const residualValue = Number(this._rcdMaInput?.value ?? '300')

    const amperage = Math.max(1, Math.round(Number.isFinite(amperageValue) ? amperageValue : 16))
    const shortCircuit = Math.max(1, Number.isFinite(shortCircuitValue) ? shortCircuitValue : 6)
    const poles = Math.max(1, Math.min(4, Math.round(Number.isFinite(polesValue) ? polesValue : 2)))
    const curve =
      String(this._curveInput?.value ?? 'C')
        .trim()
        .toUpperCase()
        .slice(0, 2) || 'C'
    const residualMa = Math.max(1, Math.round(Number.isFinite(residualValue) ? residualValue : 300))
    const residualType =
      String(this._rcdTypeInput?.value ?? 'AC')
        .trim()
        .toUpperCase()
        .slice(0, 2) || 'AC'

    for (const object of objects) {
      const isResidual = ProtectionSymbolClassifier.isResidualProtection(object)
      object.set({
        breakerAmperageA: amperage,
        breakerShortCircuitKA: shortCircuit,
        breakerCurve: curve,
        breakerPoles: poles,
        breakerLabel: `${curve}${amperage}A / ${shortCircuit}kA`,
        bindingGroupBreakerAmperage: amperage,
        rcdResidualCurrentMa: isResidual ? residualMa : undefined,
        rcdType: isResidual ? residualType : undefined
      })
      this.#applyProtectionVisualState(object, amperage, poles, curve, residualMa, residualType, isResidual)
      object.setCoords()
      canvas.fire('object:modified', { target: object } as FabricEvent)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  #setNumericInputValue(input: ValueInput | undefined, value: number) {
    if (!input || !Number.isFinite(value)) return
    input.value = String(value)
  }

  #setCurveValue(value: string) {
    if (!this._curveInput) return
    this._curveInput.value = value
  }

  #currentNumericValue(input: ValueInput | undefined, fallback: number) {
    if (!input) return fallback
    const parsed = Number(input.value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  #applyQuickAction = (event: Event) => {
    const target = event.currentTarget as HTMLElement | null
    const action = target?.getAttribute('data-action')
    if (!action) return

    if (action === 'amp-down' || action === 'amp-up') {
      const current = Math.round(this.#currentNumericValue(this._ampInput, 16))
      const delta = action === 'amp-up' ? 1 : -1
      this.#setNumericInputValue(this._ampInput, Math.max(1, current + delta))
      this.#applyFormToSelection()
      return
    }

    if (action.startsWith('amp-')) {
      const value = Number(action.replace('amp-', ''))
      if (Number.isFinite(value) && value > 0) {
        this.#setNumericInputValue(this._ampInput, Math.round(value))
        this.#applyFormToSelection()
      }
      return
    }

    if (action.startsWith('curve-')) {
      const value = action.replace('curve-', '').toUpperCase()
      this.#setCurveValue(value)
      this.#applyFormToSelection()
      return
    }

    if (action.startsWith('ika-')) {
      const value = Number(action.replace('ika-', ''))
      if (Number.isFinite(value) && value > 0) {
        this.#setNumericInputValue(this._ikaInput, value)
        this.#applyFormToSelection()
      }
    }
  }

  render() {
    if (!this._isProtectionSelection) return html``
    return html`
      <object-item
        .active=${this.active}
        label="protection"
        icon="edit">
        <div class="quick-tools">
          <div class="quick-group">
            <span class="quick-label">Current</span>
            <button
              class="quick-btn"
              data-action="amp-down"
              @click=${this.#applyQuickAction}>
              -1A
            </button>
            <button
              class="quick-btn"
              data-action="amp-10"
              @click=${this.#applyQuickAction}>
              C10
            </button>
            <button
              class="quick-btn"
              data-action="amp-16"
              @click=${this.#applyQuickAction}>
              C16
            </button>
            <button
              class="quick-btn"
              data-action="amp-20"
              @click=${this.#applyQuickAction}>
              C20
            </button>
            <button
              class="quick-btn"
              data-action="amp-25"
              @click=${this.#applyQuickAction}>
              C25
            </button>
            <button
              class="quick-btn"
              data-action="amp-32"
              @click=${this.#applyQuickAction}>
              C32
            </button>
            <button
              class="quick-btn"
              data-action="amp-up"
              @click=${this.#applyQuickAction}>
              +1A
            </button>
          </div>
          <div class="quick-group">
            <span class="quick-label">Curve</span>
            <button
              class="quick-btn"
              data-action="curve-b"
              @click=${this.#applyQuickAction}>
              B
            </button>
            <button
              class="quick-btn"
              data-action="curve-c"
              @click=${this.#applyQuickAction}>
              C
            </button>
            <button
              class="quick-btn"
              data-action="curve-d"
              @click=${this.#applyQuickAction}>
              D
            </button>
            <span class="quick-label">kA</span>
            <button
              class="quick-btn"
              data-action="ika-6"
              @click=${this.#applyQuickAction}>
              6kA
            </button>
            <button
              class="quick-btn"
              data-action="ika-10"
              @click=${this.#applyQuickAction}>
              10kA
            </button>
          </div>
        </div>
        <div class="form">
          <md-filled-text-field
            id="protection-amp"
            label="Current (A)"
            type="number"
            min="1"
            step="1"
            @input=${this.#applyFormToSelection}
            @change=${this.#applyFormToSelection}>
          </md-filled-text-field>
          <md-filled-text-field
            id="protection-ika"
            label="Short-circuit (kA)"
            type="number"
            min="1"
            step="0.5"
            @input=${this.#applyFormToSelection}
            @change=${this.#applyFormToSelection}>
          </md-filled-text-field>
          <md-filled-text-field
            id="protection-curve"
            label="Curve"
            type="text"
            maxlength="2"
            @input=${this.#applyFormToSelection}
            @change=${this.#applyFormToSelection}>
          </md-filled-text-field>
          <md-filled-text-field
            id="protection-poles"
            label="Poles"
            type="number"
            min="1"
            max="4"
            step="1"
            @input=${this.#applyFormToSelection}
            @change=${this.#applyFormToSelection}>
          </md-filled-text-field>
          ${this._isResidualSelection
            ? html`
                <md-filled-text-field
                  id="protection-rcd-ma"
                  label="Residual current (mA)"
                  type="number"
                  min="1"
                  step="1"
                  @input=${this.#applyFormToSelection}
                  @change=${this.#applyFormToSelection}>
                </md-filled-text-field>
                <md-filled-select
                  id="protection-rcd-type"
                  label="RCD type"
                  @change=${this.#applyFormToSelection}>
                  <md-select-option value="AC">AC</md-select-option>
                  <md-select-option value="A">A</md-select-option>
                  <md-select-option value="F">F</md-select-option>
                  <md-select-option value="B">B</md-select-option>
                </md-filled-select>
              `
            : ''}
          <div class="hint full">Double-click op automaat of differentieel om dit pane automatisch te openen.</div>
        </div>
      </object-item>
    `
  }
}
