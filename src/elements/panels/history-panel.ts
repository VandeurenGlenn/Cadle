import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './history-panel.css' with { type: 'css' }
@customElement('history-panel')
export class HistoryPanel extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ type: Array }) accessor entries: Array<{ id: string; label: string; timestamp: number }> = []
  static styles = [styles]

  onChange(property: string) {
    if (property !== 'open') return

    this.toggleAttribute('data-open', this.open)
    this.setAttribute('aria-hidden', String(!this.open))
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #restore(id: string) {
    this.dispatchEvent(new CustomEvent('restore-history', { bubbles: true, composed: true, detail: { id } }))
  }

  render() {
    if (!this.open) return html``

    return html`
      <div class="panel">
        <div class="header">
          <div>
            <h3>Project herstellen</h3>
            <p>${this.entries.length} herstelpunten · laatste 10 · alle pagina’s en kringgegevens</p>
          </div>
          <button @click=${this.#close}>Sluiten</button>
        </div>
        <div class="content">
          <button @click=${() => this.dispatchEvent(new CustomEvent('create-history', { bubbles: true, composed: true }))}>
            Herstelpunt maken
          </button>
          ${this.entries.length === 0
            ? html`<div class="empty">Nog geen herstelpunten. Maak er zelf een, of werk het eendraads bij. Herstelpunten blijven na heropenen beschikbaar.</div>`
            : this.entries.map(
                (entry) => html`
                  <div class="entry">
                    <div class="entry-title">
                      <strong>${entry.label}</strong>
                      <span class="timestamp">${new Date(entry.timestamp).toLocaleString('nl-BE')}</span>
                    </div>
                    <button @click=${() => this.#restore(entry.id)}>Dit project herstellen</button>
                  </div>
                `
              )}
        </div>
      </div>
    `
  }
}
