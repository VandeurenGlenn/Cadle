import type { RoomLabelData } from '../../editor/room-labels.js'
import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import pubsub from '../../pubsub.js'
import styles from './object-pane.css' with { type: 'css' }
import { buildKlemmenlijstTSV, buildLabelSheetHTML, downloadText } from './../../helpers/panel-labels.js'
import type { PanelLabelRow } from '../../helpers/panel-labels.js'
import {
  normalizeSelection,
  type BindingLabelSide,
  type SelectionPayload,
  type SelectionShapeElectrical,
  type SymbolTextField
} from './object-pane/selection-model.js'
import { effectiveSelectionElectrical } from './object-pane/electrical-model.js'
import { GOOGLE_FONTS_URL, SYSTEM_FONTS } from './object-pane/text-options.js'
import { circuitDefaults, defaultHasProtectiveConductor } from '../../editor/circuit-defaults.js'
import { GRID_SIZE, PAPER_WORLD_UNITS_PER_MM } from '../../editor/constants.js'
import { DRAWING_SCALES, isDrawingScale } from '../../editor/layout/drawing-scale.js'
import { heatingDesignLimits, heatingOutputBasis, MAX_HEATING_CIRCUITS, type HeatingDesignInputs } from '../../editor/heating-design.js'
import { heatingScheduleTotals, type HeatingData, type HeatingLayout } from '../../editor/heating-plan.js'
import type { CircuitOperationKind } from '../../editor/circuit-operations.js'
import { neutralPositionForManufacturer, type ElectricalPhaseConfiguration } from '../../editor/model/electrical.js'
import { CONNECTION_NAMES, connectionDefaults, type ConnectionKind, type ElectricalConnection } from '../../editor/model/electrical-connection.js'
import '../header.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/lite-elements/icon.js'

@customElement('object-pane')
export class ObjectPane extends LiteElement {
  @property({ attribute: false }) private accessor _nativeDimensions: { drawingScale?: number | null; length: number | null; width: number | null; height: number | null; strokeWidth: number | null } | null = null
  @property({ attribute: false }) private accessor _highlightedHeatingCircuit: string | null = null
  @property({ attribute: false }) private accessor _nativeRoomLabel: RoomLabelData | null = null
  @property({ attribute: false }) private accessor _nativeHeating: HeatingData | null = null
  @property({ attribute: false }) private accessor _nativeHeatingLayout: HeatingLayout | null = null
  @property({ attribute: false }) private accessor _nativeConnection: ElectricalConnection | null = null
  @property()
  private accessor _activeObjectLabel = 'No selection'

  @property({ type: Number })
  private accessor _selectionCount = 0

  @property({ type: Boolean, attribute: false })
  private accessor _canConvertToRoom = false

  @property({ type: String, attribute: false })
  private accessor _nativeSelectedId = ''

  @property({ type: String, attribute: false })
  private accessor _nativeSelectedKind = ''

  @property({ type: String, attribute: false })
  private accessor _nativeBindingId = ''

  @property({ type: String, attribute: false })
  private accessor _nativeName = ''

  @property({ type: Boolean, attribute: false })
  private accessor _nativeIsRoom = false

  @property({ type: String, attribute: false })
  private accessor _nativeRoomName = ''

  @property({ type: String, attribute: false })
  private accessor _nativePath = ''

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
  private accessor _nativeBusbarLength: number | null = null

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

  @property({ type: Boolean, attribute: false })
  private accessor _nativeCircuitPropertiesEditable = false

  @query('.native-binding-input')
  private accessor _nativeBindingInput!: HTMLInputElement

  static styles = [styles]

  connectedCallback(): void {
    super.connectedCallback()
    pubsub.subscribe('editor.selection.changed', this.#onNativeSelectionChanged)
    pubsub.subscribe('native.binding.focus-input', this.#focusBindingInput)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    pubsub.unsubscribe('editor.selection.changed', this.#onNativeSelectionChanged)
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
    this._highlightedHeatingCircuit = typeof payload?.highlightedHeatingCircuit === 'string' ? payload.highlightedHeatingCircuit : null
    this._selectionCount = selection.selectionCount
    this._canConvertToRoom = selection.canConvertToRoom === true
    if (!selection.shape) {
      this._nativeRoomLabel = null
      this._nativeHeating = null
      this._nativeHeatingLayout = null
      this._nativeDimensions = null
      this._nativeConnection = null
      this._activeObjectLabel = this._selectionCount > 1 ? 'Multiple objects selected' : 'No selection'
      this._nativeSelectedId = ''
      this._nativeSelectedKind = ''
      if (this._selectionCount === 0) this._nativeBindingId = ''
      this._nativeName = ''
      this._nativeIsRoom = false
      this._nativeRoomName = ''
      this._nativePath = ''
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
      this._nativeBusbarLength = null
      this._nativeX = null
      this._nativeY = null
      this._nativeFontFamily = ''
      this._nativeLetterSpacing = null
      this._nativeBindingLabelSide = 'auto'
      this._nativeElectrical = null
      this._nativeCircuitPropertiesEditable = false
      return
    }

    const shape = selection.shape
    this._nativeRoomLabel = shape.roomLabel ?? null
    this._nativeHeating = shape.heating ?? null
    this._nativeHeatingLayout = shape.heatingLayout ?? null
    this._nativeDimensions = shape.dimensions
    this._nativeConnection = shape.connection
    this._nativeSelectedId = shape.id
    this._nativeSelectedKind = shape.kind
    this._nativeBindingId = shape.bindingId
    this._nativeName = shape.name
    this._nativeIsRoom = shape.isRoom
    this._nativeRoomName = shape.roomName
    this._nativePath = shape.path ?? ''
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
    this._nativeBusbarLength = shape.busbarLength
    this._nativeX = shape.x
    this._nativeY = shape.y
    this._nativeFontFamily = shape.fontFamily
    this._nativeLetterSpacing = shape.letterSpacing
    this._nativeBindingLabelSide = shape.bindingLabelSide
    this._nativeCircuitPropertiesEditable = shape.circuitPropertiesEditable
    if (shape.kind === 'symbol') {
      const electrical = shape.electrical ?? {}
      const defaults = circuitDefaults(electrical.circuitType)
      const cableConductors = electrical.cableConductors ?? defaults.cableConductors
      this._nativeElectrical = {
        ...electrical,
        breakerCurrentA: electrical.breakerCurrentA ?? defaults.breakerCurrentA,
        cableSectionMm2: electrical.cableSectionMm2 ?? defaults.cableSectionMm2,
        cableConductors,
        hasProtectiveConductor: electrical.hasProtectiveConductor ?? defaultHasProtectiveConductor(cableConductors),
        cableType: electrical.cableType ?? defaults.cableType,
        cableInstallation: electrical.cableInstallation ?? defaults.cableInstallation,
        showCableInstallation: electrical.showCableInstallation ?? true,
        poles: electrical.poles ?? defaults.poles,
        phaseConfiguration: electrical.phaseConfiguration ?? defaults.phaseConfiguration,
        showPhaseLabel: electrical.showPhaseLabel ?? true,
        breakerCurve: electrical.breakerCurve ?? defaults.breakerCurve,
        boardId: electrical.boardId ?? defaults.boardId,
        railId: electrical.railId ?? defaults.railId
      }
    } else {
      this._nativeElectrical = null
    }
    this._activeObjectLabel = shape.heating ? shape.name : shape.connection ? CONNECTION_NAMES[shape.connection.kind] : shape.label
  }

  #setBindingLabelSide = (side: BindingLabelSide) => {
    this._nativeBindingLabelSide = side
    pubsub.publish('editor.object.update', { bindingLabelSide: side })
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
    pubsub.publish('editor.object.update', {
      bindingId: this._nativeBindingId
    })
  }

  #runCircuitOperation = async (kind: CircuitOperationKind) => {
    if (this._selectionCount === 0) return
    const currentFamily = /^([A-Z]{1,4})/.exec(this._nativeBindingId.trim().toUpperCase())?.[1] ?? ''
    const label =
      kind === 'replace'
        ? 'Replace the selected circuit with'
        : kind === 'combine'
          ? 'Combine the selected circuits into'
          : 'Move the selected points to new circuit'
    const values = await globalThis.cadleShell.requestInput({
      title: label,
      submitLabel: kind === 'split' ? 'Move points' : kind === 'combine' ? 'Combine circuits' : 'Replace circuit',
      fields: [
        {
          name: 'family',
          label: 'Target circuit family',
          value: kind === 'split' ? '' : currentFamily,
          placeholder: 'A',
          required: true
        }
      ]
    })
    const targetFamily = values?.family.toUpperCase()
    if (!targetFamily) return
    pubsub.publish('editor.circuit.operation', { kind, targetFamily })
  }

