import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './onewire-prompt-dialog.css' with { type: 'css' }
import { interpretOneWirePrompt, oneWireTopologyPrompt, parseOneWirePrompt } from '../../editor/onewire-prompt.js'
import { cableLabelText } from '../../editor/model/cable-designation.js'
import { validateOneWireTopology } from '../../editor/onewire-topology-schema.js'
import type { OneWireTopologyPlan } from '../../types.js'

const EXAMPLE =
  'Inkomende kabel is 4x10 mm² EXVB. Hoofdschakelaar 40 A. Hoofddifferentieel 40 A 300 mA. Daarna een remautomaat naar de verbruikers. Er zijn zonnepanelen; plaats deze parallel aan de kant van de hoofddifferentieel.'

@customElement('onewire-prompt-dialog')
export class OneWirePromptDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ type: String }) accessor prompt = ''
  @property({ type: String }) accessor draft = ''
  @property({ attribute: false }) accessor topology: OneWireTopologyPlan | undefined = undefined
  @property({ type: String }) accessor topologyJson = ''
  @property({ type: String }) accessor topologyJsonError = ''
  @property({ type: String }) accessor modelStatus = 'Regelparser'
  @property({ attribute: false }) accessor interpretedPlan: OneWireTopologyPlan | null = null
  @property({ type: Array }) accessor interpretationWarnings: string[] = []

  static styles = [styles]
  #interpretationSequence = 0
  #jsonManuallyEdited = false

  onChange(property: string) {
    if (property === 'open') {
      this.toggleAttribute('data-open', this.open)
      this.setAttribute('aria-hidden', String(!this.open))
    }
    if (property === 'open' && this.open) {
      this.draft = this.prompt.trim() ? this.prompt : this.topology ? oneWireTopologyPrompt(this.topology) : EXAMPLE
      this.#syncJsonFromPrompt(this.topology)
    }
  }

  #syncJsonFromPrompt(savedPlan?: OneWireTopologyPlan) {
    const prompt = this.draft.trim()
    if (!prompt) {
      this.#interpretationSequence += 1
      this.interpretedPlan = null
      this.interpretationWarnings = []
      this.topologyJson = ''
      this.topologyJsonError = ''
      this.#jsonManuallyEdited = false
      this.modelStatus = 'Regelparser'
      return
    }
    const parsed = parseOneWirePrompt(prompt)
    const missingSavedDifferentials = Boolean(
      savedPlan && parsed.plan.additionalDifferentials?.length && !savedPlan.additionalDifferentials?.length
    )
    const plan = savedPlan
      ? missingSavedDifferentials
        ? { ...savedPlan, additionalDifferentials: parsed.plan.additionalDifferentials }
        : savedPlan
      : parsed.plan
    this.interpretedPlan = plan
    this.interpretationWarnings = parsed.warnings
    this.topologyJson = JSON.stringify(plan, null, 2)
    this.topologyJsonError = ''
    this.#jsonManuallyEdited = false
    const sequence = ++this.#interpretationSequence
    if (savedPlan) {
      this.modelStatus = missingSavedDifferentials ? 'Beschrijving bijgewerkt' : 'Opgeslagen structuur'
      return
    }
    this.modelStatus = 'Lokaal model laden…'
    void import('../../editor/onewire-local-model.js')
      .then(({ loadOneWireLocalModel }) => loadOneWireLocalModel())
      .then(async (model) => {
        const interpreted = await interpretOneWirePrompt(prompt, model)
        if (!this.open || sequence !== this.#interpretationSequence || this.#jsonManuallyEdited) return
        this.interpretedPlan = interpreted.plan
        this.interpretationWarnings = interpreted.warnings
        this.topologyJson = JSON.stringify(interpreted.plan, null, 2)
        this.modelStatus = 'Lokaal model actief'
      })
      .catch(() => {
        if (sequence === this.#interpretationSequence) this.modelStatus = 'Regelparser (model niet beschikbaar)'
      })
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))

  #onInput = (event: Event) => {
    this.draft = (event.target as HTMLTextAreaElement).value
    this.#syncJsonFromPrompt()
  }

  #onTopologyJsonInput = (event: Event) => {
    this.#jsonManuallyEdited = true
    this.topologyJson = (event.target as HTMLTextAreaElement).value
    try {
      const validation = validateOneWireTopology(JSON.parse(this.topologyJson))
      this.topologyJsonError = validation.valid ? '' : validation.errors.join(' ')
      if (validation.valid && validation.value) {
        this.interpretedPlan = validation.value
        this.modelStatus = 'Handmatig gecorrigeerd'
      }
    } catch {
      this.topologyJsonError = 'JSON is niet geldig.'
    }
  }

  #apply = () => {
    const prompt = this.draft.trim()
    if (!prompt) return
    const parsed = parseOneWirePrompt(prompt)
    let accepted: unknown
    try {
      accepted = JSON.parse(this.topologyJson || JSON.stringify(parsed.plan))
    } catch {
      this.topologyJsonError = 'JSON is niet geldig.'
      return
    }
    const validation = validateOneWireTopology(accepted)
    if (!validation.valid || !validation.value) {
      this.topologyJsonError = validation.errors.join(' ')
      return
    }
    if (!validation.value.mainDifferential) {
      this.topologyJsonError = 'Vul de hoofddifferentieel volledig in, met de nominale stroom in A en de gevoeligheid in mA.'
      return
    }
    this.dispatchEvent(
      new CustomEvent('apply-topology', {
        detail: { prompt, topology: validation.value, parserTopology: parsed.plan },
        bubbles: true,
        composed: true
      })
    )
  }

  #topologyPreview(plan: OneWireTopologyPlan) {
    const differentials = plan.additionalDifferentials ?? []
    const hasConsumerBranch = plan.residualBreaker || plan.consumers || differentials.length > 0
    const step = (label: string, detail = '') => html`
      <li class="flow-step"><strong>${label}</strong>${detail ? html`<span>${detail}</span>` : ''}</li>
    `
    return html`
      <ol class="supply-flow" aria-label="Voeding in aansluitvolgorde">
        ${step('Inkomende kabel', plan.incomingCable ? cableLabelText(plan.incomingCable, 'x') : 'Niet opgegeven')}
        ${step('Hoofdschakelaar', plan.mainSwitch ? `${plan.mainSwitch.ratedCurrentA} A` : 'Niet opgegeven')}
        ${step('kWh-meter')}
        ${step('Kabel meter → kast', plan.meterCable ? cableLabelText(plan.meterCable, 'x') : 'Nog op te geven')}
        ${step('Hoofddifferentieel', plan.mainDifferential
          ? `${plan.mainDifferential.ratedCurrentA} A / ${plan.mainDifferential.sensitivityMa} mA`
          : 'Nog niet volledig opgegeven')}
      </ol>
      ${plan.solar || hasConsumerBranch ? html`
        <div class="branch-caption">
          <strong>Aftakkingen na de hoofddifferentieel</strong>
          ${plan.solar && hasConsumerBranch ? html`<p>Deze twee takken zijn parallel aangesloten${plan.residualBreaker ? ': de zonnepanelen zitten vóór de remautomaat' : ''}.</p>` : ''}
        </div>
        <div class="topology-branches">
          ${plan.solar ? html`
            <section class="topology-branch solar-branch" aria-label="Aftakking zonnepanelen">
              <h4>Zonnepanelen</h4>
              <ol class="branch-flow" aria-label="Aansluiting zonnepanelen">
                ${step('PV-automaat', [
                  plan.solarBreakerPoles ? `${plan.solarBreakerPoles}P` : '',
                  plan.solarBreakerRatedCurrentA ? `${plan.solarBreakerRatedCurrentA} A` : ''
                ].filter(Boolean).join(' '))}
                ${step('Omvormer / zonnepanelen')}
              </ol>
            </section>
          ` : ''}
          ${hasConsumerBranch ? html`
            <section class="topology-branch consumer-branch" aria-label="Aftakking verbruikers">
              <h4>Verbruikers</h4>
              <ol class="branch-flow" aria-label="Voeding verbruikersrail">
                ${plan.residualBreaker ? step('Remautomaat', `${plan.residualBreakerRatedCurrentA ?? 40} A`) : ''}
                ${step('Verbruikersrail', plan.residualBreaker
                  ? `Begrensd op ${plan.residualBreakerRatedCurrentA ?? 40} A`
                  : 'Zonder remautomaat')}
              </ol>
              ${differentials.length ? html`
                <p class="rail-caption">Bijkomende differentiëlen vanaf deze rail:</p>
                <div class="differential-branches">
                  ${differentials.map((item) => {
                    const destination = [
                      item.boardId?.trim() ? `kast ${item.boardId.trim()}` : '',
                      item.railId?.trim() ? `rij ${item.railId.trim()}` : '',
                      item.purpose === 'ev' ? 'EV' : item.purpose === 'consumers' ? 'verbruikers' : 'overig'
                    ].filter(Boolean).join(' · ')
                    return html`
                      <section class="differential-group">
                        <strong>${item.count}× differentieel</strong>
                        <span>${item.ratedCurrentA ? `${item.ratedCurrentA} A / ` : ''}${item.sensitivityMa} mA${item.rcdType ? ` · type ${item.rcdType}` : ''}</span>
                        <p>Naar ${destination}</p>
                      </section>
                    `
                  })}
                </div>
              ` : plan.consumers ? html`<p class="rail-caption">Vanaf deze rail naar de verbruikers / kringen.</p>` : ''}
            </section>
          ` : ''}
        </div>
      ` : ''}
    `
  }

  render() {
    if (!this.open) return html``

    const value = this.draft
    const parsed = value.trim() ? parseOneWirePrompt(value) : null
    const interpreted = this.interpretedPlan ?? parsed?.plan ?? null
    const warnings = this.interpretedPlan ? this.interpretationWarnings : (parsed?.warnings ?? [])
    const missingSavedDifferentials = this.modelStatus === 'Opgeslagen structuur' &&
      Boolean(parsed?.plan.additionalDifferentials?.length) && !interpreted?.additionalDifferentials?.length
    return html`
      <section
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onewire-prompt-title"
        @keydown=${(event: KeyboardEvent) => {
          event.stopPropagation()
          if (event.key === 'Escape') { event.preventDefault(); this.#close() }
        }}
        @paste=${(event: ClipboardEvent) => event.stopPropagation()}>
        <header>
          <div>
            <h3 id="onewire-prompt-title">Beschrijf de schema-opbouw</h3>
            <p>Schrijf in gewone taal hoe voeding, beveiligingen en aftakkingen verbonden zijn.</p>
          </div>
          <custom-button
            type="text"
            label="Sluiten"
            @click=${this.#close}></custom-button>
        </header>
        <main>
          <label>
            <span>Beschrijving</span>
            <textarea
              aria-label="Beschrijving"
              rows="7"
              .value=${value}
              @input=${this.#onInput}
              placeholder="Beschrijf de voeding en beveiligingen van jouw installatie."></textarea>
            ${!this.prompt.trim() && !this.topology ? html`<small>Dit is een bewerkbaar voorbeeld, nog geen opgeslagen installatie. Pas alle waarden en onderdelen aan jouw installatie aan.</small>` : ''}
            <small
              >Vermeld de inkomende kabel, hoofdschakelaar (A), hoofddifferentieel (A en mA), remautomaat, verbruikers
              en eventuele PV. Voor extra differentiëlen: vermeld aantal, mA en bestemming, bijvoorbeeld “2 diffs 30 mA
              voor verbruikers en 1 voor EV”.</small
            >
            <small>Vermeld de meter-kastkabel apart, bijvoorbeeld “Kabel van kWh-meter naar kast: 4x10 mm² XVB”.</small>
          </label>
          <section class="preview">
            <div class="preview-header">
              <strong>Cadle begrijpt dit als</strong>
              <span class="model-status">${this.modelStatus}</span>
            </div>
            ${missingSavedDifferentials ? html`
              <p role="status">De opgeslagen structuur mist de bijkomende differentieel uit je beschrijving.
                Kies hieronder <strong>Beschrijving opnieuw analyseren</strong> om de structuur bij te werken.</p>
            ` : ''}
            ${interpreted ? this.#topologyPreview(interpreted) : html`<p>Beschrijf eerst de installatie.</p>`}
            ${this.#jsonManuallyEdited ? html`<div class="preview-actions">
              <custom-button
                type="text"
                label="Beschrijving opnieuw analyseren"
                title="Vervangt de lokale JSON-correcties door een nieuwe interpretatie van de beschrijving."
                ?disabled=${!value.trim()}
                @click=${() => this.#syncJsonFromPrompt()}></custom-button>
            </div>` : ''}
          </section>
          <details class="json-review">
            <summary>Gestructureerde JSON controleren of corrigeren</summary>
            <p>Correcties blijven lokaal en kunnen later als trainingsdata gebruikt worden.</p>
            <textarea
              aria-label="Gestructureerde schema-opbouw"
              class="json-editor"
              rows="14"
              spellcheck="false"
              .value=${this.topologyJson || (parsed ? JSON.stringify(parsed.plan, null, 2) : '')}
              @input=${this.#onTopologyJsonInput}></textarea>
          </details>
          ${this.topologyJsonError ? html`<p class="json-error" role="alert">${this.topologyJsonError}</p>` : ''}
          ${warnings.length
            ? html`<ul class="warnings">
                ${warnings.map((warning) => html`<li>${warning}</li>`)}
              </ul>`
            : ''}
        </main>
        <footer>
          <span>Controleer deze structuur vóór het genereren.</span>
          <custom-button
            type="filled"
            label="Structuur toepassen"
            ?disabled=${!value.trim() || Boolean(this.topologyJsonError)}
            @click=${this.#apply}></custom-button>
        </footer>
      </section>
    `
  }
}
