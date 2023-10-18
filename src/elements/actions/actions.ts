import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/icon-font.js'
import '@vandeurenglenn/lit-elements/icon-button.js'
import '@vandeurenglenn/lit-elements/toggle.js'
import '@vandeurenglenn/lit-elements/list-item.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'


declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions;
  }
}

@customElement('cadle-actions')
export class CadleActions extends LitElement {
  @property({ type: Boolean, reflect: true })
  open: boolean = true
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: row;
        width: 100%;
        opacity: 0;
      }
      custom-list-item {
        width: 100%;
      }
      :host([open]) {
        opacity: 1;
      }
    `
  ];

  show() {
    this.open = true
  }

  hide() {
    this.open = false
  }

  #showMenu = (event) => {
    event.preventDefault()
    const target = event.composedPath()[0]
    console.log(target);
    const {top, left, width} = target.getBoundingClientRect()
    
    const menu = this.renderRoot.querySelector('context-menu')
    const drop = menu.shadowRoot.querySelector('custom-dropdown')
    if (target.route = 'insert-text') {
      menu.innerHTML = `
      <custom-list-item type="menu" name="normal">
        <custom-toggle active="${cadleShell.inputType === 'normal' ? 1 : 0}" slot="end">
          <custom-icon-font>check_box_outline_blank</custom-icon-font>
          <custom-icon-font>check_box</custom-icon-font>
        </custom-toggle>
        normal
      </custom-list-item>

      <custom-list-item type="menu" name="socket">
        <custom-toggle active="${cadleShell.inputType === 'socket' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font>check_box</custom-icon-font>
        </custom-toggle>
        sockets
      </custom-list-item>

      <custom-list-item type="menu" name="switch">
        <custom-toggle active="${cadleShell.inputType === 'switch' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font>check_box</custom-icon-font>
        </custom-toggle>
        switches
      </custom-list-item>

      <custom-list-item type="menu" name="alphabet">
        <custom-toggle active="${cadleShell.inputType === 'alphabet' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font>check_box</custom-icon-font>
        </custom-toggle>
        alphabet
      </custom-list-item>
      `
    }
    // drop.style.opacity = 0
    // drop.addEventListener('transitionend', () => {
    //   drop.style.left = `${left - width - drop.getBoundingClientRect().width}px`
    // })
    menu.open = !menu.open

    drop.style.left = `${left - width - 280}px`
  }

  #selected = ({detail}) => {
    if (detail === 'alphabet' || detail === 'normal' || detail === 'switch' || detail === 'socket') {

      cadleShell.inputType = detail
      cadleShell.dialog.innerHTML = `
      <md-filled-text-field
        label="input"
        value="${cadleShell.currentText}"
        dialogFocus>
      </md-filled-text-field>

      <custom-icon-button slot="footer" icon="done" dialog-action="confirm-input"></custom-icon-button>
      `
      cadleShell.dialog.open = true
    }
    

  }
  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener("contextmenu", this.#showMenu);
  }

  render() {
    return html`
    <context-menu @selected=${this.#selected}>
      
    </context-menu>

  

    <md-standard-icon-button @click=${globalThis.cadleShell.undo}><custom-icon-font>undo</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click=${globalThis.cadleShell.redo}><custom-icon-font>redo</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.action = 'select')}"><custom-icon-font>arrow_selector_tool</custom-icon-font></md-standard-icon-button>
    <md-standard-icon-button @click="${() => (globalThis.cadleShell.freeDraw = !globalThis.cadleShell.freeDraw)}" toggle>
      <custom-icon-font>grid_on</custom-icon-font>
      <custom-icon-font slot="selectedIcon">grid_off</custom-icon-font>
    </md-standard-icon-button>
    <flex-one></flex-one>
    <custom-icon-button
      route="insert-text"
      icon="insert_text"
      @click=${globalThis.cadleShell.drawText.bind(globalThis.cadleShell)}>
    </custom-icon-button>
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
