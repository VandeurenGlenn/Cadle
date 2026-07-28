import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './create-project.css' with { type: 'css' }
import '@material/web/button/filled-button.js'
import '@material/web/textfield/outlined-text-field.js'
import { create } from '../api/project.js'
import { ProjectInput } from '../types.js'
import { normalizeElectricalProfile } from '../editor/electrical-profile.js'
import { getInstallerProfile, saveInstallerProfile } from '../api/installer-profile.js'
@customElement('create-project-field')
export class CreateProjectField extends LiteElement {
  @property({ type: String }) accessor installerName = ''
  @property({ type: String }) accessor installerLastName = ''
  @property({ type: String }) accessor installerCompany = ''
  @property({ type: String }) accessor installerBtw = ''
  @property({ type: String }) accessor formError = ''
  @property({ type: Boolean }) accessor creating = false

  static styles = [styles]

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    const profile = await getInstallerProfile()
    this.installerName ||= profile.name
    this.installerLastName ||= profile.lastname
    this.installerCompany ||= profile.company
    this.installerBtw ||= profile.btw
  }

  #fieldValue(label: string): string {
    const field = this.shadowRoot?.querySelector(`[label="${label}"]`) as HTMLElement & { value?: string }
    const nativeInput = field?.shadowRoot?.querySelector('input') as HTMLInputElement | null
    return (nativeInput?.value ?? field?.value ?? '').trim()
  }

  #selectValue(name: string): string {
    return (this.shadowRoot?.querySelector<HTMLSelectElement>(`select[name="${name}"]`)?.value ?? '').trim()
  }

  #createProject = async () => {
    if (this.creating) return
    this.formError = ''
    const projectName = this.#fieldValue('Project name')
    const pageName = this.#fieldValue('Page name')
    const customerName = this.#fieldValue('Customer name')
    const customerLastName = this.#fieldValue('Customer last name')
    const installerName = this.#fieldValue('Name')
    const installerLastName = this.#fieldValue('Last name')
    const installerCompany = this.#fieldValue('Company')
    const installerBtw = this.#fieldValue('VAT / company number')
    const street = this.#fieldValue('Street')
    const houseNumber = this.#fieldValue('House number')
    const postalCode = this.#fieldValue('Postal code')
    const city = this.#fieldValue('City')
    const eanCode = this.#fieldValue('EAN code')
    const mainFuseA = Number(this.#fieldValue('Main fuse (A)')) || 0
    const distributor = this.#fieldValue('Distributor')
    const boardName = this.#fieldValue('Distribution board') || 'Main distribution board'
    const mainRcdCurrentA = Number(this.#fieldValue('Main RCD current (A)')) || 40
    const mainRcdSensitivityMa = Number(this.#fieldValue('Main RCD sensitivity (mA)')) || 300
    const mainRcdPoles = Number(this.#fieldValue('Main RCD poles')) || 2
    const supplyConfiguration = this.#selectValue('supplyConfiguration') as
      | '1x230V+N'
      | '3x230V'
      | '3x400V+N'
      | 'other'
    const earthingSystem = this.#selectValue('earthingSystem') as 'TT' | 'TN' | 'IT' | 'unknown'
    const mainRcdType = this.#selectValue('mainRcdType') as 'AC' | 'A' | 'F' | 'B' | 'other'
    if (!projectName || !pageName) {
      this.formError = 'Project name and first page name are required.'
      return
    }
    const normalizedEan = eanCode.replace(/\s+/g, '')
    if (normalizedEan && !/^\d{18}$/.test(normalizedEan)) {
      this.formError = 'The EAN code must contain exactly 18 digits.'
      return
    }
    const supplyVoltageV = supplyConfiguration === '3x400V+N' ? 400 : 230
    const defaultPoles = supplyConfiguration === '3x400V+N' ? 4 : supplyConfiguration === '3x230V' ? 3 : 2
    const project: ProjectInput = {
      name: projectName,
      customer: {
        name: customerName,
        lastname: customerLastName
      },
      installer: {
        name: installerName,
        lastname: installerLastName,
        btw: installerBtw || undefined
      },
      company: installerCompany,
      address: {
        street,
        number: houseNumber,
        postalCode,
        city
      },
      eanCode: normalizedEan || undefined,
      mainFuseA: mainFuseA > 0 ? mainFuseA : undefined,
      electricalProfile: normalizeElectricalProfile({
        standard: 'AREI',
        edition: 'Book 1 (current edition)',
        distributor,
        supplyConfiguration,
        supplyVoltageV,
        phaseConfiguration: supplyConfiguration === '1x230V+N' ? 'single-phase' : 'three-phase',
        earthingSystem,
        defaultPoles,
        boards: [{
          id: 'main',
          name: boardName,
          rails: [{ id: 'rail-1', name: 'Rail 1' }],
          mainDifferential: {
            id: 'main-rcd',
            ratedCurrentA: mainRcdCurrentA,
            sensitivityMa: mainRcdSensitivityMa,
            poles: mainRcdPoles,
            type: mainRcdType
          }
        }]
      })
    }
    this.creating = true
    try {
      try {
        await saveInstallerProfile({
          name: installerName,
          lastname: installerLastName,
          company: installerCompany,
          btw: installerBtw
        })
      } catch (error) {
        console.warn('Project will be created without updating the reusable installer profile.', error)
      }
      await create(project, pageName)
    } catch (error) {
      console.error('Unable to create project', error)
      this.formError = 'The project could not be created. Please try again.'
    } finally {
      this.creating = false
    }
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
                required></md-outlined-text-field>
              <md-outlined-text-field
                label="Page name"
                required></md-outlined-text-field>
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
                label="Name"
                .value=${this.installerName}></md-outlined-text-field>
              <md-outlined-text-field
                label="Last name"
                .value=${this.installerLastName}></md-outlined-text-field>
              <md-outlined-text-field
                label="Company"
                .value=${this.installerCompany}></md-outlined-text-field>
              <md-outlined-text-field
                label="VAT / company number"
                .value=${this.installerBtw}></md-outlined-text-field>
            </section>
            <section class="block">
              <h4>Address</h4>
              <md-outlined-text-field
                label="Street"></md-outlined-text-field>
              <div class="address-row">
                <md-outlined-text-field
                  label="House number"></md-outlined-text-field>
                <md-outlined-text-field
                  label="Postal code"></md-outlined-text-field>
              </div>
              <md-outlined-text-field
                label="City"></md-outlined-text-field>
            </section>
            <section class="block block-wide">
              <h4>Technical installation details</h4>
              <div class="field-grid">
                <md-outlined-text-field label="EAN code"></md-outlined-text-field>
                <md-outlined-text-field label="Main fuse (A)" type="number"></md-outlined-text-field>
                <md-outlined-text-field label="Distributor" value="Fluvius"></md-outlined-text-field>
                <label class="select-field"><span>Supply</span><select name="supplyConfiguration">
                  <option value="1x230V+N">1 × 230 V (L + N)</option>
                  <option value="3x230V">3 × 230 V</option>
                  <option value="3x400V+N" selected>3 × 400 V + N</option>
                  <option value="other">Other</option>
                </select></label>
                <label class="select-field"><span>Earthing system</span><select name="earthingSystem">
                  <option value="unknown">Not confirmed</option><option value="TT" selected>TT</option>
                  <option value="TN">TN</option><option value="IT">IT</option>
                </select></label>
              </div>
            </section>
            <section class="block block-wide">
              <h4>Main board and differential protection</h4>
              <div class="field-grid">
                <md-outlined-text-field label="Distribution board" value="Main distribution board"></md-outlined-text-field>
                <md-outlined-text-field label="Main RCD current (A)" type="number" value="40"></md-outlined-text-field>
                <md-outlined-text-field label="Main RCD sensitivity (mA)" type="number" value="300"></md-outlined-text-field>
                <md-outlined-text-field label="Main RCD poles" type="number" value="4"></md-outlined-text-field>
                <label class="select-field"><span>RCD type</span><select name="mainRcdType">
                  <option value="AC">AC</option><option value="A" selected>A</option>
                  <option value="F">F</option><option value="B">B</option><option value="other">Other</option>
                </select></label>
              </div>
            </section>
          </div>
          ${this.formError
            ? html`<p class="form-error" role="alert">${this.formError}</p>`
            : ''}
          <div class="actions">
            <span class="required-note">* Required fields</span>
            <md-filled-button
              ?disabled=${this.creating}
              @click=${this.#createProject}>${this.creating ? 'Creating…' : 'Create project'}</md-filled-button>
          </div>
        </div>
      </flex-container>
    `
  }
}
