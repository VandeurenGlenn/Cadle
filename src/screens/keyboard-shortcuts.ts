import { LiteElement, html, css, customElement, property } from '@vandeurenglenn/lite'
import styles from './keyboard-shortcuts.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/divider.js'
import '@vandeurenglenn/flex-elements/container.js'
import '@vandeurenglenn/flex-elements/row.js'
import '@vandeurenglenn/flex-elements/it.js'
import { hotkeyList } from '../controllers/keyboard/hotkeys.js'
import { map } from '@vandeurenglenn/lite/map.js'
@customElement('keyboard-shortcuts')
export class KeyboardShortcuts extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor open = false
  #close = () => {
    this.open = false
  }

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

  static styles = [styles]


  render() {
    return html`
      <flex-container @click=${(event: Event) => event.stopPropagation()}>
        <div class="header">
          <div>
            <h3>Keyboard Shortcuts</h3>
            <p>
              ${Object.values(hotkeyList).reduce((count, shortcuts) => count + shortcuts.length, 0)} shortcuts grouped
              by workflow
            </p>
          </div>
          <button
            class="close"
            @click=${this.#close}>
            Close
          </button>
        </div>
        <div class="grid">
          ${map(
    Object.entries(hotkeyList),
    ([category, shortcuts]) => html`
              <div class="section">
                <h4>${category}</h4>
                <custom-divider></custom-divider>
                ${map(
    shortcuts,
    ({ keys, action }) =>
      html`<flex-row class="row-item">${this.transformKeys(keys)}<flex-it></flex-it>${action}</flex-row>`
  )}
              </div>
            `
  )}
        </div>
      </flex-container>
    `
  }
}
