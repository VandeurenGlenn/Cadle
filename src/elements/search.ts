import { LiteElement, html, css, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './search.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/elevation.js'
declare global {
  interface HTMLElementTagNameMap {
    'search-element': SearchElement
  }
}
@customElement('search-element')
export class SearchElement extends LiteElement {
  #timeout: ReturnType<typeof setTimeout> | undefined
  @property({ type: String }) accessor placeholder = ''
  @property({ type: String }) accessor name = ''
  @query('input') accessor _inputEl!: HTMLInputElement
  static styles = [styles]


  #input = () => {
    if (this.#timeout) clearTimeout(this.#timeout)
    this.#timeout = setTimeout(() => {
      const value = this._inputEl.value
      this.dispatchEvent(new CustomEvent('search', { detail: value === '' ? undefined : value }))
    }, 100)
  }

  render() {
    return html`
      <input
        @input=${this.#input}
        type="search"
        name=${this.name}
        placeholder=${this.placeholder} />
      <custom-elevation></custom-elevation>
    `
  }
}
