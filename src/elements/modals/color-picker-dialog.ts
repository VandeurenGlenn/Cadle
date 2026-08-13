import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './color-picker-dialog.css' with { type: 'css' }

@customElement('color-picker-dialog')
export class ColorPickerDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ type: String }) accessor value = '#000000'
  #resolve: ((value: string) => void) | null = null
  #reject: ((reason?: unknown) => void) | null = null

  static styles = [styles]

  onChange(property: string) {
    if (property === 'open') {
      this.toggleAttribute('data-open', this.open)
      this.setAttribute('aria-hidden', String(!this.open))
    }
  }

  pick(value: string): Promise<string> {
    this.#reject?.(new DOMException('Color selection superseded', 'AbortError'))
    this.value = value
    this.open = true
    return new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
    })
  }

  #cancel = () => {
    this.open = false
    this.#reject?.(new DOMException('Color selection cancelled', 'AbortError'))
    this.#resolve = null
    this.#reject = null
  }

  #confirm = () => {
    const value = this.shadowRoot?.querySelector<HTMLInputElement>('input')?.value ?? this.value
    this.open = false
    this.#resolve?.(value)
    this.#resolve = null
    this.#reject = null
  }

  render() {
    if (!this.open) return html``
    return html`
      <button class="scrim" type="button" aria-label="Cancel color selection" @click=${this.#cancel}></button>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="color-picker-title">
        <h2 id="color-picker-title">Choose color</h2>
        <input type="color" .value=${this.value} aria-label="Color" />
        <div class="actions">
          <custom-button type="text" label="Cancel" @click=${this.#cancel}></custom-button>
          <custom-button type="filled" label="Done" @click=${this.#confirm}></custom-button>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'color-picker-dialog': ColorPickerDialog
  }
}
