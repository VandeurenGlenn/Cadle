import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import styles from './settings.css' with { type: 'css' }
import pubsub from '../pubsub.js'
import {
  chooseBackupDirectory,
  downloadProjectBackup,
  forgetBackupDirectory,
  getBackupDirectory,
  parseProjectBackup,
  readLastBackupAt,
  restoreProjectBackup,
  writeBackupToDirectory,
  type DirectoryHandleLike
} from '../data/project-backup.js'
import {
  backupToGoogleDrive,
  connectGoogleDrive,
  disconnectGoogleDrive,
  googleDriveIsConfigured,
  googleDriveWasConnected
} from '../data/google-drive-backup.js'
import {
  DEFAULT_SYMBOL_STROKE_WIDTH,
  normalizeSymbolStrokeWidth,
  readSymbolStrokeWidth
} from '../preferences/symbol-stroke-width.js'

@customElement('settings-field')
export class SettingsField extends LiteElement {
  static styles = [styles]
  #symbolStrokeWidth = DEFAULT_SYMBOL_STROKE_WIDTH
  #directory?: DirectoryHandleLike
  #busy = false
  #message = ''
  #error = false
  #lastBackup: Date | null = null
  #driveConnected = false
  #driveConfigured = false

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    this.#symbolStrokeWidth = readSymbolStrokeWidth()
    this.#lastBackup = readLastBackupAt()
    this.#driveConnected = googleDriveWasConnected()
    this.#driveConfigured = googleDriveIsConfigured()
    try {
      this.#directory = await getBackupDirectory()
    } catch {
      // IndexedDB or stored file handles may be unavailable in privacy mode.
    }
    this.requestRender()
  }

  #onStrokeWidthChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    const value = Number(target.value)
    if (!Number.isFinite(value)) return
    this.#symbolStrokeWidth = normalizeSymbolStrokeWidth(value)
    pubsub.publish('native.symbol-stroke-width.update', this.#symbolStrokeWidth)
  }

  #run = async (action: () => Promise<string>) => {
    this.#busy = true
    this.#message = ''
    this.#error = false
    this.requestRender()
    try {
      this.#message = await action()
      this.#lastBackup = readLastBackupAt()
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        this.#error = true
        this.#message = error instanceof Error ? error.message : 'De back-upactie is mislukt.'
      }
    } finally {
      this.#busy = false
      this.requestRender()
    }
  }

  #connectDirectory = () => this.#run(async () => {
    this.#directory = await chooseBackupDirectory()
    await writeBackupToDirectory(this.#directory)
    return `Map “${this.#directory.name}” is gekoppeld en de eerste back-up is opgeslagen.`
  })

  #backupNow = () => this.#run(async () => {
    if (!this.#directory) throw new Error('Koppel eerst een back-upmap.')
    await writeBackupToDirectory(this.#directory)
    return `Back-up bijgewerkt in “${this.#directory.name}”.`
  })

  #disconnectDirectory = () => this.#run(async () => {
    await forgetBackupDirectory()
    this.#directory = undefined
    return 'De back-upmap is losgekoppeld. Bestaande bestanden zijn niet verwijderd.'
  })

  #download = () => this.#run(async () => {
    const backup = await downloadProjectBackup()
    return `${backup.projects.length} project${backup.projects.length === 1 ? '' : 'en'} geëxporteerd.`
  })

  #connectDrive = () => this.#run(async () => {
    const backup = await connectGoogleDrive()
    this.#driveConnected = true
    return `Google Drive is gekoppeld. ${backup.projects.length} project${backup.projects.length === 1 ? '' : 'en'} opgeslagen.`
  })

  #backupDrive = () => this.#run(async () => {
    const backup = await backupToGoogleDrive()
    this.#driveConnected = true
    return `Google Drive-back-up bijgewerkt met ${backup.projects.length} project${backup.projects.length === 1 ? '' : 'en'}.`
  })

  #disconnectDrive = () => this.#run(async () => {
    await disconnectGoogleDrive()
    this.#driveConnected = false
    return 'Google Drive is losgekoppeld. De bestaande back-up blijft in Drive staan.'
  })

  #restore = (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    void this.#run(async () => {
      const backup = parseProjectBackup(JSON.parse(await file.text()))
      const confirmed = globalThis.confirm(`Deze back-up bevat ${backup.projects.length} project${backup.projects.length === 1 ? '' : 'en'}. Projecten met hetzelfde ID worden vervangen. Doorgaan?`)
      if (!confirmed) return 'Herstellen geannuleerd.'
      const count = await restoreProjectBackup(backup)
      globalThis.cadleShell.projects = await (await import('../api/project.js')).getProjects()
      return `${count} project${count === 1 ? '' : 'en'} hersteld.`
    })
    input.value = ''
  }

  #lastBackupLabel() {
    if (!this.#lastBackup) return 'Nog geen back-up gemaakt'
    return `Laatste back-up: ${new Intl.DateTimeFormat('nl-BE', { dateStyle: 'medium', timeStyle: 'short' }).format(this.#lastBackup)}`
  }

  render() {
    return html`
      <div class="settings-shell">
        <button class="back-button" @click=${() => history.back()} aria-label="Terug naar het vorige scherm">← Terug</button>
        <h1>Instellingen</h1>
        <p class="lead">Beheer de weergave en houd een extra kopie van al je Cadle-projecten bij.</p>
        <section class="section" aria-labelledby="backup-title">
          <div class="section-heading"><h2 id="backup-title">Back-up</h2><span>${this.#lastBackupLabel()}</span></div>
          <div class="card">
            <div class="setting-row">
              <div class="provider-logo drive-logo" aria-hidden="true">G</div>
              <div class="setting-copy">
                <strong>Google Drive</strong>
                <span>${this.#driveConnected ? 'Rechtstreeks gekoppeld met Google Drive' : this.#driveConfigured ? 'Bewaar de back-up rechtstreeks in je Drive, zonder desktop-app.' : 'OAuth Client ID ontbreekt in de Cadle-configuratie.'}</span>
              </div>
              <div class="actions">
                ${this.#driveConnected
                  ? html`<button class="primary" ?disabled=${this.#busy} @click=${this.#backupDrive}>Nu back-uppen</button><button class="danger" ?disabled=${this.#busy} @click=${this.#disconnectDrive}>Loskoppelen</button>`
                  : html`<button class="primary" ?disabled=${this.#busy || !this.#driveConfigured} @click=${this.#connectDrive}>Koppelen met Drive</button>`}
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-copy">
                <strong>Cloud- of lokale map</strong>
                <span>${this.#directory ? `Gekoppeld met “${this.#directory.name}”` : 'Kies een map die door je cloud-app wordt gesynchroniseerd.'}</span>
                <div class="provider-list" aria-label="Ondersteunde synchronisatiemappen"><span class="provider">OneDrive</span><span class="provider">Dropbox</span><span class="provider">Lokale map</span></div>
              </div>
              <div class="actions">
                ${this.#directory
                  ? html`<button class="primary" ?disabled=${this.#busy} @click=${this.#backupNow}>Nu back-uppen</button><button class="danger" ?disabled=${this.#busy} @click=${this.#disconnectDirectory}>Loskoppelen</button>`
                  : html`<button class="primary" ?disabled=${this.#busy} @click=${this.#connectDirectory}>Map koppelen</button>`}
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-copy"><strong>Back-upbestand</strong><span>Download alle projecten of herstel ze op een ander apparaat.</span></div>
              <div class="actions">
                <button ?disabled=${this.#busy} @click=${this.#download}>Alles downloaden</button>
                <button ?disabled=${this.#busy} @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#restore-file')?.click()}>Back-up herstellen</button>
                <input id="restore-file" type="file" accept="application/json,.json" @change=${this.#restore} />
              </div>
            </div>
          </div>
          <p class="hint">Cadle schrijft één bestand, <code>cadle-backup.json</code>, in de gekozen map. Je cloud-app verzorgt daarna de synchronisatie.</p>
          <p class="message" data-error=${String(this.#error)} role="status">${this.#message}</p>
        </section>
        <section class="section" aria-labelledby="display-title">
          <div class="section-heading"><h2 id="display-title">Weergave</h2></div>
          <div class="card"><label class="setting-row"><div class="setting-copy"><strong>Lijndikte symbolen</strong><span>Pas de visuele lijndikte in tekeningen aan.</span></div><input type="range" min="0.1" max="3" step="0.1" value=${this.#symbolStrokeWidth} @change=${this.#onStrokeWidthChange} /><output>${this.#symbolStrokeWidth.toFixed(2)}</output></label></div>
        </section>
      </div>
    `
  }
}
