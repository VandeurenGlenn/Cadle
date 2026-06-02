import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './history-panel.css' with { type: 'css' }
@customElement('history-panel')
export class HistoryPanel extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ type: Array }) accessor entries: Array<{ id: string; label: string; timestamp: number }> = []
  static styles = [styles]

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #restore(id: string) {
    this.dispatchEvent(new CustomEvent('restore-history', { bubbles: true, composed: true, detail: { id } }))
  }

  render() {
    return html`
      <div class="panel">
        <div class="header">
          <div>
            <h3>History</h3>
            <p>${this.entries.length} saved canvas state${this.entries.length === 1 ? '' : 's'} ready to restore</p>
          </div>
          <button @click=${this.#close}>Close</button>
        </div>
        <div class="content">
          ${this.entries.length === 0
            ? html`<div class="empty">No history snapshots yet. Start drawing or editing to capture states.</div>`
            : this.entries.map(
                (entry) => html`
                  <div class="entry">
                    <div class="entry-title">
                      <strong>${entry.label}</strong>
                      <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <button @click=${() => this.#restore(entry.id)}>Restore this state</button>
                  </div>
                `
              )}
        </div>
      </div>
    `
  }
}
