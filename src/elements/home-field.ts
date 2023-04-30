import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@material/web/button/tonal-button.js'
import '@material/web/button/outlined-button.js'

@customElement('home-field')
export class HomeField extends LitElement {
  static styles = [
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      flex-column {
        height: 110px;
      }
    `
  ];

  render() {
    return html`
      <flex-column>
        <md-tonal-button>new</md-tonal-button>
        <flex-one></flex-one>
        <md-outlined-button>load</md-outlined-button>
      </flex-column>
    `;
  }
}
