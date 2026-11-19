import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import baseStyles from './input-form-dialog.css' with { type: 'css' }
import styles from './solar-installation-dialog.css' with { type: 'css' }
import { parseSolarDatasheet, solarDatasheetRows, solarPanelFields, validateSolarInstallation,
  type SolarInstallation, type SolarPanel } from '../../editor/solar-installation.js'
import { createPdfScanOcrSession } from '../../editor/pdf-scan-ocr.js'

export type SolarInstallationRequest = {
  rails: { id: string; label: string }[]
  railId?: string
  installation?: SolarInstallation
}
export type SolarInstallationResult = { railId: string; installation: SolarInstallation }

@customElement('solar-installation-dialog')
export class SolarInstallationDialog extends LiteElement {
  static styles = [baseStyles, styles]
  @property({ attribute: false }) accessor values: Record<string, string> = {}
  @property({ attribute: false }) accessor panels: Partial<SolarPanel>[] = []
  @property({ attribute: false }) accessor warnings: string[] = []
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
      panelCount: '1', stringCount: '1', phases: '1',
      ...(previous ? Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'panel').map(([key, value]) => [key, String(value)])) : {}),
      ...(previous ? Object.fromEntries(Object.entries(previous.panel).map(([key, value]) => [key, String(value)])) : {}) }
    this.panels = []
    this.warnings = []
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

  #parse(text: string) {
    const parsed = parseSolarDatasheet(text)
    this.panels = parsed.panels
    this.warnings = parsed.warnings
    this.values = { ...this.values, variant: '' }
    this.error = ''
    if (parsed.panels.length === 1) this.#choosePanel(parsed.panels[0])
  }

  #choosePanel(panel: Partial<SolarPanel>) {
    this.values = { ...this.values, model: panel.model ?? '',
      ...Object.fromEntries(solarPanelFields.map(({ key }) => [key, panel[key] === undefined ? '' : String(panel[key])])) }
  }

  #readImage = (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void this.#recognizeImage(file)
  }

  async #recognizeImage(file: File) {
    if (this.busy) return
    const sequence = ++this.#sequence
    this.busy = true
    this.error = ''
    this.status = 'Afbeelding lokaal lezen…'
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const factor = Math.min(3, 2600 / bitmap.width, 3400 / bitmap.height)
      canvas.width = Math.round(bitmap.width * factor)
      canvas.height = Math.round(bitmap.height * factor)
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Afbeelding kan niet worden voorbereid.')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      } finally { bitmap.close() }
      const session = await createPdfScanOcrSession((_status, progress) => {
        if (sequence === this.#sequence) this.status = `Afbeelding lokaal lezen… ${Math.round(progress * 20) * 5}%`
      })
      try {
        const result = await session.recognize(canvas, canvas, 0)
        if (sequence !== this.#sequence) return
        this.#parse(solarDatasheetRows(result.texts))
        this.status = 'Herkenning klaar. Controleer de variant en alle waarden.'
      } finally { await session.terminate() }
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
    const installation: SolarInstallation = {
      panel: { manufacturer: values.manufacturer?.trim() ?? '', model: values.model?.trim() ?? '', powerWp: Number(values.powerWp),
        ...Object.fromEntries(solarPanelFields.slice(1).filter(({ key }) => values[key]?.trim())
          .map(({ key }) => [key, Number(values[key].replace(',', '.'))])) },
      panelCount: Number(values.panelCount), stringCount: Number(values.stringCount),
      inverterManufacturer: values.inverterManufacturer?.trim() ?? '', inverterModel: values.inverterModel?.trim() ?? '',
      inverterPowerW: Number(values.inverterPowerW), phases: values.phases === '3' ? 3 : 1,
      breakerCurrentA: Number(values.breakerCurrentA)
    }
    this.error = validateSolarInstallation(installation) ?? ''
    if (!this.error) this.#close({ railId: values.railId, installation })
  }

  #field(key: string, label: string, numeric = false, required = false, integer = false) {
    return html`<label><span>${label}</span><input name=${key} aria-label=${label}
      type=${numeric ? 'number' : 'text'} step=${integer ? '1' : 'any'} min=${numeric ? integer ? '1' : '0.001' : ''}
      ?required=${required} .value=${this.values[key] ?? ''}
      @input=${(event: Event) => { this.values = { ...this.values, [key]: (event.target as HTMLInputElement).value } }} /></label>`
  }

  render() {
    if (!this.open) return html``
    const watts = Number(this.values.powerWp) * Number(this.values.panelCount)
    return html`<form role="dialog" aria-modal="true" aria-labelledby="pv-title" @submit=${this.#submit}
      @paste=${(event: ClipboardEvent) => {
        event.stopPropagation()
        const file = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'))
        if (file) { event.preventDefault(); void this.#recognizeImage(file) }
      }}
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); this.#close() }
      }}>
      <header><h2 id="pv-title">Omvormer en zonnepanelen</h2><p>Open of plak een afbeelding van de paneelfiche, of vul de gegevens zelf in.</p></header>
      <fieldset ?disabled=${this.busy}>
        <legend>Paneelfiche</legend>
        <label><span>Afbeelding van paneelfiche</span><input type="file" accept="image/*" @change=${this.#readImage} /></label>
        <small>Herkenning gebeurt lokaal, zonder upload. Kies bij meerdere kolommen altijd je eigen paneelvariant. Alleen STC-waarden worden overgenomen.</small>
        <details><summary>Gegevens als tekst plakken</summary><textarea aria-label="Tekst van paneelfiche" rows="5"></textarea>
          <button type="button" @click=${() => this.#parse(this.shadowRoot!.querySelector('textarea')!.value)}>Tekst verwerken</button></details>
        ${this.panels.length > 1 ? html`<label><span>Paneelvariant</span>
          <select aria-label="Paneelvariant" required .value=${this.values.variant ?? ''} @change=${(event: Event) => {
            const index = (event.target as HTMLSelectElement).value
            this.values = { ...this.values, variant: index }
            if (index !== '') this.#choosePanel(this.panels[Number(index)])
          }}><option value="">Kies de juiste kolom</option>${this.panels.map((panel, index) =>
            html`<option value=${String(index)}>${panel.model || `Variant ${index + 1}`} · ${panel.powerWp ?? '?'} Wp</option>`)}</select></label>` : ''}
      </fieldset>
      ${this.status ? html`<p role="status">${this.status}</p>` : ''}
      ${this.warnings.length ? html`<ul class="warnings">${this.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>` : ''}
      <fieldset ?disabled=${this.busy}><legend>Zonnepanelen</legend><div class="fields">
        ${this.#field('manufacturer', 'Merk panelen')}
        ${this.#field('model', 'Paneelmodel', false, true)}
        ${solarPanelFields.map(({ key, label }) => this.#field(key, label, true, key === 'powerWp'))}
        ${this.#field('panelCount', 'Aantal panelen', true, true, true)}
        ${this.#field('stringCount', 'Aantal gelijke strings', true, true, true)}
      </div><p>Totaal DC: ${Number.isFinite(watts) && watts > 0 ? `${Number((watts / 1000).toFixed(3))} kWp` : '—'}</p></fieldset>
      <fieldset ?disabled=${this.busy}><legend>Omvormer en aansluiting</legend><div class="fields">
        ${this.#field('inverterManufacturer', 'Merk omvormer')}
        ${this.#field('inverterModel', 'Omvormermodel', false, true)}
        ${this.#field('inverterPowerW', 'Nominaal AC-vermogen omvormer (W)', true, true)}
        <label><span>Fasen omvormer</span><select aria-label="Fasen omvormer" .value=${this.values.phases}
          @change=${(event: Event) => { this.values = { ...this.values, phases: (event.target as HTMLSelectElement).value } }}>
          <option value="1">1 fase (L+N)</option><option value="3">3 fasen (3L+N)</option></select></label>
        ${this.#field('breakerCurrentA', 'PV-automaat (A)', true, true)}
        <label><span>Aansluiten op</span><select aria-label="Aansluiten op" .value=${this.values.railId}
          @change=${(event: Event) => { this.values = { ...this.values, railId: (event.target as HTMLSelectElement).value } }}>
          ${this.#request.rails.length ? this.#request.rails.map((rail) => html`<option value=${rail.id}>${rail.label}</option>`)
            : html`<option value="">Nieuwe kamrail</option>`}</select></label>
      </div><small>Aantallen en omvormergegevens staan niet in een paneelfiche. Controleer de beveiliging, kabels, DC-schakeling en omvormercompatibiliteit zelf; dit is geen dimensioneringscontrole.</small></fieldset>
      ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
      <footer class="actions"><button type="button" @click=${() => this.#close()}>Annuleren</button>
        <button type="submit" class="primary" ?disabled=${this.busy}>${this.#request.installation ? 'Installatie bijwerken' : 'Toevoegen aan schema'}</button></footer>
    </form>`
  }
}
