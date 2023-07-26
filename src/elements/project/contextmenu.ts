import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/menu.js'
import '@vandeurenglenn/lit-elements/dropdown.js'

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

  #selected = ({detail}: CustomEvent) => {
    this.dispatchEvent(new CustomEvent('selected', {detail}))
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
      <custom-menu @selected=${this.#selected}>
        <slot></slot>
      </custom-menu>
    </custom-dropdown>
    `;
  }
}
