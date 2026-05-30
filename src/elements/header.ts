import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import styles from './header.css' with { type: 'css' }
declare global {
  interface HTMLElementTagNameMap {
    'cadle-header': CadleHeader
  }
}
@customElement('cadle-header')
export class CadleHeader extends LiteElement {
  static styles = [styles]

  render() {
    return html`
      <div class="start">
        <slot></slot>
      </div>
      <div class="end">
        <slot name="end"></slot>
      </div>
    `
  }
}
