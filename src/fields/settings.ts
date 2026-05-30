import { LiteElement, html, css, customElement } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/toggle.js'
import '@vandeurenglenn/lite-elements/icon.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
@customElement('settings-field')
export class SettingsField extends LiteElement {
  render() {
    return html`
      <md-list-item>
        <custom-icon
          slot="icon"
          icon="save"></custom-icon>
        <flex-row slot="headline">
          <span>auto save</span>
          <flex-it></flex-it>
          <custom-toggle toggler="['check_box_outline_blank', 'check_box']"></custom-toggle>
        </flex-row>
      </md-list-item>
    `
  }
}
