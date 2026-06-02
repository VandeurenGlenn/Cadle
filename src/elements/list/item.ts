import { MdListItem } from '@material/web/list/list-item.js'
import { css, customElement } from '@vandeurenglenn/lite'

@customElement('cadle-list-item')
export class CadleListItem extends MdListItem {
  static styles = [
    ...MdListItem.styles,
    css`
      :host {
        width: 100%;
        background: var(--md-sys-color-surface-variant);
        color: var(--md-sys-color-on-surface-variant);
        cursor: pointer;
        border-radius: var(--md-sys-shape-corner-extra-large);
      }
    `
  ]

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', async (e) => {
      e.stopImmediatePropagation()
      e.stopPropagation()
      this.dispatchEvent(new CustomEvent('list-click', { detail: this }))
    })
  }
}
