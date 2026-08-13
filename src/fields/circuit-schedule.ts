import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import type { CircuitScheduleLayout } from '../types.js'
import type { CircuitScheduleEditorItem } from '../editor/circuit-schedule-page.js'
import styles from './circuit-schedule.css' with { type: 'css' }

type EditableItem = CircuitScheduleEditorItem & { gapBefore: number }
type Placement = EditableItem & { row: number; module: number }

const place = (items: EditableItem[], modulesPerRow: number): Placement[] => {
  let row = 0
  let cursor = 0
  return items.map((item) => {
    const modules = Math.max(1, Math.min(modulesPerRow, item.modules))
    let module = cursor + item.gapBefore
    if (module + modules > modulesPerRow) {
      row += 1
      module = Math.min(item.gapBefore, modulesPerRow - modules)
    }
    cursor = module + modules
    const placement = { ...item, modules, row, module }
    if (cursor >= modulesPerRow) {
      row += 1
      cursor = 0
    }
    return placement
  })
}

@customElement('circuit-schedule-field')
export class CircuitScheduleField extends LiteElement {
  @property({ attribute: false }) accessor items: CircuitScheduleEditorItem[] = []
  @property({ attribute: false }) accessor layout: CircuitScheduleLayout = {}
  @property({ attribute: false }) private accessor rows: EditableItem[] = []
  @property({ type: Number }) private accessor modulesPerRow: 18 | 24 = 24
  private draggedId = ''

  static styles = [styles]

  onChange(property: string) {
    if (property === 'items' || property === 'layout') this.#sync()
  }

  #sync() {
    this.modulesPerRow = this.layout?.modulesPerRow === 18 ? 18 : 24
    const configured = new Map((this.layout?.items ?? []).map((item, index) => [item.id, { ...item, index }]))
    this.rows = this.items
      .map((item, index) => ({
        ...item,
        gapBefore: configured.get(item.id)?.gapBefore ?? 0,
        order: configured.get(item.id)?.index ?? 10_000 + index
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...item }) => item)
  }

  #save() {
    const layout: CircuitScheduleLayout = {
      modulesPerRow: this.modulesPerRow,
      items: this.rows.map(({ id, gapBefore }) => ({ id, ...(gapBefore ? { gapBefore } : {}) }))
    }
    this.dispatchEvent(new CustomEvent('schedule-layout-changed', {
      bubbles: true,
      composed: true,
      detail: { layout }
    }))
  }

  #setModules(value: string) {
    this.modulesPerRow = value === '18' ? 18 : 24
    this.rows = this.rows.map((row) => ({ ...row, gapBefore: Math.min(row.gapBefore, this.modulesPerRow) }))
    this.#save()
  }

  #setGap(id: string, value: string) {
    this.rows = this.rows.map((row) =>
      row.id === id ? { ...row, gapBefore: Math.max(0, Math.min(this.modulesPerRow, Number(value) || 0)) } : row
    )
    this.#save()
  }

  #drop(targetId: string) {
    if (!this.draggedId || this.draggedId === targetId) return
    const sourceIndex = this.rows.findIndex((row) => row.id === this.draggedId)
    const targetIndex = this.rows.findIndex((row) => row.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...this.rows]
    const [source] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, source)
    this.rows = next
    this.draggedId = ''
    this.#save()
  }

  render() {
    const placements = place(this.rows, this.modulesPerRow)
    const pageCount = Math.max(1, Math.ceil(((placements.at(-1)?.row ?? 0) + 1) / 5))
    return html`
      <header class="toolbar">
        <div>
          <h2>Kringenoverzicht</h2>
          <p>Sleep automaten en differentiëlen naar hun plaats in het verdeelbord.</p>
        </div>
        <label><span>Verdeelbord</span>
          <select .value=${String(this.modulesPerRow)} @change=${(event: Event) => this.#setModules((event.target as HTMLSelectElement).value)}>
            <option value="18">18 modules</option>
            <option value="24">24 modules</option>
          </select>
        </label>
      </header>
      <main>
        ${Array.from({ length: pageCount }, (_, pageIndex) => html`
          <section class="sheet">
            <div class="sheet-title"><strong>VERDEELBORD · KRINGENOVERZICHT</strong><span>${pageIndex + 1}/${pageCount}</span></div>
            <div class="board" style=${`--modules:${this.modulesPerRow}`}>
              ${placements
                .filter((item) => Math.floor(item.row / 5) === pageIndex)
                .map((item) => html`
                  <article
                    class="device"
                    data-kind=${item.kind}
                    draggable="true"
                    style=${`grid-column:${item.module + 1} / span ${item.modules};grid-row:${item.row % 5 + 1}`}
                    @dragstart=${() => (this.draggedId = item.id)}
                    @dragover=${(event: DragEvent) => event.preventDefault()}
                    @drop=${(event: DragEvent) => { event.preventDefault(); this.#drop(item.id) }}>
                    <div class="device-head"><strong>${item.title}</strong><span>${item.modules} mod</span></div>
                    <p>${item.subtitle}</p>
                    <label><span>Vrije modules ervoor</span>
                      <input type="number" min="0" .max=${String(this.modulesPerRow)} .value=${String(item.gapBefore)}
                        @change=${(event: Event) => this.#setGap(item.id, (event.target as HTMLInputElement).value)}>
                    </label>
                  </article>
                `)}
            </div>
          </section>
        `)}
      </main>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'circuit-schedule-field': CircuitScheduleField
  }
}
