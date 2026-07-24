import { LiteElement, html, property, customElement, query } from '@vandeurenglenn/lite'
import { shellStyles } from './shell/styles.js'
import { parseHash } from './shell/routing.js'
import { PresenceController } from './shell/presence.js'
import './elements/design-mode-toggle.js'
import { iconSetTemplate } from './shell/icon-set.js'
import {
  ensureCustomCatalogLoaded,
  getStoredCustomSymbols,
  setStoredCustomSymbols,
  getCustomCatalogSections
} from './shell/custom-symbols.js'
import '@material/web/dialog/dialog.js'
import '@material/web/button/filled-tonal-button.js'
import '@material/web/button/text-button.js'
import '@material/web/button/filled-button.js'
import '@material/web/checkbox/checkbox.js'
import '@material/web/progress/circular-progress.js'
import '@material/web/iconbutton/icon-button.js'
import '@material/web/list/list.js'
import '@material/web/list/list-item.js'
import '@vandeurenglenn/lite-elements/pages.js'
import './app.js'
import './elements/panes/project-pane.js'
import './elements/panes/object-pane.js'
import './elements/pdf-importer.js'
import './elements/header.js'
import './elements/status-bar.js'
import './elements/actions/actions.js'
import pubsub from './pubsub.js'
import './elements/modals/validation-report.js'
import type { ValidationReport } from './elements/modals/validation-report.js'
import './elements/modals/template-library.js'
import './elements/modals/project-details-dialog.js'
import './elements/panels/history-panel.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/outlined-button.js'
import '@material/web/icon/icon.js'
import '@vandeurenglenn/lite-elements/icon-set.js'
import '@vandeurenglenn/lite-elements/icon.js'
import state from './state.js'
import { Color } from './symbols/default-options.js'
import './elements/actions/project-actions.js'
import './elements/actions/onewire-actions.js'
import { Project, type Projects, type UUID, type Catalog, type JsonValue } from './types.js'
import { addPage, getProjectData, getProjects, projectStore, setProjectData } from './api/project.js'
import { circuitTemplates } from './templates/circuit-templates.js'
import { type BomRow, type CircuitAnalysis } from './native-app/circuit-analysis.js'
import { ensureOneWirePage } from './shell/page-operations.js'
import { clonePageSchema } from './shell/page-schema.js'
import { downloadBom, downloadDataUrl } from './shell/export-commands.js'

type A4Orientation = 'portrait' | 'landscape'
type A4ExportResult = {
  dataUrl: string
  orientation: A4Orientation
  widthPx: number
  heightPx: number
}

type ShellActionsElement = HTMLElement & {
  hide: () => void
  show: () => void
  fill?: string
}

type ShellProjectPaneElement = HTMLElement & {
  select?: (view: 'project' | 'symbols') => void
}

type ShellPagesElement = HTMLElement & {
  select?: (route: string) => Promise<void> | void
}

type NativeAppElement = HTMLElement & {
  undo?: () => void
  redo?: () => void
  exportA4PNG?: (orientation?: A4Orientation | 'auto') => Promise<A4ExportResult>
  analyzeBindings?: () => CircuitAnalysis
  getBOMRows?: () => BomRow[]
  generateAutoOneWire?: () => { generated: boolean; circuitCount: number; message?: string }
  waitForPageReady?: (pageKey: string) => Promise<boolean>
  flushPendingSave?: () => Promise<void>
}

type ShellProjectStore = {
  set: (key: Uint8Array, value: unknown) => Promise<void>
  get: (key: string) => Promise<Project>
}

type KeyboardShortcutsElement = HTMLElement & {
  open?: boolean
}

type PickerDialogElement = HTMLElement & {
  open?: boolean
}

type LooseElement = HTMLElement & Record<string, string | undefined>

// All decorators and base class now from @vandeurenglenn/lite
declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell
  }
  var cadleShell: AppShell
}
declare type dialogAction =
  | 'create-project'
  | 'open-project'
  | 'create-page'
  | 'rename-project'
  | 'rename-page'
  | 'confirm-input'
  | 'clone-page'
@customElement('app-shell')
export class AppShell extends LiteElement {
  static readonly LAST_OPEN_PROJECT_KEY_STORAGE = 'cadle.lastOpenProjectKey'
  static readonly LAST_OPEN_PAGE_KEY_STORAGE = 'cadle.lastOpenPageKey'

  projectStore = projectStore
  symbol: string = ''
  @property({ attribute: false, provides: 'projectName' })
  accessor projectName: string = ''

  @property({ attribute: false, provides: 'loadedPage' })
  accessor loadedPage: string = ''

  _currentColor: string = ''

  get projectLoaded(): boolean {
    return Boolean(this.projectKey && this.project?.uuid)
  }

  get currentProjectName(): string {
    return this.project?.name ?? this.projectName
  }

  get currentPageKey(): string {
    return this.loadedPage
  }

