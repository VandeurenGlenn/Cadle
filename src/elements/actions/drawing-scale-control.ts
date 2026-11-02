import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import pubsub from '../../pubsub.js'
import { DRAWING_SCALES, isDrawingScale } from '../../editor/layout/drawing-scale.js'
import styles from './drawing-scale-control.css' with { type: 'css' }

@customElement('drawing-scale-control')
export class DrawingScaleControl extends LiteElement {
  static styles = [styles]
  @property({ attribute: false }) accessor available = false
  @property({ attribute: false }) accessor scale: number | null = null
  @property({ attribute: false }) accessor exceedsPage = false
  @property({ attribute: false }) accessor canCalibrate = false

  connectedCallback() {
    super.connectedCallback()
    pubsub.subscribe('editor.controls.state', this.#onState)
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    pubsub.unsubscribe('editor.controls.state', this.#onState)
  }
  #onState = (state: { pageType?: string; drawingScale?: number | null; planExceedsPage?: boolean; canCalibratePlan?: boolean }) => {
    this.available = state.pageType === 'groundplan'
    this.scale = state.drawingScale ?? null
    this.canCalibrate = Boolean(state.canCalibratePlan)
    this.exceedsPage = Boolean(state.planExceedsPage)
  }
  render() {
    if (!this.available) return html``
    const hint = this.scale ? 'Planschaal. Raster: 10 cm. Bij wijzigen blijven de werkelijke afmetingen behouden.'
      : 'Bestaand plan: kies de oorspronkelijke schaal. De eerste instelling verplaatst of vergroot niets.'
    return html`<div class="scale-control">
      <label title=${hint}><span>Schaal</span><select aria-label="Planschaal" .value=${String(this.scale ?? '')}
        @change=${(event: Event) => {
          const drawingScale = Number((event.target as HTMLSelectElement).value)
          if (isDrawingScale(drawingScale)) pubsub.publish('editor.controls.command', { drawingScale })
        }}>
        ${this.scale === null ? html`<option value="">Instellen…</option>` : ''}
        ${DRAWING_SCALES.map((scale) => html`<option value=${String(scale)}>1:${scale}</option>`)}
      </select></label>
      <button type="button" aria-label="Planschaal kalibreren"
        title=${this.canCalibrate ? 'Kalibreer het plan met de echte lengte van de geselecteerde muur of lijn' : 'Selecteer een muur of lijn om het plan te kalibreren'}
        ?disabled=${!this.canCalibrate} @click=${() => pubsub.publish('editor.controls.command', { action: 'calibrate-drawing-scale' })}>
        <custom-icon icon="measuring_tape"></custom-icon>
      </button>
      ${this.exceedsPage ? html`<span class="scale-warning" role="status" title="Het plan valt buiten het tekenvlak. Kies 1:100 of een groter bladformaat.">Buiten blad</span>` : ''}
    </div>`
  }
}
