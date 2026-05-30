import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './create-project.css' with { type: 'css' }
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/field/outlined-field.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
import { MdOutlinedTextField } from '@material/web/textfield/outlined-text-field.js'
import { create } from '../api/project.js'
import { ProjectInput } from '../types.js'
@customElement('create-project-field')
export class CreateProjectField extends LiteElement {
  @query('[label="Project name"]') accessor nameInput!: MdOutlinedTextField
  @query('[label="Page name"]') accessor pageNameInput!: MdOutlinedTextField
  @query('[label="Name"]') accessor installerNameInput!: MdOutlinedTextField
  @query('[label="Company"]') accessor installerCompanyInput!: MdOutlinedTextField
  @query('[label="Street"]') accessor streetInput!: MdOutlinedTextField
  @query('[label="HouseNumber"]') accessor houseNumberInput!: MdOutlinedTextField
  @query('[label="Postalcode"]') accessor postalCodeInput!: MdOutlinedTextField
  @query('[label="City"]') accessor cityInput!: MdOutlinedTextField

  @property({ type: String }) accessor _projectName: string = ''
  @property({ type: String }) accessor _pageName: string = ''
  @property({ type: String }) accessor _installerName: string = ''
  @property({ type: String }) accessor _installerCompany: string = ''
  @property({ type: String }) accessor _street: string = ''
  @property({ type: String }) accessor _houseNumber: string = ''
  @property({ type: String }) accessor _postalCode: string = ''
  @property({ type: String }) accessor _city: string = ''

  static styles = [styles]

  get hasRequiredFields() {
    return Boolean(this._projectName.trim() && this._pageName.trim())
  }

  #readInputs() {
    this._projectName = this.nameInput?.value?.trim() ?? ''
    this._pageName = this.pageNameInput?.value?.trim() ?? ''
    this._installerName = this.installerNameInput?.value?.trim() ?? ''
    this._installerCompany = this.installerCompanyInput?.value?.trim() ?? ''
    this._street = this.streetInput?.value?.trim() ?? ''
    this._houseNumber = this.houseNumberInput?.value?.trim() ?? ''
    this._postalCode = this.postalCodeInput?.value?.trim() ?? ''
    this._city = this.cityInput?.value?.trim() ?? ''
  }

  #onFieldInput = () => {
    this.#readInputs()
  }

  #createProject = async () => {
    this.#readInputs()
    if (!this.hasRequiredFields) return
    const project: ProjectInput = {
      name: this._projectName,
      installer: {
        name: this._installerName,
        lastname: ''
      },
      company: this._installerCompany,
      address: {
        street: this._street,
        number: this._houseNumber,
        postalCode: this._postalCode
      }
    }
    await create(project, this._pageName)
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
                label="Project name"
                .value=${this._projectName}
                @input=${this.#onFieldInput}></md-outlined-text-field>
              <md-outlined-text-field
                label="Page name"
                .value=${this._pageName}
                @input=${this.#onFieldInput}></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Installer</h4>
              <md-outlined-text-field
                label="Name"
                .value=${this._installerName}
                @input=${this.#onFieldInput}></md-outlined-text-field>
              <md-outlined-text-field
                label="Company"
                .value=${this._installerCompany}
                @input=${this.#onFieldInput}></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Address</h4>
              <md-outlined-text-field
                label="Street"
                .value=${this._street}
                @input=${this.#onFieldInput}></md-outlined-text-field>
              <md-outlined-text-field
                label="HouseNumber"
                .value=${this._houseNumber}
                @input=${this.#onFieldInput}></md-outlined-text-field>
              <md-outlined-text-field
                label="Postalcode"
                .value=${this._postalCode}
                @input=${this.#onFieldInput}></md-outlined-text-field>
              <md-outlined-text-field
                label="City"
                .value=${this._city}
                @input=${this.#onFieldInput}></md-outlined-text-field>
            </section>
          </div>
          <div class="actions">
            <md-filled-button
              ?disabled=${!this.hasRequiredFields}
              @click=${this.#createProject}>
              Create project
            </md-filled-button>
          </div>
        </div>
      </flex-container>
    `
  }
}
