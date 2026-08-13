import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/toggle.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/lite-elements/list-item.js'
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
      <custom-list-item>
        <custom-icon
          slot="start"
          icon="save"></custom-icon>
        <flex-row>
          <span>auto save</span>
          <flex-it></flex-it>
          <custom-toggle toggler="['check_box_outline_blank', 'check_box']"></custom-toggle>
        </flex-row>
      </custom-list-item>
      <custom-list-item>
        <custom-icon
          slot="start"
          icon="line_weight"></custom-icon>
        <flex-row>
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
      </custom-list-item>
    `
  }
}
