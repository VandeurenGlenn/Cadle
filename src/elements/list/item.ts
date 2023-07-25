
import { MdListItem } from '@material/web/list/list-item.js';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'

@customElement('cadle-list-item')
export class CadleListItem extends MdListItem {

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', async (e) => {
     e.stopImmediatePropagation()
     e.stopPropagation()
     this.dispatchEvent(new CustomEvent('list-click', {detail: this}))
      
    })
  }
}