  #onRotationInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const value = Number(input?.value ?? 0)
    if (!Number.isFinite(value)) return
    this._nativeRotation = ((value % 360) + 360) % 360
    pubsub.publish('editor.object.update', { rotation: this._nativeRotation })
  }

  #rotateBy = (delta: number) => {
    const next = ((((this._nativeRotation ?? 0) + delta) % 360) + 360) % 360
    this._nativeRotation = next
    pubsub.publish('editor.object.update', { rotation: next })
  }

  #onScaleInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 1)
    if (!Number.isFinite(raw)) return
    const next = Math.max(0.1, Math.min(20, raw))
    this._nativeScale = next
    pubsub.publish('editor.object.update', { scale: next })
  }

  #onTextInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeText = input?.value ?? ''
    pubsub.publish('editor.object.update', { text: this._nativeText })
  }

  #onRoomNameInput = (event: Event) => {
    this._nativeRoomName = (event.target as HTMLInputElement).value
    pubsub.publish('editor.object.update', { roomName: this._nativeRoomName })
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
    pubsub.publish('editor.object.update', { symbolTextOverrides })
  }

  #toggleFlipX = () => {
    const next = !(this._nativeFlipX === true)
    this._nativeFlipX = next
    pubsub.publish('editor.object.update', { flipX: next })
  }

  #toggleFlipY = () => {
    const next = !(this._nativeFlipY === true)
    this._nativeFlipY = next
    pubsub.publish('editor.object.update', { flipY: next })
  }

  #onFillChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeFill = input?.value ?? ''
    pubsub.publish('editor.object.update', { fill: this._nativeFill })
  }

  #clearFill = () => {
    this._nativeFill = ''
    pubsub.publish('editor.object.update', { fill: '' })
  }

  #onStrokeChange = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeStroke = input?.value ?? ''
    pubsub.publish('editor.object.update', { stroke: this._nativeStroke })
  }

  #clearStroke = () => {
    this._nativeStroke = ''
    pubsub.publish('editor.object.update', { stroke: '' })
  }

  #onStrokeWidthInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    const next = Math.max(0.5, Math.min(40, raw))
    this._nativeStrokeWidth = next
    pubsub.publish('editor.object.update', { strokeWidth: next })
  }

  #setBusbarLengthInBlocks = (blocks: number) => {
    if (!Number.isFinite(blocks)) return
    const snappedBlocks = Math.max(4, Math.min(500, Math.round(blocks)))
    const length = snappedBlocks * GRID_SIZE
    this._nativeBusbarLength = length
    pubsub.publish('editor.object.update', { busbarLength: length })
  }

  #onBusbarLengthInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this.#setBusbarLengthInBlocks(Number(input?.value ?? 0))
  }

  #adjustBusbarLength = (deltaBlocks: number) => {
    const currentBlocks = (this._nativeBusbarLength ?? GRID_SIZE * 4) / GRID_SIZE
    this.#setBusbarLengthInBlocks(currentBlocks + deltaBlocks)
  }

  #onXInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeX = raw
    pubsub.publish('editor.object.update', { x: raw })
  }

  #onYInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeY = raw
    pubsub.publish('editor.object.update', { y: raw })
  }

  #onFontFamilyInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    this._nativeFontFamily = input?.value ?? ''
    pubsub.publish('editor.object.update', { fontFamily: this._nativeFontFamily })
  }

  #onLetterSpacingInput = (event: Event) => {
    const input = event.target as HTMLInputElement | null
    const raw = Number(input?.value ?? 0)
    if (!Number.isFinite(raw)) return
    this._nativeLetterSpacing = raw
    pubsub.publish('editor.object.update', { letterSpacing: raw })
  }

  #updateElectrical = (field: keyof SelectionShapeElectrical, value: string) => {
    const numericFields = new Set([
      'breakerCurrentA',
      'cableSectionMm2',
      'cableConductors',
      'poles',
      'rcdSensitivityMa'
    ])
    const parsed =
      field === 'hasProtectiveConductor'
        ? value === ''
          ? null
          : value === 'true'
        : numericFields.has(field)
          ? value.trim()
            ? Number(value)
            : null
          : value || null
    if (typeof parsed === 'number' && (!Number.isFinite(parsed) || parsed <= 0)) return
    if (field === 'cableConductors' && typeof parsed === 'number') {
      const hasProtectiveConductor = defaultHasProtectiveConductor(parsed)
      this._nativeElectrical = {
        ...(this._nativeElectrical ?? {}),
        cableConductors: parsed,
        hasProtectiveConductor
      }
      pubsub.publish('editor.object.update', {
        electrical: { cableConductors: parsed, hasProtectiveConductor }
      })
      return
    }
    this._nativeElectrical = { ...(this._nativeElectrical ?? {}), [field]: parsed ?? undefined }
    pubsub.publish('editor.object.update', { electrical: { [field]: parsed } })
  }

  #updateManufacturer = (value: string) => {
    const manufacturer = value.trim() || null
    const neutralPosition = neutralPositionForManufacturer(manufacturer ?? undefined) ?? null
    this._nativeElectrical = {
      ...(this._nativeElectrical ?? {}),
      manufacturer: manufacturer ?? undefined,
      neutralPosition: neutralPosition ?? undefined
    }
    pubsub.publish('editor.object.update', {
      electrical: { manufacturer, neutralPosition }
    })
  }

  #setSupplyPreset = (phaseConfiguration: ElectricalPhaseConfiguration, poles: number) => {
    this._nativeElectrical = {
      ...(this._nativeElectrical ?? {}),
      phaseConfiguration,
      poles,
      showPhaseLabel: true
    }
    pubsub.publish('editor.object.update', {
      electrical: { phaseConfiguration, poles, showPhaseLabel: true }
    })
  }

  #setPhaseLabelVisibility = (showPhaseLabel: boolean) => {
    this._nativeElectrical = { ...(this._nativeElectrical ?? {}), showPhaseLabel }
    pubsub.publish('editor.object.update', { electrical: { showPhaseLabel } })
  }

  #setNeutralPosition = (neutralPosition: '' | 'left' | 'right') => {
    this._nativeElectrical = {
      ...(this._nativeElectrical ?? {}),
      neutralPosition: neutralPosition || undefined
    }
    pubsub.publish('editor.object.update', {
      electrical: { neutralPosition: neutralPosition || null }
    })
  }

  #updateCableInstallation = (value: string) => {
    if (value === 'none') {
      this._nativeElectrical = { ...(this._nativeElectrical ?? {}), showCableInstallation: false }
      pubsub.publish('editor.object.update', { electrical: { showCableInstallation: false } })
      return
    }
    this._nativeElectrical = {
      ...(this._nativeElectrical ?? {}),
      showCableInstallation: true,
      cableInstallation: value
    }
    pubsub.publish('editor.object.update', {
      electrical: { showCableInstallation: true, cableInstallation: value }
    })
  }

  #effectiveElectrical = (): SelectionShapeElectrical => {
    return effectiveSelectionElectrical(this._nativeElectrical, this._nativeName, this._nativePath)
  }

  #flipNativeShape = () => {
    if (!this._nativeCanFlip) return
    pubsub.publish('editor.object.flip-side', {})
  }

  #deleteNativeSelection = () => {
    if (this._selectionCount === 0) return
    pubsub.publish('editor.object.delete', {})
  }

  #convertSelectionToRoom = () => {
    if (!this._canConvertToRoom) return
    pubsub.publish('editor.object.convert-room', {})
  }

  #updateConnection = (update: Partial<ElectricalConnection>) => {
    if (!this._nativeConnection) return
    this._nativeConnection = { ...this._nativeConnection, ...update }
    pubsub.publish('editor.object.update', { connection: update })
  }

  #renderConnectionProperties() {
    const connection = this._nativeConnection
    const conductor = connection?.kind === 'wire' || connection?.kind === 'cable'
    return html`
      <label><span class="native-label">Verbindingstype</span>
        <select class="native-select" @change=${(event: Event) => {
          const kind = (event.target as HTMLSelectElement).value as ConnectionKind | ''
          this._nativeConnection = kind ? connectionDefaults(kind) : null
          pubsub.publish('editor.object.update', { connection: this._nativeConnection })
        }}>
          <option value="" ?selected=${!connection}>Grafische lijn</option>
          ${Object.entries(CONNECTION_NAMES).map(([kind, label]) => html`<option value=${kind} ?selected=${connection?.kind === kind}>${label}</option>`)}
        </select>
      </label>
      ${connection ? html`
        <label><span class="native-label">Benaming verbinding</span>
          <input class="native-input" .value=${connection.name ?? ''}
            @input=${(event: Event) => this.#updateConnection({ name: (event.target as HTMLInputElement).value })} />
        </label>
        ${conductor ? html`
          <div class="native-row">
            <label><span class="native-label">Doorsnede (mm²)</span>
              <input class="native-input" type="number" min="0.1" step="0.5" .value=${String(connection.sectionMm2 ?? 2.5)}
                @change=${(event: Event) => { const value = Number((event.target as HTMLInputElement).value); if (value > 0) this.#updateConnection({ sectionMm2: value }) }} />
            </label>
            <label><span class="native-label">Aantal geleiders</span>
              <input class="native-input" type="number" min="1" max="1000" step="1" .value=${String(connection.conductors ?? 1)}
                @change=${(event: Event) => { const value = Number((event.target as HTMLInputElement).value); if (Number.isInteger(value) && value > 0) this.#updateConnection({ conductors: value }) }} />
            </label>
          </div>
          <label><span class="native-label">Kabel-/draadtype</span>
            <select class="native-select"
              @change=${(event: Event) => this.#updateConnection({ cableType: (event.target as HTMLSelectElement).value as ElectricalConnection['cableType'] })}>
              ${['none', 'VOB', 'XVB', 'XVB-Cca', 'XGB', 'XGB-Cca', 'EXVB', 'other'].map((type) => html`<option value=${type} ?selected=${(connection.cableType ?? 'none') === type}>${type === 'none' ? 'Geen' : type === 'other' ? 'Ander' : type.replace('-', ' ')}</option>`)}
            </select>
          </label>
          <label><span class="native-label">Brandklasse (optioneel)</span>
            <input class="native-input" type="text" maxlength="80" placeholder="Bijv. Cca" .value=${connection.fireClass ?? ''}
              @change=${(event: Event) => this.#updateConnection({ fireClass: (event.target as HTMLInputElement).value.trim() })} />
          </label>
          <label class="native-check"><input type="checkbox" .checked=${connection.hasProtectiveConductor ?? false}
            @change=${(event: Event) => this.#updateConnection({ hasProtectiveConductor: (event.target as HTMLInputElement).checked })} /> Met beschermingsgeleider (G)</label>
        ` : ''}
        ${connection.kind === 'bridge' ? html`
          <label><span class="native-label">Brughoogte (mm)</span>
            <input class="native-input" type="number" min="-30" max="30" step="1" .value=${String(connection.offsetMm ?? 3)}
              @change=${(event: Event) => this.#updateConnection({ offsetMm: Number((event.target as HTMLInputElement).value) })} />
          </label>
        ` : ''}
        <label class="native-check"><input type="checkbox" .checked=${connection.showLabel !== false}
          @change=${(event: Event) => this.#updateConnection({ showLabel: (event.target as HTMLInputElement).checked })} /> Toon aanduiding</label>
      ` : ''}
    `
  }

  #dimensionSummary() {
    const dimensions = this._nativeDimensions
    if (!dimensions) return ''
    const number = (value: number) => new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 2 }).format(value)
    const measures = dimensions.length !== null ? [['Lengte', 'length', dimensions.length]] as const
      : [['Breedte', 'width', dimensions.width], ['Hoogte', 'height', dimensions.height]] as const
    return html`<div class="dimension-summary" aria-label="Afmetingen">
      <div class="dimension-heading">
        <div class="dimension-caption">${dimensions.drawingScale ? 'Werkelijke afmetingen' : 'Afmetingen op blad'}</div>
        ${dimensions.drawingScale ? html`<label class="dimension-scale"><span>Planschaal</span>
          <select aria-label="Planschaal voor dit blad" .value=${String(dimensions.drawingScale)}
            @change=${(event: Event) => {
              const drawingScale = Number((event.target as HTMLSelectElement).value)
              if (isDrawingScale(drawingScale)) pubsub.publish('editor.controls.command', { drawingScale })
            }}>
            ${DRAWING_SCALES.map((scale) => html`<option value=${String(scale)} .selected=${scale === dimensions.drawingScale}>1:${scale}</option>`)}
          </select>
        </label>` : ''}
      </div>
      <dl class="dimension-values">
        ${measures.filter(([, , value]) => value !== null).map(([label, key, value]) => html`
          <div><dt>${label}</dt><dd data-dimension=${key}>${number(value! / PAPER_WORLD_UNITS_PER_MM * (dimensions.drawingScale ?? 1) / (dimensions.drawingScale ? 1000 : 1))} <span>${dimensions.drawingScale ? 'm' : 'mm'}</span></dd>
            ${dimensions.drawingScale ? html`<dd class="dimension-paper" data-paper-dimension=${key}>${number(value! / PAPER_WORLD_UNITS_PER_MM)} mm op blad</dd>` : ''}
          </div>`)}
        ${dimensions.strokeWidth !== null ? html`<div><dt>Lijndikte</dt>
          <dd data-dimension="strokeWidth">${number(dimensions.strokeWidth)} <span>px</span></dd></div>` : ''}
      </dl>
      ${dimensions.drawingScale === null ? html`<p class="dimension-hint">Werkelijke maten: stel de planschaal in of kalibreer met een bekende lengte.</p>` : ''}
    </div>`
  }

  #heatingCircuitOverview(data: HeatingData) {
    if (data.kind !== 'manifold' || !data.rows?.length) return ''
    const totals = heatingScheduleTotals(data.rows)
    const number = (value: number, digits = 1) => value.toLocaleString('nl-BE', { maximumFractionDigits: digits })
    const measure = (label: string, key: string, value: number, unit = 'm', digits = 1) => html`<div>
      <dt>${label}</dt><dd data-heating-measure=${key}>${number(value, digits)} <span>${unit}</span></dd>
    </div>`
    return this.#propertySection('heating-circuits', 'Kringenoverzicht', html`
      <div class="dimension-summary heating-circuit-total" data-heating-circuit-totals>
        <strong>${totals.circuits} kringen · ${number(totals.cutM)} m kniplengte</strong>
        <div class="dimension-caption">${number(totals.areaM2)} m² verwarmd · ${number(totals.flowLmin, 2)} l/min totaal</div>
      </div>
      <p class="dimension-caption">Kniplengte = lus + aanvoer + retour + reserve. Lengtes volgen de getekende trajecten.</p>
      <p class="dimension-caption">Klik een kring om lus, aanvoer en retour te markeren. Nogmaals klikken wist de markering.</p>
      <div class="heating-circuit-list" role="list" aria-label="Kringen vloerverwarming">
        ${data.rows.map((row) => html`<article class="dimension-summary heating-circuit-card" role="listitem" data-heating-circuit=${row.id}
          data-active=${this._highlightedHeatingCircuit === row.id}
          @click=${() => pubsub.publish('editor.controls.command', { action: 'highlight-heating-circuit', circuitId: row.id })}>
          <button type="button" class="heating-circuit-heading" aria-label=${`Markeer kring ${row.id} op het plan`}
            aria-pressed=${this._highlightedHeatingCircuit === row.id}><strong>${row.id}</strong><span>${row.room}</span><span aria-hidden="true">↗</span></button>
          <dl class="heating-circuit-measures">
            ${measure('Lus', 'loopM', row.loopM)}${measure('Aanvoer', 'supplyM', row.supplyM)}${measure('Retour', 'returnM', row.returnM)}
            ${measure('Getekend', 'totalM', row.totalM)}${measure('Reserve', 'allowanceM', row.allowanceM ?? 0)}${measure('Kniplengte', 'cutM', row.cutM ?? row.totalM)}
            ${measure(row.flowEstimated !== false ? 'Richtdebiet*' : 'Debiet', 'flowLmin', row.flowLmin, 'l/min', 2)}${measure('Verwarmd', 'areaM2', row.areaM2, 'm²')}
          </dl>
          <div class="dimension-caption">Ø ${number(row.diameterMm)} mm · h.o.h. ${number(row.spacingMaxMm ?? row.spacingMm)} mm</div>
          <button type="button" class="native-button" aria-pressed=${row.locked === true}
            @click=${(event: Event) => { event.stopPropagation(); pubsub.publish('editor.controls.command', { action: 'set-heating-circuit-lock', circuitId: row.id, locked: !row.locked }) }}>${row.locked ? 'Kring losmaken' : 'Kring vastzetten'}</button>
          ${(row.checkMessages ?? []).length ? html`<p class="dimension-hint heating-circuit-check">${row.checkMessages![0]}${row.checkMessages!.length > 1 ? ` (+${row.checkMessages!.length - 1})` : ''}</p>` : ''}
        </article>`)}
      </div>
      ${data.rows.some((row) => row.flowEstimated !== false) ? html`<p class="dimension-caption">* Richtdebiet op basis van aannames; vul ruimtelast en ontwerp-ΔT in voor het ontwerpdebiet.</p>` : ''}
      <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'export-heating-csv' })}>Kringentabel als CSV</button>
    `, true)
  }

  #heatingProperties() {
    const data = this._nativeHeating, layout = this._nativeHeatingLayout
    if (!data) return ''
    if (data.kind === 'exclusion') return this.#propertySection('heating', 'Verboden verwarmingszone', html`<p class="dimension-caption">Binnen deze zone mogen geen verwarmingsbuizen of aansluittrajecten lopen. Bereken het legplan opnieuw na een wijziging.</p>`, true)
    if (data.kind === 'table') return this.#propertySection('heating', 'Kringentabel', html`
      <div class="dimension-caption">Meters omvatten de verwarmingslus en beide aansluittrajecten vanaf de verdeler. De tabel volgt de kringen van het legplan.</div>
      <div class="dimension-caption">Concept: controleer geometrie, productgegevens en hydrauliek vóór uitvoering. * bij een debiet betekent dat aannames gebruikt zijn.</div>
      <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'export-heating-csv' })}>Kringentabel als CSV</button>
    `, true)
    const update = (heating: Partial<HeatingData>) => pubsub.publish('editor.object.update', { heating })
    const numeric = (key: 'spacingMm' | 'edgeMm' | 'diameterMm' | 'circuits' | 'capacity', label: string, min: number, max: number) => html`
      <label><span class="native-label">${label}</span><input class="native-input" type="number" min=${min} max=${max} step="1"
        data-heating-field=${key} .value=${String(data[key] ?? (key === 'capacity' ? Math.max(data.circuits, 12) : 100))}
        @change=${(event: Event) => {
          const input = event.target as HTMLInputElement
          if (input.checkValidity() && Number.isFinite(input.valueAsNumber)) update({ [key]: input.valueAsNumber })
        }} /></label>`
    const limits = heatingDesignLimits(data.diameterMm, data.design)
    const designNumeric = (key: keyof HeatingDesignInputs, label: string, min: number, max: number, fallback: string) => html`
      <label><span class="native-label">${label}</span><input class="native-input" type="number" min=${min} max=${max} step="any"
        data-heating-design=${key} placeholder=${fallback} .value=${data.design?.[key] === undefined ? '' : String(data.design[key])}
        @change=${(event: Event) => {
          const input = event.target as HTMLInputElement
          if (!input.value || (input.checkValidity() && Number.isFinite(input.valueAsNumber))) {
            const design = { ...data.design, [key]: input.value ? input.valueAsNumber : undefined }
            if (key === 'systemOutputWm2') design.systemOutputBasis = input.value ? heatingOutputBasis(data.diameterMm, data.spacingMm, design) : undefined
            update({ design })
          }
        }} /></label>`
    const audit = data.audit
    return html`${this.#propertySection('heating', 'Vloerverwarming', html`
      <label><span class="native-label">Benaming</span><input class="native-input" data-heating-field="name" maxlength="100" .value=${data.name}
        @change=${(event: Event) => update({ name: (event.target as HTMLInputElement).value })} /></label>
      ${data.kind !== 'manifold' || data.automatic ? numeric('diameterMm', 'Buisdiameter (mm)', 6, 50) : ''}
      ${data.kind === 'zone' ? html`
        <div class="native-row">${numeric('spacingMm', 'Buisafstand h.o.h. (mm)', 50, 500)}${numeric('edgeMm', 'Randafstand (mm)', 0, 1000)}</div>
        ${numeric('circuits', 'Aantal lussen', 1, MAX_HEATING_CIRCUITS)}
        <label><span class="native-label">Legrichting</span><select class="native-select" data-heating-field="direction" .value=${data.direction}
          @change=${(event: Event) => update({ direction: (event.target as HTMLSelectElement).value as HeatingData['direction'] })}>
          <option value="horizontal">Horizontale meander</option><option value="vertical">Verticale meander</option>
        </select></label>
        <div class="dimension-caption">Zone ${layout?.areaM2.toFixed(2)} m² · buis ${layout?.lengthM.toFixed(1)} m (zonder aansluitleidingen)</div>
        ${(layout?.circuits ?? []).map((circuit, index) => html`<div class="dimension-caption">Lus ${index + 1}: ${circuit.lengthM.toFixed(1)} m</div>`)}
      ` : data.kind === 'manifold' ? data.automatic ? html`
        ${numeric('spacingMm', 'Legafstand h.o.h. (mm)', 50, 500)}
        ${numeric('edgeMm', 'Randafstand tot muren (mm)', 0, 1000)}
        ${numeric('capacity', 'Beschikbare verdelergroepen', 1, MAX_HEATING_CIRCUITS)}
        <div class="dimension-caption">${data.circuits} automatisch berekende kringen</div>
        ${data.pattern === 'spiral' ? html`<div class="dimension-caption">Slakkenhuis · minimaal R${limits.minBendRadiusMm} mm voor lus, aanvoer en retour</div>` : ''}
        <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'regenerate-heating-plan' })}>Legplan opnieuw berekenen</button>
      ` : numeric('circuits', 'Aantal groepen', 1, MAX_HEATING_CIRCUITS) : html`
        <label><span class="native-label">Buisfunctie</span><select class="native-select" data-heating-field="pipeRole" .value=${data.pipeRole}
          @change=${(event: Event) => update({ pipeRole: (event.target as HTMLSelectElement).value as HeatingData['pipeRole'] })}>
          <option value="supply">Aanvoer (rood)</option><option value="return">Retour (blauw)</option><option value="loop">Verwarmingslus</option>
        </select></label>
        <div class="dimension-caption">Trajectlengte ${layout?.lengthM.toFixed(2)} m${data.circuitId ? ` · kring ${data.circuitId}` : ''}</div>
        <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'redraw-heating-route' })}>Traject opnieuw tekenen</button>
        <div class="dimension-caption">Enter bewaart; Escape annuleert. Automatisch herberekenen vervangt handmatige trajecten.</div>
      `}
      ${layout?.warning ? html`<p class="dimension-hint" role="alert">${layout.warning}</p>` : ''}
    `, true)}
      ${this.#heatingCircuitOverview(data)}
      ${data.kind === 'manifold' && data.automatic ? this.#propertySection('heating-rooms', 'Ruimtes en dekking', html`
        <p class="dimension-caption">Kies welke ruimtes worden verwarmd. Bij herberekenen per ruimte blijven de overige kringen en vastgezette kringen behouden.</p>
        ${data.coverage?.stale ? html`<p class="dimension-hint">De tekening is gewijzigd. Bereken opnieuw voor actuele dekkingscijfers.</p>` : ''}
        ${(data.planningRooms ?? []).map((room) => html`<div class="dimension-summary" data-heating-room-control=${room.key}>
          <label><input type="checkbox" .checked=${!data.excludedRoomKeys?.includes(room.key)} @change=${(event: Event) => {
            const excluded = new Set(data.excludedRoomKeys ?? [])
            if ((event.target as HTMLInputElement).checked) excluded.delete(room.key); else excluded.add(room.key)
            update({ excludedRoomKeys: [...excluded] })
          }} /> ${room.name}</label>
          <button type="button" class="native-button" ?disabled=${data.excludedRoomKeys?.includes(room.key)} @click=${() => pubsub.publish('editor.controls.command', { action: 'regenerate-heating-room', roomKey: room.key })}>Deze ruimte herberekenen</button>
          ${data.coverage?.rooms.filter((r) => r.key === room.key).map((r) => html`<div class="dimension-caption">${r.coveredM2.toFixed(2)} / ${r.eligibleM2.toFixed(2)} m² gedekt · ${r.gapM2.toFixed(2)} m² buiten dekking</div>`)}
        </div>`)}
        <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'toggle-heating-coverage' })}>Dekkingskaart tonen/verbergen</button>
        <p class="dimension-caption">Oranje: verder dan een halve legafstand plus rastertolerantie van de getekende buis. Dit is een geometrische controle.</p>
      `, false) : ''}
      ${data.automatic && data.kind === 'manifold' ? this.#propertySection('heating-design', 'Ontwerpgegevens', html`
        <p class="dimension-caption">Optioneel invullen uit productblad en warmteverliesberekening. Pas daarna het legplan opnieuw aan met ‘opnieuw berekenen’.</p>
        <label><span class="native-label">Buisproduct</span><input class="native-input" maxlength="160" data-heating-design="product" .value=${data.design?.product ?? ''}
          @change=${(event: Event) => update({ design: { ...data.design, product: (event.target as HTMLInputElement).value } })} /></label>
        ${designNumeric('minBendRadiusMm', 'Minimale buigradius (mm)', 10, 1000, `${limits.minBendRadiusMm} (aanname 5×Ø)`)}
        ${designNumeric('maxCircuitLengthM', 'Max. kringlengte incl. reserve (m)', 20, 300, '100 (aanname)')}
        ${designNumeric('allowanceM', 'Opstanden + snijreserve per kring (m)', 0, 30, 'Nog invullen')}
        ${designNumeric('deltaTK', 'Ontwerp-ΔT (K)', 1, 20, '5 (aanname)')}
        ${[...new Set(data.rows?.map((row) => row.room) ?? [])].map((room) => html`
          <label><span class="native-label">Warmtelast ${room} (W)</span><input class="native-input" type="number" min="0" max="100000" step="any" data-heating-room=${room}
            placeholder="Nog invullen" .value=${data.design?.roomHeatLoadsW && Object.hasOwn(data.design.roomHeatLoadsW, room) ? String(data.design.roomHeatLoadsW[room]) : ''}
            @change=${(event: Event) => {
              const input = event.target as HTMLInputElement
              if (input.value && (!input.checkValidity() || !Number.isFinite(input.valueAsNumber))) return
              const loads = { ...data.design?.roomHeatLoadsW }
              if (input.value) loads[room] = input.valueAsNumber
              else delete loads[room]
              update({ design: { ...data.design, roomHeatLoadsW: loads } })
            }} /></label>`)}
      `) : ''}
      ${data.automatic && data.kind === 'manifold' ? this.#propertySection('heating-hydraulics', 'Hydrauliek en inregeling', html`
        <p class="dimension-caption">Water, Darcy–Weisbach/Colebrook. Vul waarden uit het productblad in. Beschikbare druk geldt aan de verdeler, na verlies in toevoerleidingen.</p>
        ${designNumeric('pipeWallMm', 'Buiswanddikte (mm)', .1, 15, 'Productblad; nodig voor binnendiameter')}
        ${designNumeric('roughnessMm', 'Absolute buisruwheid (mm)', 0, 1, '0,007 (aanname)')}
        ${designNumeric('fluidTemperatureC', 'Gemiddelde watertemperatuur (°C)', 10, 80, 'Afgeleid uit aanvoer/retour; standaard 32,5')}
        ${designNumeric('localLossK', 'Totale lokale ζ (bochten + koppelingen)', 0, 1000, 'Nog invullen; 0 indien onderbouwd')}
        ${designNumeric('manifoldKv', 'Kv volledig verdelertraject per kring (m³/h)', .01, 20, 'Productblad, aanvoer én retour')}
        ${designNumeric('availablePressureKpa', 'Verschildruk aan verdeler op werkpunt (kPa)', .1, 300, 'Pompwerkpunt na toevoerverliezen')}
        ${designNumeric('maxVelocityMs', 'Ontwerpgrens watersnelheid (m/s)', .05, 3, '0,5 (planaanname)')}
        ${(data.rows ?? []).map((row) => html`<div class="dimension-summary" data-heating-hydraulics=${row.id}>
          <strong>${row.id}</strong>
          ${row.hydraulics ? html`<div class="dimension-caption">Ø inw. ${row.hydraulics.innerDiameterMm.toFixed(1)} mm · ${row.hydraulics.velocityMs.toFixed(2)} m/s · Re ${row.hydraulics.reynolds.toFixed(0)}</div>
            <div class="dimension-caption">Buis ${row.hydraulics.pipeKpa.toFixed(2)} + lokaal ${row.hydraulics.localKpa.toFixed(2)} + verdeler ${row.hydraulics.manifoldKpa?.toFixed(2) ?? '?'} = ${row.hydraulics.totalKpa.toFixed(2)} kPa${row.hydraulics.complete ? '' : ' (gedeeltelijk)'}</div>
            <div class="dimension-caption">Extra smoordruk ${row.hydraulics.balanceKpa?.toFixed(2) ?? '—'} kPa${row.hydraulics.targetKv !== undefined ? ` · Kv extra weerstand ${row.hydraulics.targetKv.toFixed(3)}` : ''}</div>
            ${row.hydraulics.pumpMarginKpa !== undefined ? html`<div class="dimension-caption">Druk boven minimum benodigd ${row.hydraulics.pumpMarginKpa.toFixed(2)} kPa</div>` : ''}
          ` : html`<div class="dimension-caption">Wanddikte en geldige watertemperatuur nodig.</div>`}
        </div>`)}
        <p class="dimension-caption">Extra smoordruk is een ontwerpwaarde. Ventielstanden volgen uit de fabrikantcurve; geen glycolberekening.</p>
      `) : ''}
      ${data.automatic && data.kind === 'manifold' ? this.#propertySection('heating-floor', 'Vloeropbouw en warmteafgifte', html`
        <p class="dimension-caption">Deze opbouw en temperaturen gelden voor alle ruimten op dit blad. Laagweerstand R = dikte/λ. Het vlakke 1D-model geeft een optimistische bovengrens; bevestig de systeemafgifte uit fabrikantgegevens.</p>
        <div class="native-row">${designNumeric('coveringThicknessMm', 'Afwerking dikte (mm)', 0, 200, 'Nog invullen')}${designNumeric('coveringLambda', 'Afwerking λ (W/mK)', .01, 10, 'Nog invullen')}</div>
        <div class="native-row">${designNumeric('screedCoverMm', 'Dekvloer boven buis (mm)', 0, 300, 'Nog invullen')}${designNumeric('screedLambda', 'Dekvloer λ (W/mK)', .01, 10, 'Nog invullen')}</div>
        <div class="native-row">${designNumeric('insulationThicknessMm', 'Isolatie dikte (mm)', 0, 500, 'Nog invullen')}${designNumeric('insulationLambda', 'Isolatie λ (W/mK)', .01, 1, 'Nog invullen')}</div>
        ${designNumeric('minimumInsulationR', 'Ontwerpminimum isolatie R (m²K/W)', 0, 20, '1,25 (planaanname; projectsituatie controleren)')}
        ${designNumeric('supplyTemperatureC', 'Aanvoertemperatuur (°C)', 10, 80, '35 (aanname)')}
        ${designNumeric('roomTemperatureC', 'Ruimtetemperatuur (°C)', 5, 35, '20 (aanname)')}
        ${designNumeric('surfaceLimitC', 'Max. gemiddelde vloertemperatuur (°C)', 10, 40, '29 (planaanname)')}
        ${designNumeric('belowTemperatureC', 'Temperatuur onderliggende ruimte (°C)', -30, 35, 'Nodig voor bovengrens benedenverlies')}
        ${designNumeric('downwardDesignWm2', 'Ontwerpverlies naar beneden (W/m²)', 0, 1000, 'Nog invullen; wordt bij debiet opgeteld')}
        <label><span class="native-label">Referentie fabrikantafgifte</span><input class="native-input" data-heating-design="systemReference" maxlength="160" .value=${data.design?.systemReference ?? ''}
          @change=${(event: Event) => update({ design: { ...data.design, systemReference: (event.target as HTMLInputElement).value } })} /></label>
        ${designNumeric('systemOutputWm2', 'Fabrikantafgifte bij deze ontwerpgegevens (W/m²)', 0, 300, 'Bij gekozen max. legafstand, temperaturen en vloer')}
        <p class="dimension-caption">Vul de afgifte als laatste in; wijzigen van de ontwerpgegevens maakt die onderbouwing ongeldig.</p>
        ${[...new Map((data.rows ?? []).map((row) => [row.room, row])).values()].map((row) => html`<div class="dimension-summary" data-heating-floor=${row.room}>
          <strong>${row.room}</strong>
          <div class="dimension-caption">R afwerking ${row.floor?.coveringR?.toFixed(3) ?? '—'} · dekvloer ${row.floor?.screedR?.toFixed(3) ?? '—'} · isolatie ${row.floor?.insulationR?.toFixed(2) ?? '—'} m²K/W</div>
          <div class="dimension-caption">Warmtevraag ${row.floor?.demandWm2?.toFixed(1) ?? '—'} W/m² · vloer nodig ${row.floor?.requiredSurfaceC?.toFixed(1) ?? '—'} °C</div>
          <div class="dimension-caption">1D-bovengrens ${row.floor?.upperBoundWm2?.toFixed(1) ?? '—'} W/m² · fabrikant ${row.floor?.systemOutputWm2?.toFixed(1) ?? '—'} W/m²${row.floor?.outputStale ? ' (onderbouwing vervallen)' : ''}</div>
          <div class="dimension-caption">Benedenverlies 1D-bovengrens ${row.floor?.downwardUpperWm2?.toFixed(1) ?? '—'} W/m²; ontwerpwaarde afzonderlijk invullen.</div>
        </div>`)}
      `) : ''}
      ${data.automatic && (audit || data.checks?.length) ? this.#propertySection('heating-checks', 'Legplancontrole', html`
        <div class="dimension-caption" role="status">Concept${audit ? ` · ${audit.errors} fouten · ${audit.reviews} controles` : ''}</div>
        ${(audit?.issues ?? data.checks ?? []).length > 30 ? html`<p class="dimension-caption">Eerste 30 punten; de volledige lijst staat in de CSV.</p>` : ''}
        ${(audit?.issues ?? data.checks ?? []).slice(0, 30).map((issue) => html`<p class="dimension-hint" data-heating-check=${issue.code}>${issue.severity === 'error' ? '⚠' : '•'} ${issue.message}</p>`)}
        ${data.kind !== 'manifold' || !data.rows?.length ? html`<button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'export-heating-csv' })}>Kringentabel als CSV</button>` : ''}
      `, Boolean(audit?.errors)) : ''}
    `
  }

  #expandedSections = new Map<string, boolean>()

  #propertySection(key: string, title: string, content: ReturnType<typeof html>, initiallyOpen = false) {
    return html`<details class="property-section" data-property-section=${key}
      .open=${this.#expandedSections.get(key) ?? initiallyOpen}
      @toggle=${(event: Event) => {
        const section = event.currentTarget as HTMLDetailsElement
        this.#expandedSections.set(key, section.open)
      }}>
      <summary>${title}</summary>
      <div class="property-section-body">${content}</div>
    </details>`
  }

  #renderNativeSelection() {
    const isResidualBreaker = /residual-current/i.test(`${this._nativePath} ${this._nativeName}`)
    const isProtectionDevice = this._nativeCircuitPropertiesEditable
    const hasSelection = this._selectionCount > 0
    if (!hasSelection) {
      return html`
        <div class="empty-state">
          <div class="empty-card">
            <custom-icon icon="arrow_selector_tool"></custom-icon>
            <span class="empty-title">No selection</span>
            <span class="empty-hint">Select an object to view its properties.</span>
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
        ${!multiple ? this.#dimensionSummary() : ''}
        ${!multiple ? this.#heatingProperties() : ''}
        ${!multiple && this._nativeSelectedKind === 'symbol'
          ? this._nativeSymbolTextFields.filter((field) => field.key === 'description').map((field) => html`
              <label>
                <span class="native-label">${field.label}</span>
                <input class="native-input" type="text" .value=${field.value}
                  @input=${(event: Event) => this.#onSymbolTextInput(field.key, (event.target as HTMLInputElement).value)} />
              </label>
            `) : ''}
        ${this._nativeRoomLabel ? this.#propertySection('room-label', 'Ruimte', html`
          <div class="dimension-summary"><strong>${this._nativeRoomLabel.id}</strong><div>${this._nativeRoomLabel.name}</div></div>
          <button type="button" class="native-button" @click=${() => pubsub.publish('editor.controls.command', { action: 'edit-room-label' })}>Ruimte-ID en naam wijzigen</button>
        `, true) : ''}
        ${!this._nativeHeating && !this._nativeRoomLabel ? html`<label class="native-label">Binding ID</label>
        <input
          class="native-input native-binding-input"
          .value=${this._nativeBindingId}
          maxlength="24"
          @input=${this.#onNativeBindingInput}
          @change=${this.#saveNativeBinding}
          placeholder="e.g. Q1" />` : ''}

        ${!multiple && this._nativeSelectedKind === 'line' ? this.#propertySection('connection', 'Cable & wire', html`
${this.#renderConnectionProperties()}
`, true) : ''}
        ${this._nativeIsRoom ? this.#propertySection('room', 'Room', html`

              <label class="native-label">Room name</label>
              <input
                class="native-input room-name-input"
                .value=${this._nativeRoomName}
                @input=${this.#onRoomNameInput}
                placeholder="e.g. Living" />

`, true) : ''}
        ${!multiple && this._nativeSelectedKind === 'symbol' ? html`
          ${this.#propertySection('product', 'Product info', html`
              <label class="native-label">Manufacturer</label>
              <input
                data-electrical-field="manufacturer"
                class="native-input"
                list="cadle-manufacturers"
                .value=${this.#effectiveElectrical().manufacturer ?? ''}
                @change=${(event: Event) => this.#updateManufacturer((event.target as HTMLInputElement).value)}
                placeholder="e.g. Schneider Electric" />
              <datalist id="cadle-manufacturers">
                <option value="Schneider Electric"></option>
                <option value="TECO"></option>
                <option value="Niko"></option>
                <option value="Hager"></option>
                <option value="ABB"></option>
                <option value="Legrand"></option>
              </datalist>
              <div class="native-row">
                <label
                  ><span class="native-label">Product series</span
                  ><input
                    data-electrical-field="productSeries"
                    class="native-input"
                    .value=${this.#effectiveElectrical().productSeries ?? ''}
                    @change=${(event: Event) =>
                      this.#updateElectrical('productSeries', (event.target as HTMLInputElement).value)}
                    placeholder="e.g. Resi9"
                /></label>
                <label
                  ><span class="native-label">Article reference</span
                  ><input
                    data-electrical-field="productReference"
                    class="native-input native-mono"
                    .value=${this.#effectiveElectrical().productReference ?? ''}
                    @change=${(event: Event) =>
                      this.#updateElectrical('productReference', (event.target as HTMLInputElement).value)}
                    placeholder="e.g. R9F64216"
                /></label>
              </div>

`, false)}
          ${isProtectionDevice ? html`
${this.#propertySection('protection', 'Protection', html`
<label
                        ><span class="native-label">${isResidualBreaker ? 'Rated current (A)' : 'Breaker (A)'}</span
                        ><input
                          data-electrical-field="breakerCurrentA"
                          class="native-input"
                          type="number"
                          min="1"
                          .value=${String(this.#effectiveElectrical().breakerCurrentA ?? '')}
                          @input=${(event: Event) =>
                            this.#updateElectrical('breakerCurrentA', (event.target as HTMLInputElement).value)}
                      /></label>                    ${isResidualBreaker
                      ? ''
                      : html`<div class="native-row">
                          <label
                            ><span class="native-label">Breaker curve</span
                            ><select
                              data-electrical-field="breakerCurve"
                              class="native-select"
                              .value=${this.#effectiveElectrical().breakerCurve ?? ''}
                              @change=${(event: Event) =>
                                this.#updateElectrical('breakerCurve', (event.target as HTMLSelectElement).value)}>
                              <option value="">Not set</option>
                              <option value="B">B</option>
                              <option value="C">C</option>
                              <option value="D">D</option>
                              <option value="other">Other</option>
                            </select></label
                          >
                        </div>`}
                    ${isResidualBreaker
                      ? html`<div class="native-row">
                          <label
                            ><span class="native-label">RCD (mA)</span
                            ><input
                              class="native-input"
                              type="number"
                              min="1"
                              .value=${String(this.#effectiveElectrical().rcdSensitivityMa ?? '')}
                              @change=${(event: Event) =>
                                this.#updateElectrical('rcdSensitivityMa', (event.target as HTMLInputElement).value)}
                          /></label>
                          <label
                            ><span class="native-label">RCD type</span
                            ><select
                              class="native-select"
                              .value=${this.#effectiveElectrical().rcdType ?? ''}
                              @change=${(event: Event) =>
                                this.#updateElectrical('rcdType', (event.target as HTMLSelectElement).value)}>
                              <option value="">Not set</option>
                              <option value="AC">AC</option>
                              <option value="A">A</option>
                              <option value="F">F</option>
                              <option value="B">B</option>
                              <option value="other">Other</option>
                            </select></label
                          >
                        </div>`
                      : ''}

`, true)}
${this.#propertySection('cable', 'Cable', html`
<div class="native-row"><label
                        ><span class="native-label">Cable (mm²)</span
                        ><input
                          data-electrical-field="cableSectionMm2"
                          class="native-input"
                          type="number"
                          min="0.1"
                          step="0.1"
                          .value=${String(this.#effectiveElectrical().cableSectionMm2 ?? '')}
                          @input=${(event: Event) =>
                            this.#updateElectrical('cableSectionMm2', (event.target as HTMLInputElement).value)}
                      /></label><label
                        ><span class="native-label">Conductors</span
                        ><input
                          data-electrical-field="cableConductors"
                          class="native-input"
                          type="number"
                          min="1"
                          step="1"
                          .value=${String(this.#effectiveElectrical().cableConductors ?? '')}
                          @input=${(event: Event) =>
                            this.#updateElectrical('cableConductors', (event.target as HTMLInputElement).value)}
                      /></label></div>
<div class="native-row"><label
                        ><span class="native-label">Cable type</span
                        ><select
                          data-electrical-field="cableType"
                          class="native-select"
                          .value=${this.#effectiveElectrical().cableType ?? ''}
                          @change=${(event: Event) =>
                            this.#updateElectrical('cableType', (event.target as HTMLSelectElement).value)}>
                          <option value="none">Not set</option>
                          <option value="VOB">VOB</option>
                          <option value="XVB">XVB</option>
                          <option value="XVB-Cca">XVB Cca</option>
                          <option value="XGB">XGB</option>
                          <option value="XGB-Cca">XGB Cca</option>
                          <option value="EXVB">EXVB</option>
                          <option value="other">Other</option>
                        </select></label
                      ><label><span class="native-label">Brandklasse (optioneel)</span>
                      <input data-electrical-field="cableFireClass" class="native-input" type="text" maxlength="80"
                        placeholder="Bijv. Cca" .value=${this.#effectiveElectrical().cableFireClass ?? ''}
                        @change=${(event: Event) => this.#updateElectrical('cableFireClass', (event.target as HTMLInputElement).value.trim())} />
                    </label></div>
                    <label class="native-label">Protective conductor</label>
                    <select
                      data-electrical-field="hasProtectiveConductor"
                      class="native-select"
                      .value=${String(this.#effectiveElectrical().hasProtectiveConductor ?? true)}
                      @change=${(event: Event) =>
                        this.#updateElectrical('hasProtectiveConductor', (event.target as HTMLSelectElement).value)}>
                      <option value="true">With yellow/green conductor (G)</option>
                      <option value="false">Without yellow/green conductor (X)</option>
                    </select>
                    <label class="native-label">Installation method</label>
                    <select
                      data-electrical-field="cableInstallation"
                      class="native-select"
                      .value=${this.#effectiveElectrical().showCableInstallation === false
                        ? 'none'
                        : (this.#effectiveElectrical().cableInstallation ?? '')}
                      @change=${(event: Event) =>
                        this.#updateCableInstallation((event.target as HTMLSelectElement).value)}>
                      <option value="none">None</option>
                      <option value="conduit-recessed">In conduit, recessed in wall</option>
                      <option value="conduit">In conduit</option>
                      <option value="without-conduit">Without conduit</option>
                      <option value="on-wall">On wall</option>
                      <option value="recessed">Recessed in wall</option>
                      <option value="underground">Underground</option>
                    </select>

`, true)}
${this.#propertySection('supply', 'Supply & neutral', html`
                    <label class="native-label">Supply</label>
                    <div
                      class="native-chip-row native-supply-options"
                      role="radiogroup"
                      aria-label="Supply phase">
                      ${(
                        [
                          ['L1 + N', 'L1+N', 2],
                          ['L2 + N', 'L2+N', 2],
                          ['L3 + N', 'L3+N', 2],
                          ['3F', 'three-phase', 3],
                          ['3F + N', 'L1+L2+L3+N', 4]
                        ] as const
                      ).map(
                        ([label, phaseConfiguration, poles]) => html`
                          <button
                            type="button"
                            class="native-chip"
                            data-active=${this.#effectiveElectrical().phaseConfiguration === phaseConfiguration &&
                            this.#effectiveElectrical().poles === poles
                              ? 'true'
                              : 'false'}
                            aria-checked=${this.#effectiveElectrical().phaseConfiguration === phaseConfiguration &&
                            this.#effectiveElectrical().poles === poles
                              ? 'true'
                              : 'false'}
                            role="radio"
                            @click=${() => this.#setSupplyPreset(phaseConfiguration, poles)}>
                            ${label}
                          </button>
                        `
                      )}
                    </div>
                    <label class="native-check-row">
                      <input
                        type="checkbox"
                        .checked=${this.#effectiveElectrical().showPhaseLabel !== false}
                        @change=${(event: Event) =>
                          this.#setPhaseLabelVisibility((event.target as HTMLInputElement).checked)} />
                      <span>Show phase label</span>
                    </label>
                    <label class="native-label">Neutral position</label>
                    <div
                      class="native-chip-row native-neutral-options"
                      role="radiogroup"
                      aria-label="Neutral position">
                      ${(
                        [
                          ['Auto', ''],
                          ['N left', 'left'],
                          ['N right', 'right']
                        ] as const
                      ).map(
                        ([label, neutralPosition]) => html`
                          <button
                            type="button"
                            class="native-chip"
                            data-active=${(this._nativeElectrical?.neutralPosition ?? '') === neutralPosition
                              ? 'true'
                              : 'false'}
                            aria-checked=${(this._nativeElectrical?.neutralPosition ?? '') === neutralPosition
                              ? 'true'
                              : 'false'}
                            role="radio"
                            @click=${() => this.#setNeutralPosition(neutralPosition)}>
                            ${label}
                          </button>
                        `
                      )}
                    </div>

`, false)}
` : ''}
${this.#propertySection('circuit', 'Circuit', html`
              <label class="native-label">Role</label>
              <select
                class="native-select"
                .value=${this.#effectiveElectrical().role ?? ''}
                @change=${(event: Event) => this.#updateElectrical('role', (event.target as HTMLSelectElement).value)}>
                <option value="">Not classified</option>
                <option value="switch">Switch</option>
                <option value="load">Load</option>
                <option value="protection">Protection</option>
                <option value="junction">Junction</option>
                <option value="neutral">Other</option>
              </select>
              <label class="native-label">Circuit type</label>
              <select
                class="native-select"
                .value=${this.#effectiveElectrical().circuitType ?? ''}
                @change=${(event: Event) =>
                  this.#updateElectrical('circuitType', (event.target as HTMLSelectElement).value)}>
                <option value="">Infer from symbol</option>
                <option value="lighting">Lighting</option>
                <option value="sockets">Sockets</option>
                <option value="motor">Motor</option>
                <option value="mixed">Mixed</option>
                <option value="other">Other</option>
              </select>
${isProtectionDevice ? html`                    <div class="native-row">
                      <label
                        ><span class="native-label">Board</span
                        ><input
                          class="native-input"
                          .value=${this.#effectiveElectrical().boardId ?? ''}
                          @change=${(event: Event) =>
                            this.#updateElectrical('boardId', (event.target as HTMLInputElement).value)}
                          placeholder="main"
                      /></label>
                    </div>
                    <label class="native-label">Rail</label
                    ><input
                      class="native-input"
                      .value=${this.#effectiveElectrical().railId ?? ''}
                      @change=${(event: Event) =>
                        this.#updateElectrical('railId', (event.target as HTMLInputElement).value)}
                      placeholder="rail-1" />
                    <label class="native-label">Circuit notes</label
                    ><textarea
                      class="native-input"
                      .value=${this.#effectiveElectrical().notes ?? ''}
                      @change=${(event: Event) =>
                        this.#updateElectrical('notes', (event.target as HTMLTextAreaElement).value)}></textarea>
` : ''}        <div
          class="circuit-actions"
          aria-label="Circuit operations">
          <button
            type="button"
            class="native-button"
            title="Rename the entire selected circuit"
            @click=${() => this.#runCircuitOperation('replace')}>
            <custom-icon icon="swap_horiz"></custom-icon><span>Replace</span>
          </button>
          <button
            type="button"
            class="native-button"
            title="Combine all circuits represented by the selection"
            @click=${() => this.#runCircuitOperation('combine')}>
            <custom-icon icon="merge"></custom-icon><span>Combine</span>
          </button>
          <button
            type="button"
            class="native-button"
            title="Move selected points to a new circuit"
            @click=${() => this.#runCircuitOperation('split')}>
            <custom-icon icon="call_split"></custom-icon><span>Split</span>
          </button>
        </div>

`, false)}
` : ''}
        ${!this._nativeHeating && (multiple || this._nativeSelectedKind !== 'symbol') ? this.#propertySection('circuit-operations', 'Circuit operations', html`
        <div
          class="circuit-actions"
          aria-label="Circuit operations">
          <button
            type="button"
            class="native-button"
            title="Rename the entire selected circuit"
            @click=${() => this.#runCircuitOperation('replace')}>
            <custom-icon icon="swap_horiz"></custom-icon><span>Replace</span>
          </button>
          <button
            type="button"
            class="native-button"
            title="Combine all circuits represented by the selection"
            @click=${() => this.#runCircuitOperation('combine')}>
            <custom-icon icon="merge"></custom-icon><span>Combine</span>
          </button>
          <button
            type="button"
            class="native-button"
            title="Move selected points to a new circuit"
            @click=${() => this.#runCircuitOperation('split')}>
            <custom-icon icon="call_split"></custom-icon><span>Split</span>
          </button>
        </div>

`, false) : ''}
        ${this.#propertySection('layout', 'Position & layout', html`
        <label class="native-label">Label position</label>
        <div
          class="native-chip-row native-label-options"
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
        ${this._nativeBusbarLength !== null
          ? html`
              <label class="native-label">Busbar length</label>
              <div class="native-row">
                <button
                  type="button"
                  class="native-btn-icon"
                  title="Shorten by one grid block"
                  @click=${() => this.#adjustBusbarLength(-1)}>
                  −
                </button>
                <input
                  type="number"
                  class="native-input native-input-sm"
                  min="4"
                  max="500"
                  step="1"
                  .value=${String(Math.round(this._nativeBusbarLength / GRID_SIZE))}
                  @change=${this.#onBusbarLengthInput} />
                <span class="native-unit">blocks</span>
                <button
                  type="button"
                  class="native-btn-icon"
                  title="Extend by one grid block"
                  @click=${() => this.#adjustBusbarLength(1)}>
                  +
                </button>
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

`, false)}
        ${this._nativeSelectedKind === 'text' && !this._nativeRoomLabel ? this.#propertySection('text', 'Text', html`
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
                      pubsub.publish('editor.object.update', { fontFamily: value })
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

`, true) : ''}
        ${!multiple && this._nativeSelectedKind === 'symbol' && this._nativeSymbolTextFields.some((field) => field.key !== 'description') ? this.#propertySection('symbol-text', 'Symbol labels', html`
        ${this._nativeSelectedKind === 'symbol' && this._nativeSymbolTextFields.some((field) => field.key !== 'description')
          ? html`
              <label class="native-label">Symbol text fields</label>
              ${this._nativeSymbolTextFields.filter((field) => field.key !== 'description').map(
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

`, false) : ''}
        ${this.#propertySection('appearance', 'Appearance', html`
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

`, false)}
        ${this.#propertySection('details', 'Object details', html`
        ${multiple
          ? html`<div class="native-note">Binding updates apply to all selected objects.</div>`
          : html`
              <div class="native-kv"><span>Type</span><strong>${this._nativeConnection ? CONNECTION_NAMES[this._nativeConnection.kind] : this._nativeSelectedKind || '-'}</strong></div>
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

`, false)}
      </section>
        <div class="native-actions selection-actions">
          ${this._canConvertToRoom
            ? html`<button
                type="button"
                class="native-button"
                @click=${this.#convertSelectionToRoom}>
                Convert to room
              </button>`
            : ''}
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
