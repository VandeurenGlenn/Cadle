import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './binding.css' with { type: 'css' }
import { map } from '@vandeurenglenn/lite/map.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/select/filled-select.js'
import '@material/web/select/select-option.js'
import '@material/web/button/text-button.js'
import './../../items/object.js'
import {
  WIRE_SECTION_BREAKER_TABLE,
  defaultWireSectionForGroupMembers,
  normalizeWireSection,
  wireSectionToBreakerAmperage
} from '../../../helpers/wire-section.js'
import { voltageDrop, inferCircuitType, type VoltageDropResult } from '../../../helpers/voltage-drop.js'
import { selectivityBetween, type SelectivityResult } from '../../../helpers/selectivity.js'
@customElement('object-binding')
export class ObjectBinding extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active = false
  @property({ type: String, attribute: false })
  private accessor _statusTone: 'idle' | 'ok' | 'warn' = 'idle'

  @property({ type: String, attribute: false })
  private accessor _statusLabel = 'No binding set'

  @property({ type: String, attribute: false })
  private accessor _statusHint =
    'Use IDs like A1 to connect switches, sockets, and loads across situation-plan and one-line workflows.'

  @property({ type: String, attribute: false })
  private accessor _selectionRole = 'No role detected'

  @property({ type: Object, attribute: false })
  private accessor _groupSummary: { wireSection: string; breakerAmperage: number; override: boolean } | null = null

  @property({ type: Number, attribute: false })
  private accessor _cableLength = 15

  @property({ type: Number, attribute: false })
  private accessor _upstreamA = 40

  @property({ type: Object, attribute: false })
  private accessor _voltageDrop: VoltageDropResult | null = null

  @property({ type: Object, attribute: false })
  private accessor _selectivity: SelectivityResult | null = null

  @query('#binding-id')
  private accessor _bindingInput!: any

  @query('#binding-label')
  private accessor _bindingLabelInput!: any

  static styles = [styles]


  firstRender(): void {
    const canvas = cadleShell?.field?.canvas
    if (canvas) {
      canvas.on('selection:created', () => this.#syncFromCanvas())
      canvas.on('selection:updated', () => this.#syncFromCanvas())
      canvas.on('selection:cleared', () => this.#syncFromCanvas())
      canvas.on('object:modified', () => this.#syncFromCanvas())
    }

    this.#syncFromCanvas()
  }

  #normalizeBindingId(value: string) {
    return value.trim()
  }

  #normalizedBindingKey(value: unknown) {
    if (typeof value !== 'string') return ''
    return value.trim().toUpperCase()
  }

  #isValidBindingId(value: string) {
    return /^[A-Z]\d+$/.test(this.#normalizedBindingKey(value))
  }

  #inferBindingRole(object: any) {
    const explicitRole = String(object?.bindingRole ?? '').toLowerCase()
    if (explicitRole === 'socket') return 'load'
    if (explicitRole === 'switch' || explicitRole === 'load') return explicitRole
    const haystack = `${object?.symbolPath ?? ''} ${object?.symbolName ?? ''} ${object?.type ?? ''}`.toLowerCase()
    if (haystack.includes('/switches/') || haystack.includes(' switch')) return 'switch'
    if (
      haystack.includes('/consumption appliances/') ||
      haystack.includes('/electrical devices/') ||
      haystack.includes('/socket outlets/') ||
      haystack.includes('socket outlet') ||
      haystack.includes('socket') ||
      haystack.includes('light') ||
      haystack.includes('lamp')
    ) {
      return 'load'
    }
    return 'neutral'
  }

  #updateBindingStatus() {
    const canvas = cadleShell?.field?.canvas
    const activeObjects = (canvas?.getActiveObjects?.() ?? []) as any[]
    const rawValue = String(this._bindingInput?.value ?? '')
    const normalized = this.#normalizedBindingKey(rawValue)
    // Dispatch highlighting event for net visualization
    this.dispatchEvent(
      new CustomEvent('binding-id-focus', {
        bubbles: true,
        composed: true,
        detail: { bindingId: normalized }
      })
    )
    // Get current design mode from state
    let designMode = 'free'
    try {
      // Dynamically import state to avoid circular deps
      // @ts-ignore
      designMode = window.state?.designMode || window.cadleShell?.state?.designMode || 'free'
    } catch {}

    if (activeObjects.length === 0) {
      this._selectionRole = 'No role detected'
      this._statusTone = 'idle'
      this._statusLabel = 'No binding set'
      // Mode-specific hint
      if (designMode === 'situation-first') {
        this._statusHint =
          'Bind devices after placing them on the situation plan. Use IDs like A1 to link to the one-line.'
      } else if (designMode === 'one-line-first') {
        this._statusHint = 'Bind one-line symbols first, then link to situation plan devices using shared IDs like A1.'
      } else {
        this._statusHint =
          'Use IDs like A1 to connect switches, sockets, and loads across situation-plan and one-line workflows.'
      }

      this._groupSummary = null
      return
    }

    const primaryRole = this.#inferBindingRole(activeObjects[0])
    const hasMixedRoles = activeObjects.some((object) => this.#inferBindingRole(object) !== primaryRole)
    this._selectionRole = hasMixedRoles ? 'Mixed selection' : `${primaryRole} role`
    if (!normalized) {
      this._statusTone = 'idle'
      this._statusLabel = 'No binding set'
      this._statusHint = 'Enter a shared ID to include this object in the one-line binding workflow.'
      return
    }

    if (!this.#isValidBindingId(rawValue)) {
      this._statusTone = 'warn'
      this._statusLabel = 'Malformed binding ID'
      this._statusHint = 'Expected format is a capital letter followed by a number, for example A1 or C12.'
      return
    }

    const linkedObjects = ((canvas?.getObjects?.() ?? []) as any[]).filter(
      (object) => this.#normalizedBindingKey(String(object?.bindingId ?? '')) === normalized
    )
    const switchCount = linkedObjects.filter((object) => this.#inferBindingRole(object) === 'switch').length
    const loadCount = linkedObjects.filter((object) => this.#inferBindingRole(object) === 'load').length
    const neutralCount = linkedObjects.length - switchCount - loadCount
    // Group-level wire section + breaker amperage. Read any explicit
    // override stored on a member, otherwise derive from member roles.
    if (linkedObjects.length > 0) {
      const overrideMember = linkedObjects.find((o: any) => !!o?.bindingGroupWireSectionOverride)
      const explicitSection = linkedObjects.find((o: any) => !!o?.bindingGroupWireSection)?.bindingGroupWireSection
      const wireSection = explicitSection
        ? normalizeWireSection(explicitSection).section
        : defaultWireSectionForGroupMembers(
          linkedObjects.map((o: any) => ({
            role: this.#inferBindingRole(o),
            symbolPath: o?.symbolPath,
            symbolName: o?.symbolName
          }))
        )
      this._groupSummary = {
        wireSection,
        breakerAmperage: wireSectionToBreakerAmperage(wireSection),
        override: !!overrideMember
      }
      // Read persisted compliance inputs from any member.
      const persistedLen = linkedObjects.find(
        (o: any) => typeof o?.bindingGroupCableLengthMeters === 'number'
      )?.bindingGroupCableLengthMeters
      const persistedUp = linkedObjects.find(
        (o: any) => typeof o?.bindingGroupUpstreamProtectionA === 'number'
      )?.bindingGroupUpstreamProtectionA
      if (typeof persistedLen === 'number' && persistedLen >= 0) this._cableLength = persistedLen
      if (typeof persistedUp === 'number' && persistedUp > 0) this._upstreamA = persistedUp
      this.#recomputeCompliance(linkedObjects)
    } else {
      this._groupSummary = null
      this._voltageDrop = null
      this._selectivity = null
    }

    this._statusTone = switchCount > 0 && loadCount > 0 ? 'ok' : linkedObjects.length > 1 ? 'ok' : 'idle'
    this._statusLabel = `${normalized} linked to ${linkedObjects.length} object${linkedObjects.length === 1 ? '' : 's'}`
    const summary = [
      `${switchCount} switch${switchCount === 1 ? '' : 'es'}`,
      `${loadCount} load${loadCount === 1 ? '' : 's'}`
    ]
    if (neutralCount > 0) summary.push(`${neutralCount} other`)
    this._statusHint =
      switchCount > 0 && loadCount > 0
        ? `${summary.join(', ')} share this ID. This binding is ready for one-line mapping.`
        : `${summary.join(', ')} share this ID. Add both a switch and a load to complete the electrical link.`
  }

  #syncFromCanvas() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas || !this._bindingInput) return
    const activeObject = canvas.getActiveObject() as any
    if (!activeObject) {
      this._bindingInput.value = ''
      if (this._bindingLabelInput) this._bindingLabelInput.value = ''
      this.#updateBindingStatus()
      return
    }

    this._bindingInput.value = String(activeObject.bindingId ?? '')
    if (this._bindingLabelInput) {
      this._bindingLabelInput.value = String(activeObject.bindingLabel ?? activeObject.bindingId ?? '')
    }

    this.#updateBindingStatus()
  }

  #linkedObjectsForActiveBinding() {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return { canvas: null as any, linked: [] as any[], bindingKey: '' }
    const rawValue = String(this._bindingInput?.value ?? '')
    const bindingKey = this.#normalizedBindingKey(rawValue)
    if (!bindingKey) return { canvas, linked: [] as any[], bindingKey }
    const linked = ((canvas.getObjects?.() ?? []) as any[]).filter(
      (object) => this.#normalizedBindingKey(String(object?.bindingId ?? '')) === bindingKey
    )
    return { canvas, linked, bindingKey }
  }

  #applyWireSection(value: string) {
    const { canvas, linked } = this.#linkedObjectsForActiveBinding()
    if (!canvas || linked.length === 0) return
    const section = normalizeWireSection(value).section
    for (const obj of linked) {
      obj.set({ bindingGroupWireSection: section, bindingGroupWireSectionOverride: true })
      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  #applyCableLength(value: number) {
    const { canvas, linked } = this.#linkedObjectsForActiveBinding()
    if (!canvas || linked.length === 0) return
    for (const obj of linked) {
      obj.set({ bindingGroupCableLengthMeters: value })
      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
  }

  #applyUpstreamProtection(value: number) {
    const { canvas, linked } = this.#linkedObjectsForActiveBinding()
    if (!canvas || linked.length === 0) return
    for (const obj of linked) {
      obj.set({ bindingGroupUpstreamProtectionA: value })
      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
  }

  #resetWireSection() {
    const { canvas, linked } = this.#linkedObjectsForActiveBinding()
    if (!canvas || linked.length === 0) return
    for (const obj of linked) {
      obj.set({ bindingGroupWireSection: undefined, bindingGroupWireSectionOverride: false })
      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  #applyBindingId(value: string) {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObjects = canvas.getActiveObjects() as any[]
    if (activeObjects.length === 0) return
    const bindingId = this.#normalizeBindingId(value)
    for (const obj of activeObjects) {
      if (bindingId) {
        obj.set({ bindingId, bindingLabel: bindingId })
      } else {
        obj.set({ bindingId: undefined, bindingLabel: undefined })
      }

      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  #applyBindingLabel(value: string) {
    const canvas = cadleShell?.field?.canvas
    if (!canvas) return
    const activeObjects = canvas.getActiveObjects() as any[]
    if (activeObjects.length === 0) return

    const bindingLabel = this.#normalizeBindingId(value)
    for (const obj of activeObjects) {
      if (bindingLabel) {
        obj.set({ bindingLabel, bindingId: bindingLabel })
      } else {
        obj.set({ bindingLabel: undefined, bindingId: undefined })
      }

      obj.setCoords()
      canvas.fire('object:modified', { target: obj } as any)
    }

    canvas.requestRenderAll()
    this.#syncFromCanvas()
  }

  #recomputeCompliance(linkedObjects: any[]) {
    if (!this._groupSummary) {
      this._voltageDrop = null
      this._selectivity = null
      return
    }

    const sectionMm2 = normalizeWireSection(this._groupSummary.wireSection).sectionMm2
    const breakerA = this._groupSummary.breakerAmperage
    const circuitType = inferCircuitType(
      linkedObjects.map((o: any) => ({
        symbolPath: o?.symbolPath,
        symbolName: o?.symbolName,
        role: this.#inferBindingRole(o)
      }))
    )
    this._voltageDrop = voltageDrop(
      { lengthMeters: this._cableLength, currentAmperes: breakerA, sectionMm2 },
      circuitType
    )
    this._selectivity = selectivityBetween(this._upstreamA, breakerA)
  }

  #renderComplianceCard = () => {
    const vd = this._voltageDrop
    const sel = this._selectivity
    return html`
      <div class="compliance-card">
        <div class="compliance-inputs">
          <md-filled-text-field
            label="Cable length (m)"
            type="number"
            .value=${String(this._cableLength)}
            @input=${(e: Event) => {
    const v = parseFloat((e.target as any).value)
    if (!isNaN(v) && v >= 0) {
      this._cableLength = v
      this.#applyCableLength(v)
      this.#updateBindingStatus()
    }
  }}>
          </md-filled-text-field>
          <md-filled-text-field
            label="Upstream protection (A)"
            type="number"
            .value=${String(this._upstreamA)}
            @input=${(e: Event) => {
    const v = parseFloat((e.target as any).value)
    if (!isNaN(v) && v > 0) {
      this._upstreamA = v
      this.#applyUpstreamProtection(v)
      this.#updateBindingStatus()
    }
  }}>
          </md-filled-text-field>
        </div>
        ${vd
    ? html`<div class="compliance-row">
                <span
                  class="compliance-dot"
                  data-status=${vd.status}></span>
                <span><strong>Voltage drop</strong> ${vd.dropPercent.toFixed(2)} % (limit ${vd.limitPercent} %)</span>
                <span>${vd.dropVolts.toFixed(1)} V</span>
              </div>
              <div class="compliance-hint">${vd.hint}</div>`
    : ''}
        ${sel
    ? html`<div class="compliance-row">
                <span
                  class="compliance-dot"
                  data-status=${sel.status}></span>
                <span><strong>Selectivity</strong> ratio ${sel.ratio.toFixed(2)}×</span>
                <span>${sel.status}</span>
              </div>
              <div class="compliance-hint">${sel.hint}</div>`
    : ''}
      </div>
    `
  }

  render() {
    return html`
      <object-item
        label="binding"
        icon="link">
        <div class="binding-grid">
          <md-filled-text-field
            id="binding-id"
            label="Binding ID (A1)"
            type="text"
            supporting-text="Shared ID used to link switches, loads, and bound one-line symbols"
            @input=${() => this.#updateBindingStatus()}
            @change=${(e: Event) => this.#applyBindingId((e.target as any).value)}>
          </md-filled-text-field>
          <md-filled-text-field
            id="binding-label"
            label="Binding label"
            type="text"
            supporting-text="Synced with Binding ID. Editing one updates the other."
            @change=${(e: Event) => this.#applyBindingLabel((e.target as any).value)}>
          </md-filled-text-field>
          <div
            class="status-card"
            data-tone=${this._statusTone}>
            <div class="role-pill">${this._selectionRole}</div>
            <div class="status-label">${this._statusLabel}</div>
            <div class="status-hint">${this._statusHint}</div>
            ${this._groupSummary
    ? html`<div class="wire-section-row">
                  <md-filled-select
                    class="wire-section-select"
                    label="Wire section"
                    .value=${this._groupSummary.wireSection}
                    @change=${(e: Event) => this.#applyWireSection((e.target as any).value)}>
                    ${WIRE_SECTION_BREAKER_TABLE.map(
    (row) =>
      html`<md-select-option value=${row.section}>
                          <div slot="headline">${row.section} → ${row.breakerAmperage} A</div>
                        </md-select-option>`
  )}
                  </md-filled-select>
                  <div class="wire-section-meta">
                    Breaker:
                    <strong>${this._groupSummary.breakerAmperage} A</strong>
                    ${this._groupSummary.override
    ? html`<span class="override-pill">override</span>
                          <md-text-button
                            class="reset-btn"
                            @click=${() => this.#resetWireSection()}
                            >Reset</md-text-button
                          >`
    : html`<span class="derived-pill">derived (AREI)</span>`}
                  </div>
                </div>`
    : ''}
            ${this._groupSummary ? this.#renderComplianceCard() : ''}
          </div>
        </div>
      </object-item>
    `
  }
}
