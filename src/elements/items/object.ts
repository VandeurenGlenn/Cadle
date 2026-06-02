import { LiteElement, html, property } from '@vandeurenglenn/lite'
import styles from './object.css' with { type: 'css' }
export class ObjectItem extends LiteElement {
  @property({ reflect: true, type: Boolean }) accessor active: boolean = false
  @property({ type: String }) accessor label: string = ''
  @property({ type: String }) accessor icon: string = ''

  firstRender() {
    this.shadowRoot?.addEventListener('click', this.#onClick)
  }

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  static styles = [styles]

  render() {
    return html`
      <flex-row
        center
        class="item">
        <custom-icon .icon=${this.icon}></custom-icon>
        ${this.label}
        <flex-it></flex-it>
        <custom-icon .icon=${this.active ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}></custom-icon>
      </flex-row>
      <div class="dropdown">
        <slot></slot>
      </div>
    `
  }
}
customElements.define('object-item', ObjectItem)
