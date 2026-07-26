import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './onewire-training-panel.css' with { type: 'css' }
import {
  deleteOneWireTrainingExample,
  getOneWireTrainingExamples,
  oneWireTrainingExamplesToJsonl,
  type OneWireTrainingExample
} from '../../editor/onewire-training-data.js'
import { downloadTextFile } from '../../editor/export/downloads.js'

@customElement('onewire-training-panel')
export class OneWireTrainingPanel extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ type: Array }) accessor examples: OneWireTrainingExample[] = []
  @property({ type: Boolean }) accessor loading = false

  static styles = [styles]

  onChange(property: string) {
    if (property === 'open' && this.open) void this.#load()
  }

  #load = async () => {
    this.loading = true
    this.examples = await getOneWireTrainingExamples()
    this.loading = false
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))

  #export = () => {
    downloadTextFile(
      'cadle-onewire-training-data.jsonl',
      oneWireTrainingExamplesToJsonl([...this.examples].reverse()),
      'application/x-ndjson;charset=utf-8'
    )
  }

  #delete = async (id: string) => {
    await deleteOneWireTrainingExample(id)
    this.examples = this.examples.filter((example) => example.id !== id)
  }

  render() {
    const corrected = this.examples.filter((example) => example.corrected).length
    return html`
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="training-title">
        <header>
          <div>
            <h3 id="training-title">One-wire trainingsdata</h3>
            <p>${this.examples.length} voorbeelden · ${corrected} gecorrigeerd</p>
          </div>
          <custom-button type="text" label="Sluiten" @click=${this.#close}></custom-button>
        </header>
        <div class="toolbar">
          <span>Alles blijft lokaal tot je zelf exporteert.</span>
          <custom-button
            type="filled"
            label="Exporteer JSONL"
            ?disabled=${!this.examples.length}
            @click=${this.#export}></custom-button>
        </div>
        <main>
          ${this.loading
            ? html`<p>Voorbeelden laden…</p>`
            : this.examples.length
              ? this.examples.map((example) => html`
                  <article>
                    <div class="sample-heading">
                      <span class=${example.corrected ? 'corrected' : ''}>
                        ${example.corrected ? 'Gecorrigeerd' : 'Bevestigd'}
                      </span>
                      <time>${new Date(example.createdAt).toLocaleString('nl-BE')}</time>
                    </div>
                    <p>${example.prompt}</p>
                    <details>
                      <summary>Geaccepteerde JSON</summary>
                      <pre>${JSON.stringify(example.acceptedTopology, null, 2)}</pre>
                    </details>
                    <custom-button
                      type="text"
                      label="Verwijderen"
                      @click=${() => void this.#delete(example.id)}></custom-button>
                  </article>
                `)
              : html`<p>Nog geen trainingsvoorbeelden. Pas eerst enkele promptstructuren toe.</p>`}
        </main>
      </section>
    `
  }
}
