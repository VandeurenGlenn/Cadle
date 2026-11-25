import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import baseStyles from './input-form-dialog.css' with { type: 'css' }
import styles from './solar-installation-dialog.css' with { type: 'css' }
import { distributeSolarPanels, parseInverterDatasheet, parseSolarDatasheet, solarStringPanelCounts, solarPanelFields, validateSolarInstallation,
  type SolarInstallation, type SolarInverter, type SolarPanel, type SolarPanelArray } from '../../editor/solar-installation.js'
import { readSolarDatasheet } from '../../editor/solar-datasheet-import.js'

export type SolarInstallationRequest = {
  rails: { id: string; label: string }[]
  railId?: string
  installation?: SolarInstallation
}
export type SolarInstallationResult = { railId: string; installation: SolarInstallation; newEquipment: boolean }
type DatasheetKind = 'panels' | 'inverter'

@customElement('solar-installation-dialog')
export class SolarInstallationDialog extends LiteElement {
  static styles = [baseStyles, styles]
  @property({ attribute: false }) accessor values: Record<string, string> = {}
  @property({ attribute: false }) accessor stringPanels: string[] = ['1']
  @property({ attribute: false }) accessor panels: Partial<SolarPanel>[] = []
  @property({ attribute: false }) accessor inverters: Partial<SolarInverter>[] = []
  @property({ attribute: false }) accessor warnings: Record<DatasheetKind, string[]> = { panels: [], inverter: [] }
  @property({ attribute: false }) accessor datasheetTexts: Record<DatasheetKind, string> = { panels: '', inverter: '' }
  @property({ type: String }) accessor error = ''
  @property({ type: String }) accessor status = ''
  @property({ type: Boolean }) accessor busy = false
  @property({ type: Boolean }) accessor open = false
  #request: SolarInstallationRequest = { rails: [] }
  #resolve: ((result: SolarInstallationResult | null) => void) | null = null
  #sequence = 0

