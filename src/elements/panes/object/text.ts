import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/list-item.js'

@customElement('object-text')
export class ObjectText extends LitElement {
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
        <custom-icon icon="format_size"></custom-icon>
        text
        <flex-it></flex-it>
        <custom-icon icon="keyboard_arrow_down"></custom-icon>
      </flex-row>

      <flex-column class="dropdown">
        <flex-row class="item"> top </flex-row>

        <flex-row class="item"> left </flex-row>

        <flex-row class="item"> bottom </flex-row>

        <flex-row class="item"> right </flex-row>
      </flex-column>
    `
  }
}