  get currentPage() {
    return this.loadedPage ? this.project?.pages?.[this.loadedPage] : undefined
  }

  get currentPageName(): string {
    return this.currentPage?.name ?? ''
  }

  get currentPageSchema() {
    return this.currentPage?.schema
  }

  get projectPages() {
    return this.project?.pages ?? {}
  }

  get projectPageEntries() {
    return Object.entries(this.projectPages)
  }

  get projectPageCount(): number {
    return Object.keys(this.projectPages).length
  }

  @query('cadle-actions')
  accessor actions!: ShellActionsElement

  @query('project-pane')
  accessor projectPane!: ShellProjectPaneElement

  @query('custom-pages')
  accessor pages!: ShellPagesElement

  @property({ type: Object })
  accessor manifest: Record<string, JsonValue> = {}

  @property({ type: Boolean })
  accessor validationReportOpen = false

  @property({ attribute: false })
  accessor validationReportData: ValidationReport | null = null

  @property({ type: Boolean })
  accessor historyPanelOpen = false

  @property({ type: Array })
  accessor historyEntries: Array<{ id: string; label: string; timestamp: number }> = []

  @property({ type: Boolean })
  accessor projectDirty = false

  @property({ type: Boolean })
  accessor templateLibraryOpen = false

  @property({ type: Boolean })
  accessor projectDetailsDialogOpen = false

  _freeDraw: boolean = false
  set freeDraw(value: boolean) {
    const next = !!value
    if (this._freeDraw === next) return
    this._freeDraw = next
    state.freeDraw = next
    pubsub.publish('shell.snap', !next)
  }

  get freeDraw(): boolean {
    return this._freeDraw
  }

  onChange(property: string) {
    if (property === 'project') {
      if (this.project) {
        this.railView = 'project'
      }
    }
  }

  _showMeasurements = false
  @property({ type: String })
  accessor railView: 'project' | 'symbols' = 'symbols'

