import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/elevation.js'

declare global {
  interface HTMLElementTagNameMap {
    'search-element': SearchElement
  }
}

@customElement('search-element')
export class SearchElement extends LitElement {
  #timeout

  @property() placeholder: string

  @property() name: string

  @query('input') _inputEl: HTMLInputElement

  static styles = [
    css`
      :host {
        display: flex;
        margin: 12px;
        height: 40px;
        box-sizing: border-box;
        position: relative;
        border-radius: var(--md-sys-shape-corner-large);
      }

      input {
        width: 100%;
        height: 100%;
        padding: 6px 12px;
        box-sizing: border-box;
        border: none;
        border-radius: var(--md-sys-shape-corner-large);
      }
      input:focus {
        outline: 1px solid var(--md-sys-color-outline);
      }
    `
  ]

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
