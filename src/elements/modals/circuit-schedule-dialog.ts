import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import type { CircuitScheduleLayout, ElectricalBoard } from '../../types.js'
import { packCircuitCabinetRows, type CircuitScheduleEditorItem } from '../../editor/circuit-schedule-page.js'
import styles from './circuit-schedule-dialog.css' with { type: 'css' }

type EditableItem = CircuitScheduleEditorItem & { gapBefore: number }

@customElement('circuit-schedule-dialog')
export class CircuitScheduleDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ attribute: false }) accessor items: CircuitScheduleEditorItem[] = []
  @property({ attribute: false }) accessor layout: CircuitScheduleLayout = {}
  @property({ attribute: false }) accessor boards: ElectricalBoard[] = []
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
    let target = index + delta
    while (target >= 0 && target < this.rows.length && this.rows[target].boardId !== this.rows[index].boardId) target += delta
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
      <div class="panel" role="dialog" aria-modal="true" aria-label="Kastlayoutplanner">
        <header>
          <div><h3>Kastlayoutplanner</h3><p>Plan de modulevolgorde en vrije ruimte per kast. Dit verplaatst niets op het eendraads.</p></div>
          <button type="button" @click=${this.#close}>Sluiten</button>
        </header>
        <div class="settings">
          <label>
            <span>Kastbreedte</span>
            <select @change=${(event: Event) => (this.modulesPerRow = Number((event.target as HTMLSelectElement).value) === 18 ? 18 : 24)}>
              <option value="18" .selected=${this.modulesPerRow === 18}>18 modules</option>
              <option value="24" .selected=${this.modulesPerRow === 24}>24 modules</option>
            </select>
          </label>
          <p>Rij 1 staat onderaan; we tellen van onder naar boven. Indicatieve breedtes op basis van het pooltal. Controleer de echte productbreedtes. Fysieke rijen zijn geen nieuwe elektrische diff-koppelingen.</p>
        </div>
        <div class="list">
          <div class="cabinet-preview" aria-label="Module-indeling per kast">
            ${[...new Set(this.rows.map((row) => row.boardId))].map((boardId) => html`
              <section class="cabinet-board" data-board-id=${boardId}>
                <h4>${this.boards.find((board) => board.id === boardId)?.name ?? (boardId === 'unassigned' ? 'Niet gekoppeld aan een kast' : boardId)}</h4>
                ${packCircuitCabinetRows(this.rows.filter((row) => row.boardId === boardId), this.modulesPerRow).reverse().map((row, index, rows) => html`
                  <div class="cabinet-row-heading"><span>Rij ${rows.length - index}</span><span>${row.used}/${this.modulesPerRow} modules</span></div>
                  <div class="cabinet-row" style=${`--modules:${this.modulesPerRow}`}>
                    ${row.cells.map(({ item, start, span }) => html`
                      <div class="cabinet-device" data-kind=${item.kind} data-item-id=${item.id}
                        style=${`grid-column:${start} / span ${span}`}
                        title=${`${item.title} · ${item.subtitle}${item.railId ? ` · ${item.railId}` : ''}`}>
                        <strong>${item.kind === 'differential' ? 'DIFF' : item.id}</strong>
                        <small>${item.modules}M</small>
                      </div>`)}
                  </div>
                  ${row.used > this.modulesPerRow ? html`<p class="overflow-warning">Een toestel is breder dan de gekozen rij. Controleer de kastbreedte.</p>` : ''}
                `)}
              </section>`)}
          </div>
          ${this.rows.map((row, index) => html`
            <div class="item" data-kind=${row.kind}>
              <div class="order">
                <button type="button" title="Move up" ?disabled=${!this.rows.slice(0, index).some((item) => item.boardId === row.boardId)} @click=${() => this.#move(index, -1)}>↑</button>
                <button type="button" title="Move down" ?disabled=${!this.rows.slice(index + 1).some((item) => item.boardId === row.boardId)} @click=${() => this.#move(index, 1)}>↓</button>
              </div>
              <div class="copy"><strong>${row.kind === 'circuit' ? `${row.id} · ` : ''}${row.title}</strong><span>${this.boards.find((board) => board.id === row.boardId)?.name ?? row.boardId} · ${row.subtitle}</span></div>
              <label class="gap"><span>Vrije modules ervoor</span>
                <input type="number" min="0" .max=${String(this.modulesPerRow)} .value=${String(row.gapBefore)}
                  @change=${(event: Event) => this.#setGap(index, (event.target as HTMLInputElement).value)}>
              </label>
            </div>
          `)}
        </div>
        <footer><button type="button" @click=${this.#close}>Annuleren</button><button class="primary" type="button" @click=${this.#save}>Indeling opslaan</button></footer>
      </div>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'circuit-schedule-dialog': CircuitScheduleDialog
  }
}
