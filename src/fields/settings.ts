import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/toggle.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
import pubsub from '../pubsub.js'

@customElement('settings-field')
export class SettingsField extends LiteElement {
  #symbolStrokeWidth = 0.65

  connectedCallback(): void {
    super.connectedCallback()
    try {
      const stored = localStorage.getItem('cadle-symbol-stroke-width')
      if (stored) {
        const value = Number(stored)
        if (Number.isFinite(value) && value > 0) {
          this.#symbolStrokeWidth = value
        }
      }
    } catch {
      // localStorage not available
    }
  }

  #onStrokeWidthChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const value = Number(target.value)
    if (Number.isFinite(value)) {
      this.#symbolStrokeWidth = value
      pubsub.publish('native.symbol-stroke-width.update', value)
    }
  }

  render() {
    return html`
      <md-list-item>
        <custom-icon
          slot="icon"
          icon="save"></custom-icon>
        <flex-row slot="headline">
          <span>auto save</span>
          <flex-it></flex-it>
          <custom-toggle toggler="['check_box_outline_blank', 'check_box']"></custom-toggle>
        </flex-row>
      </md-list-item>
      <md-list-item>
        <custom-icon
          slot="icon"
          icon="line_weight"></custom-icon>
        <flex-row slot="headline">
          <span>symbol stroke width</span>
          <flex-it></flex-it>
          <input
            type="range"
            min="0.1"
            max="3.0"
            step="0.1"
            value="${this.#symbolStrokeWidth}"
            @change=${this.#onStrokeWidthChange}
            style="width: 120px; vertical-align: middle;" />
          <span
            style="margin-left: 8px; min-width: 32px; text-align: right; font: var(--md-sys-typescale-label-medium);"
            >${this.#symbolStrokeWidth.toFixed(2)}</span
          >
        </flex-row>
      </md-list-item>
    `
  }
}
