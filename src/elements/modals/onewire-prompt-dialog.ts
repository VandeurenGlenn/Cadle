import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './onewire-prompt-dialog.css' with { type: 'css' }
import { interpretOneWirePrompt, oneWirePromptTree, parseOneWirePrompt } from '../../editor/onewire-prompt.js'
import { validateOneWireTopology } from '../../editor/onewire-topology-schema.js'

const EXAMPLE =
  'Inkomende kabel is 4x10 mm² EXVB. Hoofddifferentieel 40 A 300 mA. Daarna een remautomaat naar de verbruikers. Er zijn zonnepanelen; plaats deze parallel aan de kant van de hoofddifferentieel.'

@customElement('onewire-prompt-dialog')
export class OneWirePromptDialog extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ type: String }) accessor prompt = ''
  @property({ type: String }) accessor topologyJson = ''
  @property({ type: String }) accessor topologyJsonError = ''
  @property({ type: String }) accessor modelStatus = 'Regelparser'

  static styles = [styles]
  #interpretationSequence = 0
  #jsonManuallyEdited = false

  onChange(property: string) {
    if ((property === 'open' || property === 'prompt') && this.open) {
      this.#syncJsonFromPrompt()
    }
  }

  #syncJsonFromPrompt() {
    const prompt = this.prompt.trim() || EXAMPLE
    this.topologyJson = JSON.stringify(parseOneWirePrompt(prompt).plan, null, 2)
    this.topologyJsonError = ''
    this.#jsonManuallyEdited = false
    const sequence = ++this.#interpretationSequence
    this.modelStatus = 'Lokaal model laden…'
    void import('../../editor/onewire-local-model.js')
      .then(({ loadOneWireLocalModel }) => loadOneWireLocalModel())
      .then(async (model) => {
        const interpreted = await interpretOneWirePrompt(prompt, model)
        if (sequence !== this.#interpretationSequence || this.#jsonManuallyEdited) return
        this.topologyJson = JSON.stringify(interpreted.plan, null, 2)
        this.modelStatus = 'Lokaal model actief'
      })
      .catch(() => {
        if (sequence === this.#interpretationSequence) this.modelStatus = 'Regelparser (model niet beschikbaar)'
      })
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))

  #onInput = (event: Event) => {
    this.prompt = (event.target as HTMLTextAreaElement).value
  }

  #onTopologyJsonInput = (event: Event) => {
    this.#jsonManuallyEdited = true
    this.topologyJson = (event.target as HTMLTextAreaElement).value
    try {
      const validation = validateOneWireTopology(JSON.parse(this.topologyJson))
      this.topologyJsonError = validation.valid ? '' : validation.errors.join(' ')
    } catch {
      this.topologyJsonError = 'JSON is niet geldig.'
    }
  }

  #apply = () => {
    const prompt = this.prompt.trim() || EXAMPLE
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
    this.dispatchEvent(new CustomEvent('apply-topology', {
      detail: { prompt, topology: validation.value, parserTopology: parsed.plan },
      bubbles: true,
      composed: true
    }))
  }

  render() {
    const value = this.prompt.trim() ? this.prompt : EXAMPLE
    const parsed = parseOneWirePrompt(value)
    return html`
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="onewire-prompt-title">
        <header>
          <div>
            <h3 id="onewire-prompt-title">Beschrijf de schema-opbouw</h3>
            <p>Schrijf in gewone taal hoe voeding, beveiligingen en aftakkingen verbonden zijn.</p>
          </div>
          <custom-button type="text" label="Sluiten" @click=${this.#close}></custom-button>
        </header>
        <main>
          <label>
            <span>Beschrijving</span>
            <textarea
              rows="7"
              .value=${value}
              @input=${this.#onInput}
              placeholder=${EXAMPLE}></textarea>
          </label>
          <section class="preview">
            <span class="eyebrow">Cadle begrijpt dit als · ${this.modelStatus}</span>
            <pre>${oneWirePromptTree(parsed.plan).join('\n')}</pre>
          </section>
          <details class="json-review">
            <summary>Gestructureerde JSON controleren of corrigeren</summary>
            <p>Correcties blijven lokaal en kunnen later als trainingsdata gebruikt worden.</p>
            <textarea
              class="json-editor"
              rows="14"
              spellcheck="false"
              .value=${this.topologyJson || JSON.stringify(parsed.plan, null, 2)}
              @input=${this.#onTopologyJsonInput}></textarea>
            ${this.topologyJsonError ? html`<p class="json-error">${this.topologyJsonError}</p>` : ''}
          </details>
          ${parsed.warnings.length
            ? html`<ul class="warnings">${parsed.warnings.map((warning) => html`<li>${warning}</li>`)}</ul>`
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