  #selectRailView = (view: 'project' | 'symbols') => {
    this.railView = view
    this.projectPane?.select?.(view)
  }

  set showMeasurements(value) {
    this._showMeasurements = value
    pubsub.publish('shell.measurements', !!value)
  }

  get showMeasurements() {
    return this._showMeasurements
  }

  _action: string = ''
  @property({ attribute: false, provides: 'projectKey' })
  accessor projectKey: UUID = '' as UUID

  set action(value) {
    this._action = value
    pubsub.publish('shell.action', value ?? '')
  }

  get action(): string {
    return this._action
  }

  @property({ attribute: false, provides: 'projects' })
  accessor projects: Projects = []

  @property({ attribute: false, provides: 'project' })
  accessor project: Project = {} as Project

  @property({ attribute: false, provides: 'catalog' })
  accessor catalog: Catalog = []

  @property({ type: Boolean })
  accessor showReopenPreviousProjectPrompt = false

  @property({ type: String })
  accessor previousProjectName = ''

  @property({ type: String })
  accessor previousProjectKey = ''

  @property({ type: String })
  accessor previousPageKey = ''

  _baseCatalog: Catalog = []
  private readonly _presenceName =
    localStorage.getItem('cadle.presenceName') ?? `User ${Math.random().toString(36).slice(2, 6)}`

  private readonly _presenceColor =
    localStorage.getItem('cadle.presenceColor') ??
    ['#a85427', '#1f6a38', '#6d4d8a', '#c44d56', '#0077b6'][Math.floor(Math.random() * 5)]

  private _presence = new PresenceController(this._presenceName, this._presenceColor, () => this.#syncRemotePresence())
  constructor() {
    super()
    globalThis.cadleShell = this
    localStorage.setItem('cadle.presenceName', this._presenceName)
    localStorage.setItem('cadle.presenceColor', this._presenceColor)
  }

  #captureReloadResumeFromHash() {
    const { route, params } = parseHash(location.hash)
    const isNativeRoute = route === 'native-draw' || route === 'draw' || route === 'save'
    const resumeProject = params?.project || localStorage.getItem(AppShell.LAST_OPEN_PROJECT_KEY_STORAGE) || ''
    const resumePage = params?.page || localStorage.getItem(AppShell.LAST_OPEN_PAGE_KEY_STORAGE) || ''
    if (!isNativeRoute || !resumeProject) return

    this.previousProjectKey = resumeProject
    this.previousPageKey = resumePage
    const projectEntry = this.projects.find(([key]) => key === resumeProject)
    this.previousProjectName = projectEntry?.[1] ?? 'Previous project'
    this.showReopenPreviousProjectPrompt = true
    pubsub.publish('shell.reopen-previous-project-prompt', {
      open: true,
      projectName: this.previousProjectName
    })
    this.railView = 'project'
    location.hash = '#!/projects'
  }

  #dismissReopenPreviousProjectPrompt = () => {
    this.showReopenPreviousProjectPrompt = false
    pubsub.publish('shell.reopen-previous-project-prompt', { open: false, projectName: '' })
  }

  #openPreviousProjectFromPrompt = async () => {
    const key = this.previousProjectKey as UUID
    if (!key) return

    await this.savePage()
    this.project = await getProjectData(key)
    this.projectKey = key

    const targetPage =
      (this.previousPageKey && this.project.pages?.[this.previousPageKey] ? this.previousPageKey : '') ||
      Object.keys(this.project.pages ?? {})[0] ||
      ''

    if (targetPage) {
      await this.loadPage(targetPage)
      location.hash = this.#nativeDrawHash()
    }

    this.railView = 'project'
    this.projectPane?.select?.('project')
    this.showReopenPreviousProjectPrompt = false
    pubsub.publish('shell.reopen-previous-project-prompt', { open: false, projectName: '' })
  }

  dismissReopenPreviousProjectPrompt() {
    this.#dismissReopenPreviousProjectPrompt()
  }

  async openPreviousProjectFromPrompt() {
    await this.#openPreviousProjectFromPrompt()
  }

  openProjectDetailsDialog() {
    if (!this.projectKey || !this.project) return
    this.projectDetailsDialogOpen = true
  }

  #mergeCatalogWithBoundSymbols(
    boundSymbols: Catalog[number]['symbols'],
    groupSymbols: Catalog[number]['symbols'] = []
  ) {
    const baseCatalog = this._baseCatalog ?? []
    const nextCatalog = [...baseCatalog]
    const customSections = getCustomCatalogSections()
    if (customSections.length > 0) {
      nextCatalog.unshift(...customSections)
    }

    if (boundSymbols.length > 0) {
      nextCatalog.unshift({
        category: 'Bound Situation Elements',
        symbols: boundSymbols
      })
    }

    if (groupSymbols.length > 0) {
      nextCatalog.unshift({
        category: 'Bindings',
        symbols: groupSymbols
      })
    }
    return nextCatalog
  }

  #refreshBoundOneLineCatalog = () => {
    this.catalog = this.#mergeCatalogWithBoundSymbols([])
  }

  #updateHistoryEntries = (event: Event) => {
    const customEvent = event as CustomEvent<{ entries?: Array<{ id: string; label: string; timestamp: number }> }>
    this.historyEntries = customEvent.detail?.entries ?? []
  }

  #onCanvasHistoryUpdated = () => {
    if (!this.project || !this.projectKey || !this.loadedPage) return
    this.projectDirty = true
    pubsub.publish('project.modified', { projectKey: this.projectKey, pageKey: this.loadedPage })
  }

  #syncRemotePresence() {
    this._presence.activeCursors(this.projectKey, this.loadedPage)
  }

  #broadcastPresence(position?: { x: number; y: number }, hidden = false) {
    this._presence.broadcast(this.projectKey, this.loadedPage, position, hidden)
  }

  #focusBindingGroup(bindingId: string) {
    const targetId = bindingId.trim().toUpperCase()
    if (!targetId) return
    pubsub.publish('native.binding.focus', { bindingId: targetId })
    location.hash = this.#nativeDrawHash()
  }

  toggleHistoryPanel = () => {
    this.historyPanelOpen = !this.historyPanelOpen
  }

  openTemplateLibrary = () => {
    this.templateLibraryOpen = true
  }

  openCustomSymbolImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.svg,image/svg+xml'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (file) await this.importCustomSymbolFile(file)
    })
    input.click()
  }

  async importCustomSymbolFile(file: File) {
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')
    if (!isSvg) {
      globalThis.alert('Only SVG files can be imported as custom symbols.')
      return
    }

    const markup = await file.text()
    const fallbackName = file.name.replace(/\.svg$/i, '')
    const name = globalThis.prompt('Symbol name', fallbackName)?.trim()
    if (!name) return
    const folder = globalThis.prompt('Catalog folder (optional)', '')?.trim() || undefined
    const category = globalThis.prompt('Catalog category', 'My Symbols')?.trim() || 'My Symbols'
    const bindingRole = (globalThis.prompt('Binding role (switch, load, neutral)', 'neutral')?.trim().toLowerCase() ||
      'neutral') as 'switch' | 'load' | 'neutral'
    const situationElementType = globalThis.prompt('Situation element type (optional)', '')?.trim() || undefined
    const path = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    const symbols = getStoredCustomSymbols()
    symbols.push({
      folder,
      category,
      name,
      path,
      metadata: {
        bindingRole,
        situationElementType,
        customSymbol: true,
        importedAt: Date.now()
      }
    })
    await setStoredCustomSymbols(symbols)
    this.#refreshBoundOneLineCatalog()
  }

  async loadTemplate(templateId: string) {
    if (!this.project || !this.projectKey) {
      globalThis.alert('Create or open a project before loading a template.')
      return
    }

    await this.savePage()
    const template = circuitTemplates.find((entry) => entry.id === templateId)
    if (!template) return
    const pageKey = crypto.randomUUID()
    const existingNames = new Set(Object.values(this.project.pages).map((page) => page.name))
    let pageName = template.pageName
    let suffix = 2
    while (existingNames.has(pageName)) {
      pageName = `${template.pageName} ${suffix}`
      suffix += 1
    }

    this.project.pages[pageKey] = {
      creationTime: Date.now(),
      name: pageName,
      schema: structuredClone(template.schema)
    }
    await setProjectData(this.projectKey, this.project)
    await this.loadPage(pageKey)
    this.templateLibraryOpen = false
    location.hash = this.#nativeDrawHash()
  }

  #onBindingLookupUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<{
      symbols?: Catalog[number]['symbols']
      groupSymbols?: Catalog[number]['symbols']
    }>
    const symbols = customEvent.detail?.symbols ?? []
    const groupSymbols = customEvent.detail?.groupSymbols ?? []
    this.catalog = this.#mergeCatalogWithBoundSymbols(symbols, groupSymbols)
  }

  #onCatalogStructureUpdated = () => {
    this.#refreshBoundOneLineCatalog()
  }

  #registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return

    try {
      await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' })
    } catch (error) {
      console.warn('Failed to register service worker', error)
    }
  }

  async connectedCallback(): Promise<void> {
    if (super.connectedCallback) await super.connectedCallback()
    // const entries = await this.projectStore.entries()
    // for (const [key, value] of entries) {
    //   this.projectStore.set(globalThis.crypto.randomUUID(), { ...value, name: key })
    // }
    try {
      const projectsArray = await getProjects()
      this.projects = projectsArray
    } catch (error) {
      console.error(error)
      this.projects = []
    }

    // for (const key of keys) {
    //   projects.push(typeof key === 'string' ? key : decoder.decode(key))
    // }
    await import('./elements/actions/actions.js')
    void this.#registerServiceWorker()
    await ensureCustomCatalogLoaded()
    try {
      const manifestCandidates = [
        new URL('./symbols/manifest.js', location.href).toString(),
        `${location.origin}/symbols/manifest.js`,
        `${location.origin}/www/symbols/manifest.js`
      ]
      let loadedCatalog: Catalog | null = null
      for (const candidate of manifestCandidates) {
        try {
          loadedCatalog = (await import(candidate)).default as Catalog
          if (Array.isArray(loadedCatalog)) break
        } catch {
          // Try next candidate path.
        }
      }

      if (!Array.isArray(loadedCatalog)) {
        throw new Error('Unable to resolve symbols manifest from any candidate path')
      }

      this._baseCatalog = loadedCatalog
      this.catalog = this.#mergeCatalogWithBoundSymbols([])
    } catch (error) {
      console.error('Failed to load symbols manifest', error)
      this._baseCatalog = []
      this.catalog = []
    }

    // No requestUpdate in Lite; rely on reactive property
    // addEventListener('beforeprint', this.#beforePrint)
    // addEventListener('afterprint', this.#afterPrint)
    // No updateComplete in Lite; rely on property updates
    // Presence is same-browser until an authenticated, maintained remote
    // transport is configured explicitly.
    if ('BroadcastChannel' in globalThis) {
      this._presence.connect()
    }

    onhashchange = this.#onhashchange.bind(this)
    this.#captureReloadResumeFromHash()
    if (this.showReopenPreviousProjectPrompt) {
      pubsub.publish('shell.reopen-previous-project-prompt', {
        open: true,
        projectName: this.previousProjectName
      })
    }
    this.#onhashchange()
    this.addEventListener('drop', this.#drop.bind(this))
    this.addEventListener('dragover', this.#dragover.bind(this))
    this.addEventListener('binding-lookup-updated', this.#onBindingLookupUpdated as EventListener)
    this.addEventListener('catalog-structure-updated', this.#onCatalogStructureUpdated as EventListener)
    this.addEventListener('canvas-history-updated', this.#updateHistoryEntries as EventListener)
    this.addEventListener('canvas-history-updated', this.#onCanvasHistoryUpdated as EventListener)
    this.addEventListener('presence-pointer', ((event: CustomEvent<{ x: number; y: number }>) => {
      this.#broadcastPresence({ x: event.detail.x, y: event.detail.y })
    }) as EventListener)
    this.addEventListener('presence-pointer-leave', (() => {
      this.#broadcastPresence(undefined, true)
    }) as EventListener)
    // this.addEventListener('mousedown', () => {
    //   const target = this.shadowRoot.querySelector('[open]')
    //   if (target) target.open = false
    // })
    // No updateComplete in Lite; rely on property updates
    console.log(this.dialog)
    this.dialog?.addEventListener('close', this.#dialogAction)
  }

  disconnectedCallback(): void {
    this.#broadcastPresence(undefined, true)
    this._presence.disconnect()
    if (super.disconnectedCallback) super.disconnectedCallback()
  }

  #dragover(event: DragEvent) {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  #drop(event: DragEvent) {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    const svgFiles = files.filter((file) => file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg'))
    if (svgFiles.length === 0) {
      console.log(event)
      return
    }

    svgFiles.forEach((file) => {
      void this.importCustomSymbolFile(file)
    })
  }

  #onhashchange = async () => {
    const { route, params } = parseHash(location.hash)
    const validRoutes = new Set(['home', 'native-draw', 'projects', 'add-page', 'create-project', 'settings'])
    const fallbackRoute = this.project?.pages ? 'native-draw' : 'projects'
    const nextRoute =
      route === 'draw' || route === 'save' ? 'native-draw' : validRoutes.has(route) ? route : fallbackRoute
    if (nextRoute !== 'native-draw' && !customElements.get(`${nextRoute}-field`)) {
      try {
        await import(`./${nextRoute}.js`)
      } catch (error) {
        console.error(`Failed loading route module for "${nextRoute}"`, error)
        return
      }
    }

    await this.pages?.select?.(nextRoute)
    if (!validRoutes.has(route) && location.hash !== `#!/${nextRoute}`) {
      location.hash = `#!/${nextRoute}`
    }

    if (params) {
      const customPages = this.shadowRoot?.querySelector('custom-pages')
      const selected = customPages?.querySelector('.custom-selected') as LooseElement | null
      if (selected) {
        for (const [key, value] of Object.entries(params)) {
          selected[key] = value
        }
      }
    }
  }

  get dialog() {
    return this.shadowRoot?.querySelector('md-dialog') ?? this.querySelector('md-dialog')
  }

  #nativeDrawHash() {
    if (this.projectKey && this.loadedPage) {
      return `#!/native-draw?project=${this.projectKey}&page=${this.loadedPage}`
    }
    return '#!/native-draw'
  }

  #dialogAction = async (event: Event) => {
    console.log(event.returnValue)
    console.log(event)
    console.log(event.returnValue)
    const dialog = this.dialog
    if (!dialog) return
    const action: dialogAction = dialog.returnValue as dialogAction
    const projectKey = dialog.dataset?.key
    console.log(action)
    if (action === 'confirm-input') {
      const textField = dialog.querySelector('md-filled-text-field') as unknown as HTMLInputElement | null
      const value = textField?.value ?? ''
      state.text.current = value
      const match = value.match(/\d+/g)
      if (match && match.length > 0) {
        const number = Number(match.join(''))
        state.text.lastNumber = number
      }
    }

    if (action === 'create-project') {
      await cadleShell.savePage()
      const textField = cadleShell.dialog?.querySelector('md-filled-text-field') as unknown as HTMLInputElement | null
      cadleShell.projectName = textField?.value ?? ''
      if (cadleShell.projectStore && 'set' in cadleShell.projectStore) {
        const store = cadleShell.projectStore as unknown as ShellProjectStore
        await store.set(new TextEncoder().encode(cadleShell.projectName), {
          creationTime: new Date().getTime(),
          pages: []
        })
      }

      const projects = cadleShell.projects
      cadleShell.projects = [...projects, [cadleShell.projectName, cadleShell.projectName]] as Projects
      const store = cadleShell.projectStore as unknown as ShellProjectStore
      cadleShell.project = await store.get(cadleShell.projectName)
      const firstKey = Object.keys(cadleShell.project.pages)[0]
      if (firstKey) await cadleShell.loadPage(firstKey)
      location.hash = this.#nativeDrawHash()
    }

    if (action === 'open-project' && projectKey) {
      console.log(projectKey)
      await this.savePage()
      this.project = await getProjectData(projectKey as UUID)
      this.projectKey = projectKey as UUID
      console.log(this.project)
      const keys = Object.keys(this.project.pages)
      if (keys[0]) await this.loadPage(keys[0])
      location.hash = this.#nativeDrawHash()
      this.projectPane?.select?.('project')
    }

    if (action === 'clone-page') {
      const pageKey = dialog.dataset?.pageKey
      if (!pageKey) return
      const page = this.project.pages[pageKey]
      if (!page) return
      const includeWalls = (dialog.querySelector('#clone-walls') as HTMLInputElement | null)?.checked ?? false
      const outsideWalls = (dialog.querySelector('#clone-outside-walls') as HTMLInputElement | null)?.checked ?? false
      const includeOpenings = (dialog.querySelector('#clone-openings') as HTMLInputElement | null)?.checked ?? false
      const includeElectrical =
        (dialog.querySelector('#clone-switches-loads') as HTMLInputElement | null)?.checked ?? false
      const pageNameField = dialog.querySelector('#clone-page-name') as HTMLInputElement | null
      const newPageName = pageNameField?.value?.trim() || `${page.name} copy`
      const clonedSchema = clonePageSchema(page.schema, {
        includeWalls: includeWalls || outsideWalls,
        outsideWallsOnly: outsideWalls,
        includeOpenings,
        includeElectrical
      })
      await addPage(this.projectKey, newPageName, clonedSchema, page.pageType ?? 'groundplan')
      this.project = await getProjectData(this.projectKey)
    }

    if (action === 'rename-page') {
      const pageKey = dialog.dataset?.pageKey
      if (!pageKey) return
      const pageNameField = dialog.querySelector('#rename-page-name') as HTMLInputElement | null
      const newPageName = pageNameField?.value?.trim() || ''
      if (!newPageName) return
      const page = this.project.pages?.[pageKey]
      if (!page) return
      page.name = newPageName
      await setProjectData(this.projectKey, this.project)
      this.project = await getProjectData(this.projectKey)
    }
  }

  async openClonePageDialog(pageKey: string) {
    const page = this.project.pages?.[pageKey]
    if (!page) return
    const dialog = this.dialog
    if (!dialog) return
    dialog.dataset.action = 'clone-page'
    dialog.dataset.pageKey = pageKey
    const defaultName = `${page.name} copy`.replace(/"/g, '')
    dialog.innerHTML = `
      <form id="clone-page" slot="content" method="dialog">
        <flex-column style="gap: 1rem;">
          <p>Clone "${page.name}" into a new page</p>
          <label style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" id="clone-walls" checked />
            <span>Clone walls only</span>
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" id="clone-outside-walls" />
            <span>Only outside walls</span>
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" id="clone-openings" />
            <span>Include doors, windows & gates</span>
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" id="clone-switches-loads" />
            <span>Include switches and loads</span>
          </label>
          <label style="display: flex; flex-direction: column; gap: 0.25rem;">
            <span>New page name</span>
            <md-filled-text-field id="clone-page-name" value="${defaultName}"></md-filled-text-field>
          </label>
        </flex-column>
      </form>
      <flex-row slot="actions" style="width: 100%;">
        <md-outlined-button form="clone-page" value="cancel-clone-page">
          cancel
        </md-outlined-button>
        <flex-it></flex-it>
        <md-filled-button form="clone-page" value="clone-page">
          clone
        </md-filled-button>
      </flex-row>
    `
    dialog.open = true
  }

  async openRenamePageDialog(pageKey: string) {
    const page = this.project.pages?.[pageKey]
    if (!page) return
    const dialog = this.dialog
    if (!dialog) return
    dialog.dataset.action = 'rename-page'
    dialog.dataset.pageKey = pageKey
    const defaultName = page.name.replace(/"/g, '')
    dialog.innerHTML = `
      <form id="rename-page" slot="content" method="dialog">
        <flex-column style="gap: 1rem;">
          <p>Rename page</p>
          <label style="display: flex; flex-direction: column; gap: 0.25rem;">
            <span>Page name</span>
            <md-filled-text-field id="rename-page-name" value="${defaultName}"></md-filled-text-field>
          </label>
        </flex-column>
      </form>
      <flex-row slot="actions" style="width: 100%;">
        <md-outlined-button form="rename-page" value="cancel-rename-page">
          cancel
        </md-outlined-button>
        <flex-it></flex-it>
        <md-filled-button form="rename-page" value="rename-page">
          rename
        </md-filled-button>
      </flex-row>
    `
    dialog.open = true
  }

  async loadProject(projectKey: UUID, projectName: string) {
    this.dialog?.addEventListener('close', this.#dialogAction)
    console.log(projectKey, projectName)
    const dialog = cadleShell.dialog
    if (!dialog) return
    dialog.dataset.key = projectKey
    dialog.innerHTML = `
      <form id="load" slot="content" method="dialog">  
        <flex-column>
          <p>Are you sure you want to open ${projectName}?</p>
          <small>make sure you saved your open project</small>
        </flex-column>
      </form>
      <flex-row slot="actions" style="width: 100%;">
        <md-outlined-button form="load" value="cancel-open-project">
          cancel
        </md-outlined-button>
        <flex-it></flex-it>
        <md-filled-button form="load" value="open-project">
          open
        </md-filled-button>
      </flex-row>
    
    `
    if (cadleShell.dialog) cadleShell.dialog.open = true
  }

  async exportA4PNG(orientation: A4Orientation | 'auto' = 'auto'): Promise<A4ExportResult> {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    if (!nativeApp?.exportA4PNG) throw new Error('Native draw export is unavailable')
    return nativeApp.exportA4PNG(orientation)
  }

  async toPNG() {
    const exported = await this.exportA4PNG('landscape')
    return exported.dataUrl
  }

  async downloadAsPNG(name: string) {
    const dataUrl = await this.toPNG()
    downloadDataUrl(dataUrl, `${this.projectName}-${name}.png`)
  }

  get drawer() {
    return this.shadowRoot?.querySelector('.left-rail') ?? this.querySelector('.left-rail')
  }

  async savePage() {
    this.projectDirty = false
  }

  async loadPage(key: string) {
    this.loadedPage = key
    const page = this.project.pages[key]
    console.log({ page, key })

    if (this.projectKey) {
      localStorage.setItem(AppShell.LAST_OPEN_PROJECT_KEY_STORAGE, this.projectKey)
      localStorage.setItem(AppShell.LAST_OPEN_PAGE_KEY_STORAGE, key)
    }

    location.hash = `#!/native-draw?project=${this.projectKey}&page=${key}`
    this.projectDirty = false
    this.#syncRemotePresence()
    this.#refreshBoundOneLineCatalog()

    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    if (nativeApp?.waitForPageReady) {
      await nativeApp.waitForPageReady(key)
      return
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }

  async generateAutoOneWireSchema() {
    if (!this.projectKey) {
      globalThis.alert('Create or open a project before generating a one-wire plan.')
      return
    }

    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    try {
      await nativeApp?.flushPendingSave?.()
    } catch {
      globalThis.alert('The floor plan could not be saved. One-wire generation was cancelled to protect your work.')
      return
    }
    this.project = await getProjectData(this.projectKey)

    const oneWirePage = await ensureOneWirePage(this.projectKey, this.project)
    if (!oneWirePage) return
    this.project = oneWirePage.project

    await this.loadPage(oneWirePage.pageKey)
    const pageReady = await nativeApp?.waitForPageReady?.(oneWirePage.pageKey)
    if (!pageReady) {
      globalThis.alert('The one-wire page did not finish loading. Please try again.')
      return
    }
    const result = nativeApp?.generateAutoOneWire?.()
    if (!result?.generated) globalThis.alert(result?.message ?? 'Unable to generate the one-wire diagram.')
  }

  async validateBindingsForOneWire() {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    const report = nativeApp?.analyzeBindings?.() ?? null
    this.validationReportData = report
    this.validationReportOpen = Boolean(report)
    return report
  }

  async generateBOM() {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    const rows = nativeApp?.getBOMRows?.() ?? []
    if (!downloadBom(rows, this.projectName || this.project?.name || 'cadle-project')) {
      globalThis.alert('No bound floor-plan symbols were found for the BOM.')
    }
  }

  undo() {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    nativeApp?.undo?.()
  }

  redo() {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    nativeApp?.redo?.()
  }

  importShare = () => {
    // if (this.projects)
  }

  showShortcuts = async () => {
    if (!customElements.get('keyboard-shortcuts')) await import('./screens/keyboard-shortcuts.js')
    const shortcuts = this.shadowRoot?.querySelector('keyboard-shortcuts') as KeyboardShortcutsElement | null
    if (shortcuts) shortcuts.open = true
  }

  pickColor = async (): Promise<Color> => {
    // No updateComplete or renderRoot in Lite; use shadowRoot
    return new Promise(async (resolve, reject) => {
      const picker = this.shadowRoot?.querySelector('input[type="color"]') as HTMLInputElement
      const pickerDialog = this.shadowRoot?.querySelector('.color-picker') as PickerDialogElement | null
      if (!picker || !pickerDialog) return reject('Color picker not found')
      pickerDialog.addEventListener('close', () => {
        if ((pickerDialog as unknown as { returnValue?: string }).returnValue === 'confirm-color') {
          const color = picker.value as Color
          state.styling.fill = color
          this.actions.fill = color
          this._currentColor = color
          resolve(color)
        }
      })
      pickerDialog.open = true
      picker.click()
    })
  }

  #normalizeColorInput(value: unknown): string {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase()
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw

    const shortHexMatch = raw.match(/^#([0-9a-f]{3})$/i)
    if (shortHexMatch) {
      const [r, g, b] = shortHexMatch[1].split('')
      return `#${r}${r}${g}${g}${b}${b}`
    }

    const rgbMatch = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i)
    if (rgbMatch) {
      const toHex = (channel: string) => {
        const numeric = Math.max(0, Math.min(255, Number(channel) || 0))
        return numeric.toString(16).padStart(2, '0')
      }
      return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`
    }
    return '#000000'
  }

  static styles = [shellStyles]
  deletePage(pageName: string) {
    const pages = this.project.pages as Record<string, Project['pages'][string]>
    const pageKeys = Object.keys(pages)
    for (let i = 0; i < pageKeys.length; i++) {
      const key = pageKeys[i]
      const page = pages[key]
      if (page.name === pageName) {
        delete pages[key]
        break
      }
    }
  }

  render() {
    return html`
      <md-dialog></md-dialog>
      <validation-report
        .open=${this.validationReportOpen}
        .report=${this.validationReportData}
        .projectName=${this.projectName ?? this.project?.name ?? ''}
        @close=${() => (this.validationReportOpen = false)}
        @focus-binding=${(event: CustomEvent<{ bindingId: string }>) => this.#focusBindingGroup(event.detail.bindingId)}
        @generate-one-wire=${async () => {
          this.validationReportOpen = false
          await this.generateAutoOneWireSchema()
        }}></validation-report>
      <template-library
        .open=${this.templateLibraryOpen}
        .templates=${circuitTemplates.map(({ id, name, description, category, highlights }) => ({
          id,
          name,
          description,
          category,
          highlights
        }))}
        @close=${() => (this.templateLibraryOpen = false)}
        @select-template=${async (event: CustomEvent<{ id: string }>) => {
          await this.loadTemplate(event.detail.id)
        }}></template-library>
      <project-details-dialog
        .open=${this.projectDetailsDialogOpen}
        .project=${this.project}
        .projectKey=${this.projectKey}
        @close=${() => (this.projectDetailsDialogOpen = false)}
        @saved=${(event: CustomEvent<{ project: Project; projects: Projects }>) => {
          this.project = event.detail.project
          this.projectName = event.detail.project.name
          this.projects = event.detail.projects
          this.projectDetailsDialogOpen = false
        }}></project-details-dialog>
      <history-panel
        .open=${this.historyPanelOpen}
        .entries=${this.historyEntries}
        @close=${() => (this.historyPanelOpen = false)}
        @restore-history=${async (event: CustomEvent<{ id: string }>) => {
          void event.detail.id
          location.hash = this.#nativeDrawHash()
        }}></history-panel>
      ${iconSetTemplate}
      <div class="shell-frame">
        <section class="layout">
          <aside class="left-rail">
            <cadle-header>
              <project-actions></project-actions>
            </cadle-header>
            <custom-selector
              attr-for-selected="data-selected"
              .selected=${this.railView}
              class="rail-tabs"
              role="tablist">
              <button
                class="rail-tab"
                role="tab"
                type="button"
                title="Project pages"
                aria-label="Project pages"
                data-selected="project"
                aria-selected=${this.railView === 'project'}
                @click=${() => this.#selectRailView('project')}>
                <custom-icon icon="folder"></custom-icon>
              </button>
              <button
                class="rail-tab"
                role="tab"
                type="button"
                title="Symbols catalog"
                aria-label="Symbols catalog"
                data-selected="symbols"
                aria-selected=${this.railView === 'symbols'}
                @click=${() => this.#selectRailView('symbols')}>
                <custom-icon icon="format_shapes"></custom-icon>
              </button>
            </custom-selector>
            ${this.showReopenPreviousProjectPrompt
              ? html`
                  <div class="reopen-previous-project-bubble">
                    <div class="reopen-previous-project-title">Open previous project?</div>
                    <div class="reopen-previous-project-text">${this.previousProjectName}</div>
                    <div class="reopen-previous-project-actions">
                      <button
                        class="reopen-previous-project-btn"
                        type="button"
                        @click=${this.#openPreviousProjectFromPrompt}>
                        Open
                      </button>
                      <button
                        class="reopen-previous-project-btn reopen-previous-project-btn-subtle"
                        type="button"
                        @click=${this.#dismissReopenPreviousProjectPrompt}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                `
              : ''}
            <project-pane
              .manifest=${this.manifest}
              .project=${this.project}
              .catalog=${this.catalog}></project-pane>
          </aside>
          <main class="center-stage">
            <div class="center-stage-toolbar">
              <cadle-actions></cadle-actions>
              <onewire-actions></onewire-actions>
              ${this.loadedPage && this.project?.pages?.[this.loadedPage]
                ? html`<span style="font-size: 14px; color: var(--md-sys-color-on-surface-variant);"
                    >${this.project.pages[this.loadedPage].name}</span
                  >`
                : ''}
              <design-mode-toggle></design-mode-toggle>
            </div>
            <custom-pages attr-for-selected="data-route">
              <home-field data-route="home"></home-field>
              <cadle-app data-route="native-draw"></cadle-app>
              <projects-field data-route="projects"></projects-field>
              <add-page-field data-route="add-page"></add-page-field>
              <create-project-field data-route="create-project"></create-project-field>
              <settings-field data-route="settings"></settings-field>
            </custom-pages>
          </main>
          <aside class="right-rail">
            <object-pane></object-pane>
          </aside>
        </section>
        <status-bar></status-bar>
      </div>
      <keyboard-shortcuts></keyboard-shortcuts>
      <md-dialog class="color-picker">
        <form
          id="pick-color"
          slot="content"
          method="dialog">
          <flex-it></flex-it>
          <flex-row>
            <input
              type="color"
              label="color"
              value="${this.#normalizeColorInput(state.styling.fill)}"
              dialogFocus />
            <flex-it></flex-it>
          </flex-row>
        </form>
        <div slot="actions">
          <md-filled-button
            form="pick-color"
            value="confirm-color">
            done
          </md-filled-button>
        </div>
      </md-dialog>
    `
  }
}
