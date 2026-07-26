import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import styles from './create-project.css' with { type: 'css' }
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/field/outlined-field.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
import { create } from '../api/project.js'
import { ProjectInput } from '../types.js'
@customElement('create-project-field')
export class CreateProjectField extends LiteElement {
  static styles = [styles]

  #fieldValue(label: string): string {
    const field = this.shadowRoot?.querySelector(`[label="${label}"]`) as HTMLElement & { value?: string }
    const nativeInput = field?.shadowRoot?.querySelector('input') as HTMLInputElement | null
    return (nativeInput?.value ?? field?.value ?? '').trim()
  }

  #createProject = async () => {
    const projectName = this.#fieldValue('Project name')
    const pageName = this.#fieldValue('Page name')
    const customerName = this.#fieldValue('Customer name')
    const customerLastName = this.#fieldValue('Customer last name')
    const installerName = this.#fieldValue('Name')
    const installerLastName = this.#fieldValue('Last name')
    const installerCompany = this.#fieldValue('Company')
    const street = this.#fieldValue('Street')
    const houseNumber = this.#fieldValue('House number')
    const postalCode = this.#fieldValue('Postal code')
    const city = this.#fieldValue('City')
    if (
      !projectName ||
      !pageName ||
      !customerName ||
      !customerLastName ||
      !installerName ||
      !installerLastName ||
      !installerCompany ||
      !street ||
      !houseNumber ||
      !postalCode ||
      !city
    ) {
      globalThis.alert('Complete all project fields before creating the project.')
      return
    }
    const project: ProjectInput = {
      name: projectName,
      customer: {
        name: customerName,
        lastname: customerLastName
      },
      installer: {
        name: installerName,
        lastname: installerLastName
      },
      company: installerCompany,
      address: {
        street,
        number: houseNumber,
        postalCode,
        city
      }
    }
    await create(project, pageName)
  }

  render() {
    return html`
      <flex-container>
        <div class="panel">
          <h1 class="title">Create project</h1>
          <p class="subtitle">Start a new Cadle project with an initial page and installer details.</p>
          <div class="sections">
            <section class="block">
              <h4>Project</h4>
              <md-outlined-text-field
                label="Project name"></md-outlined-text-field>
              <md-outlined-text-field
                label="Page name"></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Customer</h4>
              <md-outlined-text-field
                label="Customer name"></md-outlined-text-field>
              <md-outlined-text-field
                label="Customer last name"></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Installer</h4>
              <md-outlined-text-field
                label="Name"></md-outlined-text-field>
              <md-outlined-text-field
                label="Last name"></md-outlined-text-field>
              <md-outlined-text-field
                label="Company"></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Address</h4>
              <md-outlined-text-field
                label="Street"></md-outlined-text-field>
              <md-outlined-text-field
                label="House number"></md-outlined-text-field>
              <md-outlined-text-field
                label="Postal code"></md-outlined-text-field>
              <md-outlined-text-field
                label="City"></md-outlined-text-field>
            </section>
          </div>
          <div class="actions">
            <md-filled-button @click=${this.#createProject}>Create project</md-filled-button>
          </div>
        </div>
      </flex-container>
    `
  }
}
