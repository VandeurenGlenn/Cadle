import { LitElement, html, css } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/field/outlined-field.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js'

@customElement('create-project-field')
export class CreateProjectField extends LitElement {
  @query('[label="Project name"]')
  nameInput: MdOutlinedTextField

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    summary {
      align-items: center;
      border-radius: var(--md-sys-shape-corner-large);
      border: 1px solid var(--md-sys-color-outline);
      padding: 12px 24px;
      box-sizing: border-box;
    }

    h4 {
      margin-top: 24px;
    }

    md-outlined-text-field {
      margin-bottom: 24px;
    }
    flex-container {
      align-items: center;
      --flex-display-max-width: 507px;
    }
  `
  protected render() {
    return html`
      <flex-container>
        <summary>
          <h3>Create Project</h3>
          <h4>General</h4>
          <md-outlined-text-field
            label="Project name"
            placeholder="residential @zipcode @streetname @housenumber">
          </md-outlined-text-field>

          <md-outlined-text-field
            label="Page name"
            placeholder="ground floor">
          </md-outlined-text-field>

          <h4>Installer</h4>
          <md-outlined-text-field
            label="Name"
            placeholder="Iondependent">
          </md-outlined-text-field>

          <md-outlined-text-field
            label="Company"
            placeholder="Cadle BV">
          </md-outlined-text-field>

          <h4>Installation</h4>
          <h5>Address</h5>

          <md-outlined-text-field
            label="Street"
            placeholder="mainstreet">
          </md-outlined-text-field>

          <md-outlined-text-field
            label="HouseNumber"
            placeholder="1">
          </md-outlined-text-field>

          <md-outlined-text-field
            label="Postalcode"
            placeholder="0001">
          </md-outlined-text-field>

          <md-outlined-text-field
            label="City"
            placeholder="NewCity">
          </md-outlined-text-field>

          <flex-row>
            <md-outlined-button @click=${() => history.back()}> cancel </md-outlined-button>
            <flex-it></flex-it>
            <md-filled-button @click=${() => cadleShell.createProject(this.nameInput.value)}> create </md-filled-button>
          </flex-row>
        </summary>
      </flex-container>
    `
  }
}
