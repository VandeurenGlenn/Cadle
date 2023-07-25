import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'

@customElement('context-menu')
export class Contextmenu extends LitElement {
  static styles = [
    css`
      :host {
        display: contents
      }
    `
  ];

  @property({type: Boolean, reflect: true})
  open: boolean = false

  hide() {
    this.open = false
  }

  show() {
    this.open = true
  }

  static styles = [
    css`
    custom-dropdown {
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 120px;
      max-width: 280px;
      top: 64px;
      padding: 8px 0;
      border-radius: var(--md-sys-shape-corner-extra-small);
    }
    
    custom-elevation {
      --md-elevation-level: var(--elevation-level, 1);
      border-radius: var(--md-sys-shape-corner-extra-small);
    }
    `
  ]

  render() {
    return html`
    <custom-dropdown class="contextmenu" @click=${this.hide} .open=${this.open}>
      <custom-elevation></custom-elevation>
      <custom-menu>
        <custom-list-item type="menu">
          <custom-icon-font slot="start">delete</custom-icon-font>
          delete
        </custom-list-item>
      </custom-menu>
    </custom-dropdown>
    `;
  }
}