  show(request: SolarInstallationRequest): Promise<SolarInstallationResult | null> {
    this.#resolve?.(null)
    this.#sequence++
    this.#request = request
    const previous = request.installation
    this.values = { railId: request.rails.some((rail) => rail.id === request.railId) ? request.railId! : request.rails[0]?.id ?? '',
      panelCount: '1', stringCount: '1', phases: '1', kind: previous?.kind ?? 'installation',
      ...(previous ? Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'panel' && key !== 'kind' && key !== 'panelsPerString').map(([key, value]) => [key, String(value)])) : {}),
      ...(previous && previous.kind !== 'inverter' ? Object.fromEntries(Object.entries(previous.panel).map(([key, value]) => [key, String(value)])) : {}) }
    this.stringPanels = previous && previous.kind !== 'inverter' ? solarStringPanelCounts(previous).map(String) : ['1']
    this.panels = []
    this.inverters = []
    this.warnings = { panels: [], inverter: [] }
    this.datasheetTexts = { panels: '', inverter: '' }
    this.error = ''
    this.status = ''
    this.busy = false
    this.open = true
    this.setAttribute('data-open', '')
    this.setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => this.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus())
    return new Promise((resolve) => { this.#resolve = resolve })
  }

  #close = (result: SolarInstallationResult | null = null) => {
    this.#sequence++
    this.open = false
    this.removeAttribute('data-open')
    this.setAttribute('aria-hidden', 'true')
    this.#resolve?.(result)
    this.#resolve = null
  }

  #startNew = () => {
    const kind = this.#request.installation?.kind === 'panels' ? 'inverter' : 'panels'
    this.#request = { ...this.#request, installation: undefined }
    this.values = { kind, railId: this.#request.railId ?? this.#request.rails[0]?.id ?? '',
      panelCount: '1', stringCount: '1', phases: '1' }
    this.stringPanels = ['1']
    this.panels = []
    this.inverters = []
    this.warnings = { panels: [], inverter: [] }
    this.datasheetTexts = { panels: '', inverter: '' }
    this.error = ''
    this.status = ''
  }

  #parse(text: string, kind: DatasheetKind) {
    this.datasheetTexts = { ...this.datasheetTexts, [kind]: text }
    if (kind === 'panels') {
      const parsed = parseSolarDatasheet(text)
      this.panels = parsed.panels
      this.warnings = { ...this.warnings, panels: parsed.warnings }
      this.values = { ...this.values, variant: '' }
      if (parsed.panels.length === 1) this.#choosePanel(parsed.panels[0])
    } else {
      const parsed = parseInverterDatasheet(text)
      this.inverters = parsed.inverters
      this.warnings = { ...this.warnings, inverter: parsed.warnings }
      this.values = { ...this.values, inverterVariant: '' }
      if (parsed.inverters.length === 1) this.#chooseInverter(parsed.inverters[0])
    }
    this.error = ''
  }

  #choosePanel(panel: Partial<SolarPanel>) {
    this.values = { ...this.values, model: panel.model ?? '',
      ...Object.fromEntries(solarPanelFields.map(({ key }) => [key, panel[key] === undefined ? '' : String(panel[key])])) }
  }

  #chooseInverter(inverter: Partial<SolarInverter>) {
    this.values = { ...this.values, inverterModel: inverter.inverterModel ?? '',
      inverterPowerW: inverter.inverterPowerW === undefined ? '' : String(inverter.inverterPowerW),
      maxDcVoltageV: inverter.maxDcVoltageV === undefined ? '' : String(inverter.maxDcVoltageV),
      mpptCount: inverter.mpptCount === undefined ? '' : String(inverter.mpptCount),
      ...(inverter.inverterManufacturer ? { inverterManufacturer: inverter.inverterManufacturer } : {}),
      ...(inverter.phases ? { phases: String(inverter.phases) } : {}) }
  }

  #readFile(event: Event, kind: DatasheetKind) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void this.#recognizeDatasheet(file, kind)
  }

  async #recognizeDatasheet(file: File, kind: DatasheetKind) {
    if (this.busy) return
    const sequence = ++this.#sequence
    this.busy = true
    this.error = ''
    this.status = 'Datasheet lokaal lezen…'
    try {
      const text = await readSolarDatasheet(file, (status) => {
        if (sequence === this.#sequence) this.status = status
      }, () => sequence === this.#sequence)
      if (sequence !== this.#sequence) return
      this.#parse(text, kind)
      this.status = 'Herkenning klaar. Controleer de variant en alle waarden.'
    } catch (error) {
      if (sequence === this.#sequence) this.error = `Lezen mislukt: ${error instanceof Error ? error.message : String(error)}. Je kunt de gegevens handmatig invullen.`
    } finally {
      if (sequence === this.#sequence) this.busy = false
    }
  }

  #submit = (event: SubmitEvent) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    if (this.busy || !form.reportValidity()) return
    const values = this.values
    const kind = values.kind
    if (kind !== 'installation' && kind !== 'panels' && kind !== 'inverter') {
      this.error = 'Kies welk onderdeel je wilt toevoegen.'
      return
    }
    const panels: SolarPanelArray = {
      panel: { manufacturer: values.manufacturer?.trim() ?? '', model: values.model?.trim() ?? '', powerWp: Number(values.powerWp),
        ...Object.fromEntries(solarPanelFields.slice(1).filter(({ key }) => values[key]?.trim())
          .map(({ key }) => [key, Number(values[key].replace(',', '.'))])) },
      panelCount: Number(values.panelCount), stringCount: Number(values.stringCount),
      panelsPerString: this.stringPanels.map(Number)
    }
    const inverter: SolarInverter = {
      inverterManufacturer: values.inverterManufacturer?.trim() ?? '', inverterModel: values.inverterModel?.trim() ?? '',
      inverterPowerW: Number(values.inverterPowerW), phases: values.phases === '3' ? 3 : 1,
      breakerCurrentA: Number(values.breakerCurrentA),
      ...(values.maxDcVoltageV?.trim() ? { maxDcVoltageV: Number(values.maxDcVoltageV) } : {}),
      ...(values.mpptCount?.trim() ? { mpptCount: Number(values.mpptCount) } : {})
    }
    const installation: SolarInstallation = kind === 'panels' ? { ...panels, kind }
      : kind === 'inverter' ? { ...inverter, kind } : { ...panels, ...inverter }
    this.error = validateSolarInstallation(installation) ?? ''
    if (!this.error) this.#close({ railId: values.railId, installation, newEquipment: !this.#request.installation })
  }

  #field(key: string, label: string, numeric = false, required = false, integer = false) {
    return html`<label><span>${label}</span><input name=${key} aria-label=${label}
      type=${numeric ? 'number' : 'text'} step=${integer ? '1' : 'any'} min=${numeric ? integer ? '1' : '0.001' : ''}
      ?required=${required} .value=${this.values[key] ?? ''}
      @input=${(event: Event) => {
        this.values = { ...this.values, [key]: (event.target as HTMLInputElement).value }
        if (key === 'panelCount' || key === 'stringCount') {
          this.stringPanels = distributeSolarPanels(Number(this.values.panelCount), Number(this.values.stringCount)).map(String)
          this.error = ''
        }
      }} /></label>`
  }

  #datasheet(kind: DatasheetKind) {
    const panel = kind === 'panels'
    const label = panel ? 'paneelfiche' : 'omvormerfiche'
    return html`
      <label><span>PDF of afbeelding van ${label}</span>
        <input aria-label=${`PDF of afbeelding van ${label}`} type="file" accept="application/pdf,.pdf,image/*"
          @change=${(event: Event) => this.#readFile(event, kind)} /></label>
      <small>Herkenning gebeurt lokaal, zonder upload. ${panel
        ? 'Alleen STC-waarden worden overgenomen.' : 'Nominaal AC-uitgangsvermogen is niet hetzelfde als aanbevolen DC-paneelvermogen.'}
        PDF-tekst wordt rechtstreeks gelezen; scans via tekstherkenning. Kies bij meerdere kolommen altijd je eigen variant.</small>
      <details><summary>Herkende tekst controleren of tekst plakken</summary>
        <textarea data-datasheet=${kind} aria-label=${`Tekst van ${label}`} rows="5" .value=${this.datasheetTexts[kind]}
          @input=${(event: Event) => { this.datasheetTexts = { ...this.datasheetTexts, [kind]: (event.target as HTMLTextAreaElement).value } }}></textarea>
        <button type="button" @click=${() => this.#parse(
          this.shadowRoot!.querySelector<HTMLTextAreaElement>(`textarea[data-datasheet="${kind}"]`)!.value, kind)}>
          ${panel ? 'Paneeltekst verwerken' : 'Omvormertekst verwerken'}</button>
      </details>
      ${this.warnings[kind].length ? html`<ul class="warnings">${this.warnings[kind].map((warning) => html`<li>${warning}</li>`)}</ul>` : ''}`
  }

  render() {
    if (!this.open) return html``
    const watts = Number(this.values.powerWp) * Number(this.values.panelCount)
    return html`<form role="dialog" aria-modal="true" aria-labelledby="pv-title" @submit=${this.#submit}
      @paste=${(event: ClipboardEvent) => {
        event.stopPropagation()
        const file = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/') || file.type === 'application/pdf')
        const target = event.target instanceof Element ? event.target.closest('[data-equipment]')?.getAttribute('data-equipment') : undefined
        if (file) { event.preventDefault(); void this.#recognizeDatasheet(file,
          target === 'inverter' || (!target && this.values.kind === 'inverter') ? 'inverter' : 'panels') }
      }}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); this.#close() }
      }}>
      <header><h2 id="pv-title">Omvormer en zonnepanelen</h2><p>Voeg onderdelen apart of samen toe. Elk onderdeel heeft een eigen fabrikant en datasheet. Open een PDF of afbeelding, of plak een foto in het juiste onderdeel. Daarna klik je op het schema om de plaats te kiezen.</p></header>
      <label><span>Onderdeel</span><select aria-label="Onderdeel" ?disabled=${this.busy || Boolean(this.#request.installation)}
        @change=${(event: Event) => { this.values = { ...this.values, kind: (event.target as HTMLSelectElement).value }; this.error = '' }}>
        <option value="installation" .selected=${this.values.kind === 'installation'}>Omvormer en zonnepanelen</option>
        <option value="inverter" .selected=${this.values.kind === 'inverter'}>Alleen omvormer</option>
        <option value="panels" .selected=${this.values.kind === 'panels'}>Alleen zonnepanelen</option>
      </select></label>
      ${this.values.kind !== 'inverter' ? html`<fieldset data-equipment="panels" ?disabled=${this.busy}>
        <legend>Zonnepanelen</legend>
        ${this.#datasheet('panels')}
        ${this.panels.length > 1 ? html`<label><span>Paneelvariant</span>
          <select aria-label="Paneelvariant" required .value=${this.values.variant ?? ''} @change=${(event: Event) => {
            const index = (event.target as HTMLSelectElement).value
            this.values = { ...this.values, variant: index }
            if (index !== '') this.#choosePanel(this.panels[Number(index)])
          }}><option value="">Kies de juiste kolom</option>${this.panels.map((panel, index) =>
            html`<option value=${String(index)}>${panel.model || `Variant ${index + 1}`} · ${panel.powerWp ?? '?'} Wp</option>`)}</select></label>` : ''}
      <div class="fields">
        ${this.#field('manufacturer', 'Merk panelen')}
        ${this.#field('model', 'Paneelmodel', false, true)}
        ${solarPanelFields.map(({ key, label }) => this.#field(key, label, true, key === 'powerWp'))}
        ${this.#field('panelCount', 'Aantal panelen', true, true, true)}
        ${this.#field('stringCount', 'Aantal strings', true, true, true)}
      </div>
      <div class="fields">${this.stringPanels.map((count, index) => html`
        <label><span>String ${index + 1} – aantal panelen</span>
          <input aria-label=${`String ${index + 1} – aantal panelen`} type="number" min="1" step="1" required
            .value=${count} @input=${(event: Event) => {
              this.stringPanels = this.stringPanels.map((value, item) => item === index ? (event.target as HTMLInputElement).value : value)
              this.error = ''
            }} /></label>`)}</div>
      <small>Bij wijzigen van het totaal of het aantal strings wordt een nieuwe verdeling voorgesteld. Pas daarna elk stringaantal aan.</small>
      <p>Verdeeld: ${this.stringPanels.reduce((sum, count) => sum + Number(count), 0)} / ${this.values.panelCount || '0'} panelen.
        Totaal DC: ${Number.isFinite(watts) && watts > 0 ? `${Number((watts / 1000).toFixed(3))} kWp` : '—'}</p>
        ${this.values.kind === 'panels' ? html`<small>Panelen worden los geplaatst, niet op een AC-kamrail. Verbind de DC-aansluiting met de gewenste omvormer via Verbinding.</small>` : ''}
      </fieldset>` : ''}
      ${this.values.kind !== 'panels' ? html`<fieldset data-equipment="inverter" ?disabled=${this.busy}>
        <legend>Omvormer en aansluiting</legend>${this.#datasheet('inverter')}
        ${this.inverters.length > 1 ? html`<label><span>Omvormervariant</span>
          <select aria-label="Omvormervariant" required @change=${(event: Event) => {
            const index = (event.target as HTMLSelectElement).value
            this.values = { ...this.values, inverterVariant: index }
            if (index !== '') this.#chooseInverter(this.inverters[Number(index)])
          }}><option value="" .selected=${!this.values.inverterVariant}>Kies de juiste kolom</option>
            ${this.inverters.map((inverter, index) => html`<option value=${String(index)}
              .selected=${this.values.inverterVariant === String(index)}>${inverter.inverterModel || `Variant ${index + 1}`} · ${inverter.inverterPowerW ?? '?'} W AC</option>`)}
          </select></label>` : ''}
        <div class="fields">
        ${this.#field('inverterManufacturer', 'Merk omvormer')}
        ${this.#field('inverterModel', 'Omvormermodel', false, true)}
        ${this.#field('inverterPowerW', 'Nominaal AC-vermogen omvormer (W)', true, true)}
        ${this.#field('maxDcVoltageV', 'Maximale DC-spanning (V)', true)}
        ${this.#field('mpptCount', 'Aantal MPPT-trackers', true, false, true)}
        <label><span>Fasen omvormer</span><select aria-label="Fasen omvormer" .value=${this.values.phases}
          @change=${(event: Event) => { this.values = { ...this.values, phases: (event.target as HTMLSelectElement).value } }}>
          <option value="1" .selected=${this.values.phases === '1'}>1 fase (L+N)</option>
          <option value="3" .selected=${this.values.phases === '3'}>3 fasen (3L+N)</option></select></label>
        ${this.#field('breakerCurrentA', 'PV-automaat (A)', true, true)}
        <label><span>Aansluiten op</span><select aria-label="Aansluiten op" .value=${this.values.railId}
          @change=${(event: Event) => { this.values = { ...this.values, railId: (event.target as HTMLSelectElement).value } }}>
          ${this.#request.rails.length ? this.#request.rails.map((rail) => html`<option value=${rail.id} .selected=${this.values.railId === rail.id}>${rail.label}</option>`)
            : html`<option value="">Nieuwe kamrail</option>`}</select></label>
      </div><small>Controleer de beveiliging, kabels, DC-schakeling en omvormercompatibiliteit zelf; dit is geen dimensioneringscontrole.</small></fieldset>` : ''}
      ${this.status ? html`<p role="status">${this.status}</p>` : ''}
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <footer class="actions">
        ${this.#request.installation ? html`<button type="button" ?disabled=${this.busy} @click=${this.#startNew}>Nieuw onderdeel toevoegen</button>` : ''}
        <button type="button" @click=${() => this.#close()}>Annuleren</button>
        <button type="submit" class="primary" ?disabled=${this.busy}>${this.#request.installation ? 'Installatie bijwerken' : 'Plaats PV-installatie'}</button></footer>
    </form>`
  }
}
