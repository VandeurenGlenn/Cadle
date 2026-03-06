import { LitElement, html, css, PropertyValues } from 'lit'
import { property } from 'lit/decorators.js'
import { objectItemStyles } from './object.css.js'

export class ObjectItem extends LitElement {
  @property({ reflect: true, type: Boolean }) active: boolean

  @property({ type: String }) label: string

  @property({ type: String }) icon: string

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.renderRoot.addEventListener('click', this.#onClick as any)
  }

  #onClick = (e: Event) => {
    const target = e.target as HTMLElement
    if (target.closest('.item') && !target.closest('.dropdown')) {
      this.active = !this.active
    }
  }

  static styles = [objectItemStyles]

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
