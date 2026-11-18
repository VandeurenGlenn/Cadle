import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import type { CircuitScheduleLayout, ElectricalBoard, Project } from '../types.js'
import type { CircuitScheduleEditorItem } from '../editor/circuit-schedule-page.js'
import { cableEstimateBoardLocation, estimateCircuitCables, floorPlanBoardLocations, formatCableMetres } from '../editor/cable-estimate.js'
import styles from './circuit-schedule.css' with { type: 'css' }

type EditableItem = CircuitScheduleEditorItem & { gapBefore: number }

@customElement('circuit-schedule-field')
export class CircuitScheduleField extends LiteElement {
  @property({ attribute: false }) accessor items: CircuitScheduleEditorItem[] = []
  @property({ attribute: false }) accessor boards: ElectricalBoard[] = []
  @property({ attribute: false }) accessor layout: CircuitScheduleLayout = {}
  @property({ attribute: false }) accessor project: Project | null = null
  @property({ attribute: false }) private accessor rows: EditableItem[] = []
  @property({ type: Number }) private accessor modulesPerRow: 18 | 24 = 24
  @property() private accessor newBoardName = ''
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
    this.dispatchEvent(
      new CustomEvent('schedule-layout-changed', {
        bubbles: true,
        composed: true,
        detail: { layout }
      })
    )
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

