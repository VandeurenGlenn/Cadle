
import { ListItemEl as ListItem } from '@material/web/list/lib/listitem/list-item.js';
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import {styles as forcedColors} from '@material/web/list/lib/listitem/forced-colors-styles.css.js';
import {styles} from '@material/web/list/lib/listitem/list-item-styles.css.js';

@customElement('cadle-list-item')
export class CadleListItem extends ListItem {
  static override styles = [styles, forcedColors];

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener('click', async (e) => {
     e.stopImmediatePropagation()
     e.stopPropagation()
     this.dispatchEvent(new CustomEvent('list-click', {detail: this}))
      
    })
  }
}
