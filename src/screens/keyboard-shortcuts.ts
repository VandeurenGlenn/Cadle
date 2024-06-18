import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js'
import '@vandeurenglenn/lit-elements/divider.js'

@customElement('keyboard-shortcuts')
export class KeyboardShortcuts extends LitElement {
  shortcuts = {
    general: [
      {
        combination: html`<kbd>Ctrl</kbd> + <kbd>C</kbd>`,
        action: 'Copy'
      },
      {
        combination: html`<kbd>Ctrl</kbd> + <kbd>P</kbd>`,
        action: 'Paste'
      }
    ],
    drawing: [
      {
        combination: html`<kbd>Ctrl</kbd> + <kbd>SHIFT</kbd> + <kbd>T</kbd>`,
        action: 'Insert Text'
      },
      {
        combination: html`<kbd>Ctrl</kbd> + <kbd>B</kbd>`,
        action: 'Send object to back'
      },
      {
        combination: html`<kbd>Ctrl</kbd> + <kbd>SHIFT</kbd> +<kbd>B</kbd>`,
        action: 'Bring object to front'
      }
    ]
  }

  @property({ reflect: true, type: Boolean }) open = false

  static styles = [
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        background-color: #0000007d;
        z-index: 10000;
      }

      :host([open]) {
        opacity: 1;
        pointer-events: auto;
      }

      kbd {
        background-color: #eee;
        border-radius: 3px;
        border: 1px solid #b4b4b4;
        box-shadow: 0 1px 1px rgba(0, 0, 0, 0.2), 0 2px 0 0 rgba(255, 255, 255, 0.7) inset;
        color: #333;
        display: inline-block;
        font-size: 0.85em;
        font-weight: 700;
        line-height: 1;
        padding: 2px 4px;
        white-space: nowrap;
      }

      flex-container {
        width: 100%;
        max-width: 360px;
        background-color: var(--md-sys-color-surface-container);
        color: var(--md-sys-color-on-surface-container);
      }

      .row-item {
        width: 100%;
        margin-bottom: 6px;
      }

      flex-container .row-item:nth-child(even) {
        background-color: #0000001a;
      }
      h4 {
        margin-bottom: 6px;
      }

      custom-divider {
        width: 100%;
      }
    `
  ]

  render() {
    return html`
      <flex-container>
        <h3>keyboard shortcuts</h3>
        ${map(
          Object.entries(this.shortcuts),
          ([category, shortcuts]) => html`
            <h4>${category}</h4>
            <custom-divider></custom-divider>
            ${map(
              shortcuts,
              ({ combination, action }) =>
                html`<flex-row class="row-item">${combination}<flex-it></flex-it>${action}</flex-row>`
            )}
          `
        )}
      </flex-container>
    `
  }
}
