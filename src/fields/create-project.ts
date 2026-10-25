import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './create-project.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/button.js'
import { create } from '../api/project.js'
import { ProjectInput } from '../types.js'
import { normalizeElectricalProfile, phaseConfigurationForSupply } from '../editor/electrical-profile.js'
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
    const field = [...(this.shadowRoot?.querySelectorAll<HTMLInputElement>('input[data-field]') ?? [])].find(
      (input) => input.dataset.field === label
    )
    return (field?.value ?? '').trim()
  }

  #textField(label: string, value = '', type: 'text' | 'number' = 'text', required = false) {
    return html`
      <label class="input-field">
        <span>${label}${required ? ' *' : ''}</span>
        <input
          data-field=${label}
          type=${type}
          .value=${value}
          ?required=${required} />
      </label>
    `
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
    const supplyConfiguration = this.#selectValue('supplyConfiguration') as '1x230V+N' | '3x230V' | '3x400V+N' | 'other'
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
        phaseConfiguration: phaseConfigurationForSupply(supplyConfiguration),
        earthingSystem,
        defaultPoles,
        boards: [
          {
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
          }
        ]
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
              ${this.#textField('Project name', '', 'text', true)} ${this.#textField('Page name', '', 'text', true)}
            </section>
            <section class="block">
              <h4>Customer</h4>
              ${this.#textField('Customer name')} ${this.#textField('Customer last name')}
            </section>
            <section class="block">
              <h4>Installer</h4>
              ${this.#textField('Name', this.installerName)} ${this.#textField('Last name', this.installerLastName)}
              ${this.#textField('Company', this.installerCompany)}
              ${this.#textField('VAT / company number', this.installerBtw)}
            </section>
            <section class="block">
              <h4>Address</h4>
              ${this.#textField('Street')}
              <div class="address-row">${this.#textField('House number')} ${this.#textField('Postal code')}</div>
              ${this.#textField('City')}
            </section>
            <section class="block block-wide">
              <h4>Technical installation details</h4>
              <div class="field-grid">
                ${this.#textField('EAN code')} ${this.#textField('Main fuse (A)', '', 'number')}
                ${this.#textField('Distributor', 'Fluvius')}
                <label class="select-field"
                  ><span>Supply</span
                  ><select name="supplyConfiguration">
                    <option value="1x230V+N">1 × 230 V (L + N)</option>
                    <option value="3x230V">3 × 230 V</option>
                    <option
                      value="3x400V+N"
                      selected>
                      3 × 400 V + N
                    </option>
                    <option value="other">Other</option>
                  </select></label
                >
                <label class="select-field"
                  ><span>Earthing system</span
                  ><select name="earthingSystem">
                    <option value="unknown">Not confirmed</option>
                    <option
                      value="TT"
                      selected>
                      TT
                    </option>
                    <option value="TN">TN</option>
                    <option value="IT">IT</option>
                  </select></label
                >
              </div>
            </section>
            <section class="block block-wide">
              <h4>Main board and differential protection</h4>
              <div class="field-grid">
                ${this.#textField('Distribution board', 'Main distribution board')}
                ${this.#textField('Main RCD current (A)', '40', 'number')}
                ${this.#textField('Main RCD sensitivity (mA)', '300', 'number')}
                ${this.#textField('Main RCD poles', '4', 'number')}
                <label class="select-field"
                  ><span>RCD type</span
                  ><select name="mainRcdType">
                    <option value="AC">AC</option>
                    <option
                      value="A"
                      selected>
                      A
                    </option>
                    <option value="F">F</option>
                    <option value="B">B</option>
                    <option value="other">Other</option>
                  </select></label
                >
              </div>
            </section>
          </div>
          ${this.formError
            ? html`<p
                class="form-error"
                role="alert">
                ${this.formError}
              </p>`
            : ''}
          <div class="actions">
            <span class="required-note">* Required fields</span>
            <custom-button
              type="filled"
              .label=${this.creating ? 'Creating…' : 'Create project'}
              aria-disabled=${String(this.creating)}
              @click=${() => {
                if (!this.creating) void this.#createProject()
              }}></custom-button>
          </div>
        </div>
      </flex-container>
    `
  }
}
