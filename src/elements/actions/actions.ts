import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/icon-font.js'
declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions;
  }
}

@customElement('cadle-actions')
export class CadleActions extends LitElement {
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: row;
        width: 100%;
      }
    `
  ];

  render() {
    return html`
    <md-standard-icon-button @click=${globalThis.cadleShell.undo}><custom-icon-font>undo</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click=${globalThis.cadleShell.redo}><custom-icon-font>redo</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'select')}"><custom-icon-font>arrow_selector_tool</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.freeDraw = !globalThis.cadleShell.freeDraw)}" toggle>
      <custom-icon-font>grid_on</custom-icon-font>
      <custom-icon-font slot="selectedIcon">grid_off</custom-icon-font>
    </md-standard-icon-button>
    <flex-one></flex-one>
    <md-standard-icon-button @click=${globalThis.cadleShell.drawText.bind(globalThis.cadleShell)}><custom-icon-font>insert_text</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw-wall')}"><custom-icon-font>polyline</custom-icon-font></md-standard-icon-button>
    <flex-one></flex-one>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw')}"><custom-icon-font>draw</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw-square')}"><custom-icon-font>square</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw-circle')}"><custom-icon-font>circle</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw-arc')}"><custom-icon-font>line_curve</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'draw-line')}"><custom-icon-font>horizontal_rule</custom-icon-font></md-standard-icon-button>
    
    `;
  }
}
