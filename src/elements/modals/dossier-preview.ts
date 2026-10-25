import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import styles from './dossier-preview.css' with { type: 'css' }

export type DossierPreviewPage = {
  name: string
  type: string
}

export type DossierPreviewMaterial = {
  name: string
  quantity: number
}

@customElement('dossier-preview')
export class DossierPreview extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ type: String }) accessor projectName = ''
  @property({ attribute: false }) accessor pages: DossierPreviewPage[] = []
  @property({ attribute: false }) accessor warnings: string[] = []
  @property({ attribute: false }) accessor materials: DossierPreviewMaterial[] = []

  static styles = [styles]

  onChange(property: string) {
    if (property !== 'open') return
    this.toggleAttribute('data-open', this.open)
    this.setAttribute('aria-hidden', String(!this.open))
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  #export = () => this.dispatchEvent(new CustomEvent('export-pdf', { bubbles: true, composed: true }))

  render() {
    if (!this.open) return html``
    return html`
      <div
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dossier-preview-title">
        <header>
          <div>
            <h2 id="dossier-preview-title">Review dossier</h2>
            <p>${this.projectName || 'Current project'} · ${this.pages.length} document pages</p>
          </div>
        </header>
        <div class="content">
          <section>
            <h3>Pages</h3>
            <ol>
              ${this.pages.map(
                (page, index) => html`
                  <li>
                    <span class="page-number">${index + 1}</span>
                    <span class="page-name">${page.name}</span>
                    <span class="page-type">${page.type}</span>
                  </li>
                `
              )}
            </ol>
          </section>
          <section>
            <h3>Checks</h3>
            ${this.warnings.length
              ? html`<ul class="warnings">
                  ${this.warnings.map((warning) => html`<li>${warning}</li>`)}
                </ul>`
              : html`<div class="ready">No blocking circuit issues found.</div>`}
            <h3>Material list</h3>
            ${this.materials.length
              ? html`<ul>
                  ${this.materials.map(
                    (material) => html`
                      <li>
                        <span class="material-name">${material.name}</span>
                        <span class="quantity">${material.quantity}×</span>
                      </li>
                    `
                  )}
                </ul>`
              : html`<p class="muted">No circuit materials are available yet.</p>`}
          </section>
        </div>
        <footer>
          <span class="muted">The PDF is created only after this review.</span>
          <div class="actions">
            <button
              type="button"
              @click=${this.#close}>
              Cancel
            </button>
            <button
              class="primary"
              type="button"
              @click=${this.#export}>
              Export PDF
            </button>
          </div>
        </footer>
      </div>
    `
  }
}