  #setBoard(id: string, boardId: string) {
    this.rows = this.rows.map((row) => (row.id === id ? { ...row, boardId } : row))
    this.#save()
    this.dispatchEvent(
      new CustomEvent('circuit-board-changed', {
        bubbles: true,
        composed: true,
        detail: { circuitId: id, boardId }
      })
    )
  }

  #addBoard() {
    const name = this.newBoardName.trim()
    if (!name) return
    this.dispatchEvent(
      new CustomEvent('schedule-board-added', {
        bubbles: true,
        composed: true,
        detail: { name }
      })
    )
    this.newBoardName = ''
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
    const boards = this.boards.length
      ? this.boards
      : [{ id: 'main', name: 'Hoofdverdeelbord', rails: [{ id: 'rail-1', name: 'Rail 1' }] }]
    const estimates = this.project ? estimateCircuitCables(this.project, this.rows) : []
    const locations = this.project ? floorPlanBoardLocations(this.project) : []
    return html`
      <header class="toolbar">
        <div>
          <h2>Kringenoverzicht</h2>
          <p>Beheer de kringen per verdeelbord en bepaal hun volgorde.</p>
        </div>
        <div class="toolbar-actions">
          <label
            ><span>Breedte</span>
            <select
              .value=${String(this.modulesPerRow)}
              @change=${(event: Event) => this.#setModules((event.target as HTMLSelectElement).value)}>
              <option value="18">18 modules</option>
              <option value="24">24 modules</option>
            </select>
          </label>
          <label class="new-board"
            ><span>Nieuwe kast</span>
            <div>
              <input
                placeholder="Naam verdeelbord"
                .value=${this.newBoardName}
                @input=${(event: Event) => (this.newBoardName = (event.target as HTMLInputElement).value)}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === 'Enter') this.#addBoard()
                }} />
              <button
                type="button"
                ?disabled=${!this.newBoardName.trim()}
                @click=${this.#addBoard}>
                Toevoegen
              </button>
            </div>
          </label>
        </div>
      </header>
      <main>
        <p class="estimate-help">Kabelraming op basis van de tekenschaal en een kort haaks netwerk vanaf de kast
          langs de gelabelde punten. Geen wandroute, stijg- en daallengtes, reserve of voedingskabels tussen kasten.
          VOB toont trajectmeters, niet de som van de afzonderlijke aders. Controleer de schaal en route voor bestelling.</p>
        ${boards.map((board) => {
          const boardRows = this.rows.filter((row) => row.boardId === board.id)
          const boardEstimates = estimates.filter((estimate) => estimate.boardId === board.id)
          const measured = boardEstimates.filter((estimate) => estimate.metres !== null)
          const partial = boardEstimates.some((estimate) => !estimate.complete)
          const total = measured.reduce((sum, estimate) => sum + estimate.metres!, 0)
          const byCable = new Map<string, number>()
          for (const estimate of measured) byCable.set(estimate.cable, (byCable.get(estimate.cable) ?? 0) + estimate.metres!)
          const location = this.project ? cableEstimateBoardLocation(this.project, board.id, locations) : undefined
          return html`
            <section class="board-section">
              <div class="board-heading">
                <div>
                  <span>Verdeelbord</span>
                  <h3>${board.name}</h3>
                </div>
                <strong>${boardRows.filter((row) => row.kind === 'circuit').length} kringen</strong>
              </div>
              <div class="cable-summary">
                <label><span>Kastpositie op situatieplan</span>
                  <select
                    aria-label=${`Kastpositie voor ${board.name}`}
                    @change=${(event: Event) => {
                      const location = locations.find((item) => item.key === (event.target as HTMLSelectElement).value)
                      this.dispatchEvent(new CustomEvent('schedule-board-location-changed', {
                        bubbles: true, composed: true,
                        detail: { boardId: board.id, location: location
                          ? { pageKey: location.pageKey, shapeId: location.shapeId } : undefined }
                      }))
                    }}>
                    <option value="" .selected=${!location}>Kies een verdeelbord op het situatieplan</option>
                    ${locations.map((item) => html`<option value=${item.key} .selected=${item.key === location?.key}>${item.label}</option>`)}
                  </select>
                </label>
                <div class="cable-total" role="status">
                  <strong>${measured.length ? `Geschat totaal: ${formatCableMetres(total)}${partial ? ' (gedeeltelijk)' : ''}` : 'Nog geen kabelraming'}</strong>
                  <span>${measured.length} van ${boardEstimates.length} kringen ${partial ? '(deels) ' : ''}geraamd</span>
                  ${[...byCable].map(([cable, metres]) => html`<span>${cable}: ${formatCableMetres(metres)}</span>`)}
                </div>
                ${!locations.length ? html`<p>Plaats een verdeelbordsymbool op het situatieplan om vanaf de kast te ramen.</p>` : ''}
              </div>
              <div class="circuit-table">
                <div class="table-head">
                  <span>Kring</span><span>Omschrijving</span><span>Beveiliging</span><span>Kabelraming</span><span>Kast</span><span>Vrij</span>
                </div>
                ${boardRows.length
                  ? boardRows.map(
                      (item) => html`
                        <article
                          class="device"
                          data-kind=${item.kind}
                          draggable="true"
                          @dragstart=${() => (this.draggedId = item.id)}
                          @dragover=${(event: DragEvent) => event.preventDefault()}
                          @drop=${(event: DragEvent) => {
                            event.preventDefault()
                            this.#drop(item.id)
                          }}>
                          <strong class="circuit-id">${item.id.startsWith('DIFF:') ? 'DIFF' : item.id}</strong>
                          <span class="description">${item.title}</span>
                          <span class="protection">${item.subtitle.replace(`${item.id} · `, '')}</span>
                          <span class="cable-estimate">${item.kind === 'circuit' ? (() => {
                            const estimate = estimates.find((estimate) => estimate.id === item.id)
                            return html`<strong>${estimate?.metres != null ? `ca. ${formatCableMetres(estimate.metres)}${estimate.complete ? '' : ' (deel)'}` : 'Niet geraamd'}</strong>
                              <small>${item.cable ?? ''}</small>
                              ${estimate?.notes.map((note) => html`<small>${note}</small>`)}`
                          })() : '-'}</span>
                          ${item.kind === 'circuit'
                            ? html`<select
                                aria-label=${`Verdeelbord voor kring ${item.id}`}
                                @change=${(event: Event) =>
                                  this.#setBoard(item.id, (event.target as HTMLSelectElement).value)}>
                                ${boards.map((option) => html`<option value=${option.id} .selected=${option.id === item.boardId}>${option.name}</option>`)}
                              </select>`
                            : html`<span class="fixed-board">${board.name}</span>`}
                          <input
                            class="gap"
                            aria-label=${`Vrije modules voor ${item.id}`}
                            type="number"
                            min="0"
                            .max=${String(this.modulesPerRow)}
                            .value=${String(item.gapBefore)}
                            @change=${(event: Event) =>
                              this.#setGap(item.id, (event.target as HTMLInputElement).value)} />
                        </article>
                      `
                    )
                  : html`<p class="empty">Nog geen kringen aan deze kast toegewezen.</p>`}
              </div>
            </section>
          `
        })}
      </main>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'circuit-schedule-field': CircuitScheduleField
  }
}
