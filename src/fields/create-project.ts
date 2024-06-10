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

    h5 {
      margin-top: 24px;
    }

    md-outlined-text-field {
      margin-bottom: 24px;
    }
    flex-container {
      align-items: center;
    }
  `
  protected render() {
    return html`
      <flex-container>
        <summary>
          <h3>Create Project</h3>
          <h5>General</h5>
          <md-outlined-text-field
            label="Project name"
            placeholder="residential @zipcode @streetname @housenumber">
          </md-outlined-text-field>
          <md-outlined-text-field
            label="Page name"
            placeholder="ground floor">
          </md-outlined-text-field>

          <h5>Installer</h5>
          <md-outlined-text-field
            label="name"
            placeholder="Iondependent">
          </md-outlined-text-field>

          <md-outlined-field
            label="signature"
            placeholder="Iondependent">
          </md-outlined-field>

          <h5>Installation</h5>
          <md-outlined-text-field
            label="Installer name"
            placeholder="Iondependent">
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
