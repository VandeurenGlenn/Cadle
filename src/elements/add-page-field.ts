import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@material/web/dialog/dialog.js'
import '@material/web/button/outlined-button.js'
import '@material/web/textfield/outlined-text-field.js'

@customElement('add-page-field')
export class AddPageField extends LitElement {
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
      <md-outlined-text-field label="name"></md-outlined-text-field>
      <md-standard-icon-button href="#!/draw?last=true">check</md-standard-icon-button>
    `;
  }
}
