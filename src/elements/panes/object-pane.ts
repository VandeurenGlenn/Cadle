import { LitElement, html, css } from 'lit'
import { map } from 'lit/directives/map.js'
import { customElement, property } from 'lit/decorators.js'
import './object/color.js'
import './object/export.js'
import './object/position.js'
import './object/scale.js'
import './object/text.js'
import './object/overlay.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/lite-elements/icon-button.js'

@customElement('object-pane')
export class ObjectPane extends LitElement {
  static styles = [
    css`
      :host {
        position: absolute;
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        --md-list-item-list-item-container-color: #fff;
        --md-list-item-list-item-leading-avatar-color: #fff;
        --md-list-item-list-item-leading-avatar-shape: 0;
        pointer-events: auto;
        top: 54px;
        right: 0;
        bottom: 0;
        width: 320px;

        border-left: 1px solid var(--md-sys-color-outline);
      }

      section {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      custom-button {
        pointer-events: auto;
      }
    `
  ]

  render() {
    return html`
      <object-color></object-color>
      <object-text></object-text>
      <object-scale></object-scale>
      <object-position></object-position>
      <object-overlay></object-overlay>
      <object-export></object-export>

      <custom-icon-button
        icon="measuring_tape"
        @click=${() => (cadleShell.showMeasurements = !cadleShell.showMeasurements)}></custom-icon-button>
    `
  }
}
