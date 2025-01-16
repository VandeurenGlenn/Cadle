import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lite-elements/list-item.js'

@customElement('object-color')
export class ObjectColor extends LitElement {
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
        <custom-icon icon="palette"></custom-icon>
        color
        <flex-it></flex-it>
        ${this.active
          ? html`<custom-icon icon="keyboard_arrow_up"></custom-icon>`
          : html`<custom-icon icon="keyboard_arrow_down"></custom-icon>`}
      </flex-row>

      <flex-column class="dropdown">
        <flex-row class="item">
          border
          <custom-icon icon="border_color"></custom-icon>
        </flex-row>

        <flex-row class="item">
          fill
          <custom-icon
            icon="format_color_fill"
            slot="icon"></custom-icon>
        </flex-row>
      </flex-column>
    `
  }
}
