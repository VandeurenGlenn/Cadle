import { LitElement, html, css, PropertyValues } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js'
import '@vandeurenglenn/lite-elements/divider.js'
import '@vandeurenglenn/flex-elements/container.js'
import '@vandeurenglenn/flex-elements/row.js'
import '@vandeurenglenn/flex-elements/it.js'
import { hotkeyList } from '../controllers/keyboard/hotkeys.js'

@customElement('keyboard-shortcuts')
export class KeyboardShortcuts extends LitElement {
  @property({ reflect: true, type: Boolean }) open = false

  transformKeys(keys: string[][]) {
    console.log(keys)
    return html`${map(
      keys,
      (combo, comboIndex) => html`
        <span class="combo">
          ${map(combo, (key, keyIndex) => html`${keyIndex ? html`<span class="plus">+</span>` : ''}<kbd>${key}</kbd>`)}
        </span>
        ${comboIndex < keys.length - 1 && keys[comboIndex + 1].length > 0 ? html`<span class="or">/</span>` : ''}
      `
    )}`
  }

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

      .combo {
        display: inline-flex;
        gap: 2px;
        align-items: center;
      }

      .plus {
        margin: 0 2px;
      }

      .or {
        margin: 0 4px;
        color: #555;
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
          Object.entries(hotkeyList),
          ([category, shortcuts]) => html`
            <h4>${category}</h4>
            <custom-divider></custom-divider>
            ${map(
              shortcuts,
              ({ keys, action }) =>
                html`<flex-row class="row-item">${this.transformKeys(keys)}<flex-it></flex-it>${action}</flex-row>`
            )}
          `
        )}
      </flex-container>
    `
  }
}
