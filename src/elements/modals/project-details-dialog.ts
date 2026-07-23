import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './project-details-dialog.css' with { type: 'css' }
import type { Project, Projects, UUID } from '../../types.js'
import { getProjectData, getProjects, set, setProjectData } from '../../api/project.js'

type ProjectDetailsSavedDetail = {
  project: Project
  projects: Projects
}

@customElement('project-details-dialog')
export class ProjectDetailsDialog extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ attribute: false }) accessor project: Project | null = null
  @property({ type: String }) accessor projectKey: UUID = '' as UUID

  @property({ type: String }) accessor projectName = ''
  @property({ type: String }) accessor customer = ''
  @property({ type: String }) accessor installer = ''
  @property({ type: String }) accessor company = ''
  @property({ type: String }) accessor street = ''
  @property({ type: String }) accessor houseNumber = ''
  @property({ type: String }) accessor postalCode = ''
  @property({ type: String }) accessor city = ''
  @property({ type: String }) accessor installerBtw = ''
  @property({ type: String }) accessor eanCode = ''
  @property({ type: Number }) accessor mainFuseA = 0
  @property({ type: String }) accessor logoUrl = ''
  @property({ type: String }) accessor logoColor = ''
  @property({ type: Number }) accessor logoScale = 1

  static styles = [styles]

  onChange(property: string) {
    if (property === 'project' || property === 'open') {
      this.#syncFormFromProject()
    }
  }

  #syncFormFromProject() {
    if (!this.open) return
    this.projectName = this.project?.name ?? ''
    this.logoUrl = this.project?.logoUrl?.trim() ?? ''
    this.logoColor = this.project?.logoColor?.trim() ?? ''
    this.logoScale =
      typeof this.project?.logoScale === 'number' && Number.isFinite(this.project.logoScale)
        ? Math.max(0.4, Math.min(2.5, this.project.logoScale))
        : 1
    this.customer = [this.project?.customer?.name ?? '', this.project?.customer?.lastname ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
    this.installer = [this.project?.installer?.name ?? '', this.project?.installer?.lastname ?? '']
      .map((value) => value.trim())
      .filter(Boolean)
      .join(' ')
    this.company = this.project?.company ?? ''
    this.street = this.project?.address?.street ?? ''
    this.houseNumber = this.project?.address?.number ?? ''
    this.postalCode = this.project?.address?.postalCode ?? ''
    this.city = this.project?.address?.city ?? ''
    this.installerBtw = this.project?.installer?.btw ?? ''
    this.eanCode = this.project?.eanCode ?? ''
    this.mainFuseA = this.project?.mainFuseA ?? 0
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #onMetaInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    const field = target?.dataset.field ?? ''
    const value = target?.value ?? ''
    switch (field) {
      case 'projectName':
        this.projectName = value
        break
      case 'customer':
        this.customer = value
        break
      case 'installer':
        this.installer = value
        break
      case 'company':
        this.company = value
        break
      case 'street':
        this.street = value
        break
      case 'houseNumber':
        this.houseNumber = value
        break
      case 'postalCode':
        this.postalCode = value
        break
      case 'city':
        this.city = value
        break
      case 'installerBtw':
        this.installerBtw = value
        break
      case 'eanCode':
        this.eanCode = value
        break
      case 'mainFuseA':
        this.mainFuseA = Math.max(0, Number(value) || 0)
        break
      case 'logoUrl':
        this.logoUrl = value
        break
      case 'logoColor':
        this.logoColor = value
        break
      case 'logoScale':
        this.logoScale = Math.max(0.4, Math.min(2.5, Number(value) || 1))
        break
      default:
        break
    }
  }

  #logoPickerValue() {
    const value = this.logoColor.trim()
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#2d231c'
  }

  #onLogoFilePicked = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) return

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Unable to read logo file'))
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') resolve(result)
        else reject(new Error('Unsupported logo file payload'))
      }
      reader.readAsDataURL(file)
    })

    this.logoUrl = dataUrl
    if (input) input.value = ''
  }

  #clearLogo = () => {
    this.logoUrl = ''
  }

  #onLogoColorPick = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement | null
    this.logoColor = target?.value?.trim() ?? ''
  }

  #save = async () => {
    if (!this.project || !this.projectKey) return

    const splitPersonName = (value: string): { first: string; last: string } => {
      const parts = value.trim().split(/\s+/).filter(Boolean)
      if (parts.length === 0) return { first: '', last: '' }
      if (parts.length === 1) return { first: parts[0], last: '' }
      return {
        first: parts.slice(0, -1).join(' '),
        last: parts[parts.length - 1]
      }
    }

    const nextProject = structuredClone(this.project)
    const customerParts = this.customer.trim().split(/\s+/).filter(Boolean)
    const customerName = customerParts.length > 0 ? customerParts.slice(0, -1).join(' ') || customerParts[0] : ''
    const customerLastName = customerParts.length > 1 ? customerParts[customerParts.length - 1] : ''
    const installer = splitPersonName(this.installer)

    if (!nextProject.customer) {
      nextProject.customer = { name: '', lastname: '' }
    }
    if (!nextProject.installer) {
      nextProject.installer = { name: '', lastname: '' }
    }
    if (!nextProject.address) {
      nextProject.address = { street: '', number: '', postalCode: '', city: '' }
    }

    nextProject.name = this.projectName.trim()
    const logo = this.logoUrl.trim()
    const logoColor = this.logoColor.trim()
    nextProject.logoUrl = logo.length > 0 ? logo : undefined
    nextProject.logoColor = logoColor.length > 0 ? logoColor : undefined
    nextProject.logoScale = Math.max(0.4, Math.min(2.5, this.logoScale))
    nextProject.customer.name = customerName
    nextProject.customer.lastname = customerLastName
    nextProject.installer.name = installer.first
    nextProject.installer.lastname = installer.last
    nextProject.company = this.company.trim()
    nextProject.address.street = this.street.trim()
    nextProject.address.number = this.houseNumber.trim()
    nextProject.address.postalCode = this.postalCode.trim()
    nextProject.address.city = this.city.trim()
    if (!nextProject.installer) nextProject.installer = { name: '', lastname: '' }
    nextProject.installer.btw = this.installerBtw.trim() || undefined
    nextProject.eanCode = this.eanCode.trim() || undefined
    nextProject.mainFuseA = this.mainFuseA > 0 ? this.mainFuseA : undefined

    await setProjectData(this.projectKey, nextProject)
    await set(this.projectKey, nextProject.name)

    const savedProject = await getProjectData(this.projectKey)
    const projects = await getProjects()

    this.dispatchEvent(
      new CustomEvent<ProjectDetailsSavedDetail>('saved', {
        bubbles: true,
        composed: true,
        detail: {
          project: savedProject,
          projects
        }
      })
    )

    this.#close()
  }

  render() {
    return html`
      <div
        class="panel"
        @click=${(event: Event) => event.stopPropagation()}>
        <div class="header">
          <div>
            <h3>Projectgegevens</h3>
            <p>Bewerk de gegevens die gebruikt worden in het titelblok en exports.</p>
          </div>
          <button
            type="button"
            @click=${this.#close}>
            Sluiten
          </button>
        </div>
        <div class="form-grid">
          <label>
            <span>Project</span>
            <input
              .value=${this.projectName}
              data-field="projectName"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Logo URL</span>
            <input
              .value=${this.logoUrl}
              data-field="logoUrl"
              @input=${this.#onMetaInput}
              placeholder="https://... or data:image/..." />
          </label>
          <div class="logo-controls">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              @change=${this.#onLogoFilePicked} />
            <button
              type="button"
              class="clear-logo"
              @click=${this.#clearLogo}>
              Remove logo
            </button>
          </div>
          <div class="logo-style-controls">
            <label>
              <span>Logo color</span>
              <input
                type="color"
                .value=${this.#logoPickerValue()}
                @input=${this.#onLogoColorPick} />
            </label>
            <label>
              <span>Logo scale</span>
              <input
                type="number"
                min="0.4"
                max="2.5"
                step="0.1"
                .value=${String(this.logoScale)}
                data-field="logoScale"
                @input=${this.#onMetaInput} />
            </label>
          </div>
          <label>
            <span>Klant</span>
            <input
              .value=${this.customer}
              data-field="customer"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Installateur</span>
            <input
              .value=${this.installer}
              data-field="installer"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Bedrijf</span>
            <input
              .value=${this.company}
              data-field="company"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Straat</span>
            <input
              .value=${this.street}
              data-field="street"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Nummer</span>
            <input
              .value=${this.houseNumber}
              data-field="houseNumber"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Postcode</span>
            <input
              .value=${this.postalCode}
              data-field="postalCode"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>Gemeente</span>
            <input
              .value=${this.city}
              data-field="city"
              @input=${this.#onMetaInput} />
          </label>
          <label>
            <span>BTW / KBO installateur</span>
            <input
              .value=${this.installerBtw}
              data-field="installerBtw"
              @input=${this.#onMetaInput}
              placeholder="BE 0xxx.xxx.xxx" />
          </label>
          <label>
            <span>EAN-code (18 cijfers)</span>
            <input
              .value=${this.eanCode}
              data-field="eanCode"
              @input=${this.#onMetaInput}
              placeholder="541448860000000000" />
          </label>
          <label>
            <span>Hoofdzekering (A)</span>
            <input
              type="number"
              min="0"
              step="1"
              .value=${this.mainFuseA > 0 ? String(this.mainFuseA) : ''}
              data-field="mainFuseA"
              @input=${this.#onMetaInput}
              placeholder="40" />
          </label>
        </div>
        <div class="footer">
          <button
            type="button"
            @click=${this.#close}>
            Annuleren
          </button>
          <button
            type="button"
            class="primary"
            @click=${this.#save}>
            Opslaan
          </button>
        </div>
      </div>
    `
  }
}
