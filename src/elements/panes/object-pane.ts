import { LitElement, html, css } from 'lit'
import { map } from 'lit/directives/map.js'
import { customElement, property } from 'lit/decorators.js'
import './object/color.js'
import './object/export.js'
import './object/position.js'
import './object/text.js'

@customElement('object-pane')
export class ObjectPane extends LitElement {
  connectedCallback(): void {
    super.connectedCallback()
    this.shadowRoot.addEventListener('click', this.#click)
  }

  #click = (event) => {
    console.log(event.target)
    event.target.active = !event.target.active
  }
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
    return html` <object-color></object-color>
      <object-text></object-text>
      <object-position></object-position>
      <object-export></object-export>`
  }
}
