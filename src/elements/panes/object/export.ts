import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lite-elements/list-item.js'

@customElement('object-export')
export class ObjectExport extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean
  static styles = [
    css`
      :host {
        display: block;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      .item {
        cursor: pointer;
        padding: 12px;
        box-sizing: border-box;
      }

      .dropdown {
        box-sizing: border-box;
        height: 0;
        opacity: 0;
        pointer-events: none;
      }

      :host([active]) .dropdown {
        height: auto;
        opacity: 1;
        pointer-events: auto;
        padding: 6px 12px;
      }
      custom-icon {
        margin-right: 12px;
      }
    `
  ]

  render() {
    return html`
      <flex-row
        center
        class="item">
        <custom-icon icon="output"></custom-icon>
        export
        <flex-it></flex-it>
        <custom-icon icon="keyboard_arrow_down"></custom-icon>
      </flex-row>

      <flex-column class="dropdown">
        <flex-row class="item">
          <custom-icon icon="save"></custom-icon>
          add to catalog
        </flex-row>
      </flex-column>
    `
  }
}
