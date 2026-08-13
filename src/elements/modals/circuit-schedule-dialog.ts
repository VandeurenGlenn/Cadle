import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import type { CircuitScheduleLayout } from '../../types.js'
import type { CircuitScheduleEditorItem } from '../../editor/circuit-schedule-page.js'
import styles from './circuit-schedule-dialog.css' with { type: 'css' }

type EditableItem = CircuitScheduleEditorItem & { gapBefore: number }

@customElement('circuit-schedule-dialog')
export class CircuitScheduleDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ attribute: false }) accessor items: CircuitScheduleEditorItem[] = []
  @property({ attribute: false }) accessor layout: CircuitScheduleLayout = {}
  @property({ attribute: false }) private accessor rows: EditableItem[] = []
  @property({ type: Number }) private accessor modulesPerRow: 18 | 24 = 24

  static styles = [styles]

  onChange(property: string) {
    if (property === 'open') {
      this.toggleAttribute('data-open', this.open)
      this.setAttribute('aria-hidden', String(!this.open))
    }
    if ((property === 'open' || property === 'items' || property === 'layout') && this.open) this.#sync()
  }

  #sync() {
    this.modulesPerRow = this.layout?.modulesPerRow === 18 ? 18 : 24
    const config = new Map((this.layout?.items ?? []).map((item, index) => [item.id, { ...item, index }]))
    this.rows = this.items
      .map((item, index) => ({ ...item, gapBefore: config.get(item.id)?.gapBefore ?? 0, order: config.get(item.id)?.index ?? 10_000 + index }))
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...item }) => item)
  }

  #move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= this.rows.length) return
    const next = [...this.rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    this.rows = next
  }

  #setGap(index: number, value: string) {
    const next = [...this.rows]
    next[index] = { ...next[index], gapBefore: Math.max(0, Math.min(this.modulesPerRow, Number(value) || 0)) }
    this.rows = next
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))

  #save = () => {
    const layout: CircuitScheduleLayout = {
      modulesPerRow: this.modulesPerRow,
      items: this.rows.map((row) => ({ id: row.id, ...(row.gapBefore ? { gapBefore: row.gapBefore } : {}) }))
    }
    this.dispatchEvent(new CustomEvent('saved', { bubbles: true, composed: true, detail: { layout } }))
  }

  render() {
    if (!this.open) return html``

    return html`
      <div class="panel" role="dialog" aria-modal="true" aria-label="Edit circuit overview">
        <header>
          <div><h3>Edit circuit overview</h3><p>Arrange differentials and breakers exactly as they should appear in the dossier.</p></div>
          <button type="button" @click=${this.#close}>Close</button>
        </header>
        <div class="settings">
          <label>
            <span>Distribution-board width</span>
            <select .value=${String(this.modulesPerRow)} @change=${(event: Event) => (this.modulesPerRow = Number((event.target as HTMLSelectElement).value) === 18 ? 18 : 24)}>
              <option value="18">18 modules</option>
              <option value="24">24 modules</option>
            </select>
          </label>
          <p>Breaker width follows its pole count. Spacing is measured in free modules.</p>
        </div>
        <div class="list">
          ${this.rows.map((row, index) => html`
            <div class="item" data-kind=${row.kind}>
              <div class="order">
                <button type="button" title="Move up" ?disabled=${index === 0} @click=${() => this.#move(index, -1)}>↑</button>
                <button type="button" title="Move down" ?disabled=${index === this.rows.length - 1} @click=${() => this.#move(index, 1)}>↓</button>
              </div>
              <div class="copy"><strong>${row.title}</strong><span>${row.subtitle}</span></div>
              <label class="gap"><span>Free modules before</span>
                <input type="number" min="0" .max=${String(this.modulesPerRow)} .value=${String(row.gapBefore)}
                  @change=${(event: Event) => this.#setGap(index, (event.target as HTMLInputElement).value)}>
              </label>
            </div>
          `)}
        </div>
        <footer><button type="button" @click=${this.#close}>Cancel</button><button class="primary" type="button" @click=${this.#save}>Save layout</button></footer>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'circuit-schedule-dialog': CircuitScheduleDialog
  }
}
