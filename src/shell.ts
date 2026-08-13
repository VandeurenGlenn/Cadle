import { LiteElement, html, property, customElement, query, listen } from '@vandeurenglenn/lite'
import { shellStyles } from './shell/styles.js'
import { parseHash } from './shell/routing.js'
import { PresenceController } from './shell/presence.js'
import { iconSetTemplate } from './shell/icon-set.js'
import {
  ensureCustomCatalogLoaded,
  getStoredCustomSymbols,
  setStoredCustomSymbols,
  getCustomCatalogSections
} from './shell/custom-symbols.js'
import '@vandeurenglenn/lite-elements/pages.js'
import '@vandeurenglenn/lite-elements/button.js'
import './elements/header.js'
import pubsub from './pubsub.js'
import type { ValidationReport } from './elements/modals/validation-report.js'
import './elements/modals/page-operation-dialog.js'
import type { PageOperationSubmitDetail } from './elements/modals/page-operation-dialog.js'
import './elements/modals/color-picker-dialog.js'
import '@vandeurenglenn/lite-elements/icon-set.js'
import '@vandeurenglenn/lite-elements/icon.js'
import state from './state.js'
import { Color } from './symbols/default-options.js'
import {
  Project,
  type Projects,
  type UUID,
  type Catalog,
  type JsonValue,
  type OneWireTopologyPlan,
  type CircuitScheduleLayout
} from './types.js'
import { addPage, getProjectData, getProjects, projectStore, setProjectData } from './api/project.js'
import { circuitTemplates } from './templates/circuit-templates.js'
import { type BomRow, type CircuitAnalysis } from './editor/circuit-analysis.js'
import { ensureOneWirePage } from './shell/page-operations.js'
import { clonePageSchema } from './shell/page-schema.js'
import { downloadBom, downloadDataUrl } from './shell/export-commands.js'
import { evaluateOneWirePreflight } from './shell/onewire-preflight.js'
import { validateOneWireTopology } from './editor/onewire-topology-schema.js'
import { storeOneWireTrainingExample } from './editor/onewire-training-data.js'
import type { CircuitScheduleEditorItem } from './editor/circuit-schedule-page.js'

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
  exportProjectPdf?: (filename?: string) => Promise<void>
  analyzeBindings?: () => CircuitAnalysis
  getBOMRows?: () => BomRow[]
  getCircuitScheduleEditorItems?: () => CircuitScheduleEditorItem[]
  generateAutoOneWire?: (pageIndex?: number) => { generated: boolean; circuitCount: number; pageCount?: number; message?: string }
  waitForPageReady?: (pageKey: string) => Promise<boolean>
  flushPendingSave?: () => Promise<void>
  flushPendingCircuitUpdates?: () => Promise<void>
}

type KeyboardShortcutsElement = HTMLElement & {
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

  @property({ type: String, attribute: false })
  accessor activeRoute = 'projects'

  @property({ type: Boolean, attribute: false })
  accessor mobileDrawerOpen = false

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

  @property({ type: Boolean })
  accessor circuitScheduleDialogOpen = false

  @property({ attribute: false })
  accessor circuitScheduleItems: CircuitScheduleEditorItem[] = []

  @property({ type: Boolean })
  accessor oneWirePromptDialogOpen = false

  @property({ type: Boolean })
  accessor oneWireTrainingPanelOpen = false

  @property({ type: Boolean })
  accessor projectShareDialogOpen = false

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
  #nativeEditorModules: Promise<unknown> | null = null

  #ensureNativeEditorLoaded(): Promise<unknown> {
    this.#nativeEditorModules ??= Promise.all([
      import('./app.js'),
      import('./elements/design-mode-toggle.js'),
      import('./elements/panes/project-pane.js'),
      import('./elements/panes/object-pane.js'),
      import('./elements/status-bar.js'),
      import('./elements/actions/actions.js'),
      import('./elements/actions/project-actions.js'),
      import('./elements/actions/onewire-actions.js'),
      import('./elements/modals/validation-report.js'),
      import('./elements/modals/template-library.js'),
      import('./elements/modals/project-details-dialog.js'),
      import('./elements/modals/circuit-schedule-dialog.js'),
      import('./fields/circuit-schedule.js'),
      import('./elements/modals/onewire-prompt-dialog.js'),
      import('./elements/modals/project-share-dialog.js'),
      import('./elements/panels/history-panel.js'),
      import('./elements/panels/onewire-training-panel.js')
    ])
    return this.#nativeEditorModules
  }

  constructor() {
    super()
    globalThis.cadleShell = this
    localStorage.setItem('cadle.presenceName', this._presenceName)
    localStorage.setItem('cadle.presenceColor', this._presenceColor)
  }

  #captureReloadResumeFromHash() {
    const { route, params } = parseHash(location.hash)
    const isNativeRoute = route === 'editor/model' || route === 'draw' || route === 'save'
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

  #toggleMobileDrawer = () => {
    this.mobileDrawerOpen = !this.mobileDrawerOpen
  }

  #closeMobileDrawer = () => {
    this.mobileDrawerOpen = false
  }

  @listen('keydown', { target: 'window' })
  onWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.mobileDrawerOpen) this.#closeMobileDrawer()
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

  async openCircuitScheduleDialog() {
    if (!this.projectKey || !this.project) return
    await this.savePage()
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    this.circuitScheduleItems = nativeApp?.getCircuitScheduleEditorItems?.() ?? []
    let pageEntry = Object.entries(this.project.pages).find(([, page]) => page.pageType === 'circuit-schedule')
    if (!pageEntry) {
      await addPage(
        this.projectKey,
        'Kringenoverzicht',
        { version: 'circuit-schedule-1', objects: [] },
        'circuit-schedule'
      )
      this.project = await getProjectData(this.projectKey)
      pageEntry = Object.entries(this.project.pages).find(([, page]) => page.pageType === 'circuit-schedule')
    }
    if (pageEntry) await this.loadPage(pageEntry[0])
  }

  openProjectShareDialog() {
    if (!this.projectKey || !this.project) return
    this.projectShareDialogOpen = true
  }

  openOneWirePromptDialog() {
    if (!this.projectKey || !this.project) return
    this.oneWirePromptDialogOpen = true
  }

  openOneWireTrainingData() {
    this.oneWireTrainingPanelOpen = true
  }

  #applyOneWireTopology = async (detail: {
    prompt: string
    topology: OneWireTopologyPlan
    parserTopology: OneWireTopologyPlan
  }) => {
    if (!this.projectKey || !this.project) return
    const validation = validateOneWireTopology(detail.topology)
    if (!validation.valid || !validation.value) {
      globalThis.alert(`Ongeldige schema-opbouw: ${validation.errors.join(' ')}`)
      return
    }
    this.project = {
      ...this.project,
      oneWirePrompt: detail.prompt,
      oneWireTopology: validation.value,
      ...(validation.value.gridProtectionCurrentA
        ? { mainFuseA: validation.value.gridProtectionCurrentA }
        : {})
    }
    const mainDifferential = detail.topology.mainDifferential
    if (mainDifferential) {
      const profile = this.project.electricalProfile ?? {
        standard: 'AREI' as const,
        edition: 'Book 1 (current edition)',
        distributor: '',
        supplyConfiguration: '1x230V+N' as const,
        supplyVoltageV: 230,
        phaseConfiguration: 'single-phase' as const,
        earthingSystem: 'unknown' as const,
        defaultPoles: 2,
        boards: [{ id: 'main', name: 'Main distribution board', rails: [{ id: 'rail-1', name: 'Rail 1' }] }]
      }
      const boards = profile.boards?.length
        ? profile.boards.map((board, index) => index === 0
            ? {
                ...board,
                mainDifferential: {
                  id: board.mainDifferential?.id ?? 'main-differential',
                  ratedCurrentA: mainDifferential.ratedCurrentA,
                  sensitivityMa: mainDifferential.sensitivityMa,
                  poles: board.mainDifferential?.poles ?? profile.defaultPoles,
                  type: board.mainDifferential?.type ?? 'A'
                }
              }
            : board)
        : profile.boards
      this.project.electricalProfile = { ...profile, boards }
    }
    await setProjectData(this.projectKey, this.project)
    try {
      await storeOneWireTrainingExample(detail.prompt, detail.parserTopology, validation.value)
    } catch (error) {
      console.warn('Unable to store local one-wire training example.', error)
    }
    this.oneWirePromptDialogOpen = false
    await this.generateAutoOneWireSchema()
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

  @listen('canvas-history-updated')
  onHistoryEntriesUpdated(event: Event) {
    const customEvent = event as CustomEvent<{ entries?: Array<{ id: string; label: string; timestamp: number }> }>
    this.historyEntries = customEvent.detail?.entries ?? []
  }

  @listen('canvas-history-updated')
  onCanvasHistoryUpdated() {
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
    }, { once: true })
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

  @listen('binding-lookup-updated')
  onBindingLookupUpdated(event: Event) {
    const customEvent = event as CustomEvent<{
      symbols?: Catalog[number]['symbols']
      groupSymbols?: Catalog[number]['symbols']
    }>
    const symbols = customEvent.detail?.symbols ?? []
    const groupSymbols = customEvent.detail?.groupSymbols ?? []
    this.catalog = this.#mergeCatalogWithBoundSymbols(symbols, groupSymbols)
  }

  @listen('catalog-structure-updated')
  onCatalogStructureUpdated() {
    this.#refreshBoundOneLineCatalog()
  }

  #registerServiceWorker = async () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return

    try {
      const registration = await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), {
        scope: './',
        updateViaCache: 'none'
      })
      await registration.update()
    } catch (error) {
      console.warn('Failed to register service worker', error)
    }
  }

  #afterInitialPaint = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

  #preloadCatalogAfterInitialPaint = async () => {
    await this.#afterInitialPaint()
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

    // Resolve the initial screen before catalog loading so first-time users never
    // spend that work looking at an editor without an open project.
    this.#captureReloadResumeFromHash()
    const initialRoute = parseHash(location.hash).route
    if (!initialRoute || ((initialRoute === 'editor/model' || initialRoute === 'draw' || initialRoute === 'save') && !this.showReopenPreviousProjectPrompt)) {
      location.hash = '#!/projects'
    }
    await this.#onhashchange()

    void this.#registerServiceWorker()
    void this.#preloadCatalogAfterInitialPaint()

    // Presence is same-browser until an authenticated, maintained remote
    // transport is configured explicitly.
    if ('BroadcastChannel' in globalThis) {
      this._presence.connect()
    }

    window.addEventListener('hashchange', this.#onhashchange)
    if (this.showReopenPreviousProjectPrompt) {
      pubsub.publish('shell.reopen-previous-project-prompt', {
        open: true,
        projectName: this.previousProjectName
      })
    }
  }

  disconnectedCallback(): void {
    this.#broadcastPresence(undefined, true)
    this._presence.disconnect()
    window.removeEventListener('hashchange', this.#onhashchange)
    if (super.disconnectedCallback) super.disconnectedCallback()
  }

  @listen('dragover')
  onDragOver(event: DragEvent) {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  @listen('drop')
  onDrop(event: DragEvent) {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files ?? [])]
    const svgFiles = files.filter((file) => file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg'))
    if (svgFiles.length === 0) {
      return
    }

    svgFiles.forEach((file) => {
      void this.importCustomSymbolFile(file)
    })
  }

  @listen('presence-pointer')
  onPresencePointer(event: CustomEvent<{ x: number; y: number }>) {
    this.#broadcastPresence({ x: event.detail.x, y: event.detail.y })
  }

  @listen('presence-pointer-leave')
  onPresencePointerLeave() {
    this.#broadcastPresence(undefined, true)
  }

  #onhashchange = async () => {
    const { route, params } = parseHash(location.hash)
    const validRoutes = new Set(['home', 'editor/model', 'projects', 'add-page', 'create-project', 'settings'])
    const fallbackRoute = this.project?.pages ? 'editor/model' : 'projects'
    const nextRoute =
      route === 'draw' || route === 'save' ? 'editor/model' : validRoutes.has(route) ? route : fallbackRoute
    this.#closeMobileDrawer()
    if (nextRoute === 'editor/model') await this.#ensureNativeEditorLoaded()
    this.activeRoute = nextRoute
    await this.rendered
    if (nextRoute !== 'editor/model' && !customElements.get(`${nextRoute}-field`)) {
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

  #nativeDrawHash() {
    if (this.projectKey && this.loadedPage) {
      return `#!/editor/model?project=${this.projectKey}&page=${this.loadedPage}`
    }
    return '#!/editor/model'
  }

  async openClonePageDialog(pageKey: string) {
    const page = this.project.pages?.[pageKey]
    if (!page) return
    await this.rendered
    this.shadowRoot?.querySelector('page-operation-dialog')?.show('clone', pageKey, page.name)
  }

  async openRenamePageDialog(pageKey: string) {
    const page = this.project.pages?.[pageKey]
    if (!page) return
    await this.rendered
    this.shadowRoot?.querySelector('page-operation-dialog')?.show('rename', pageKey, page.name)
  }

  #onPageOperationSubmit = async (event: CustomEvent<PageOperationSubmitDetail>) => {
    const detail = event.detail
    const page = this.project.pages?.[detail.pageKey]
    if (!page || !detail.pageName.trim()) return
    if (detail.mode === 'clone') {
      const clonedSchema = clonePageSchema(page.schema, {
        includeWalls: detail.includeWalls || detail.outsideWallsOnly,
        outsideWallsOnly: detail.outsideWallsOnly,
        includeOpenings: detail.includeOpenings,
        includeElectrical: detail.includeElectrical
      })
      await addPage(this.projectKey, detail.pageName.trim(), clonedSchema, page.pageType ?? 'groundplan')
    } else {
      page.name = detail.pageName.trim()
      await setProjectData(this.projectKey, this.project)
    }
    this.project = await getProjectData(this.projectKey)
  }

  async loadProject(projectKey: UUID, projectName: string) {
    void projectName
    await this.#openProject(projectKey)
  }

  async #openProject(projectKey: UUID) {
    await this.savePage()
    this.project = await getProjectData(projectKey)
    this.projectKey = projectKey
    const keys = Object.keys(this.project.pages)
    if (keys[0]) await this.loadPage(keys[0])
    location.hash = this.#nativeDrawHash()
    this.projectPane?.select?.('project')
  }

  async exportA4PNG(orientation: A4Orientation | 'auto' = 'auto'): Promise<A4ExportResult> {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    if (!nativeApp?.exportA4PNG) throw new Error('Native draw export is unavailable')
    return nativeApp.exportA4PNG(orientation)
  }

  async exportProjectPdf(filename?: string): Promise<void> {
    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    if (!nativeApp?.exportProjectPdf) throw new Error('Project PDF export is unavailable')
    await nativeApp.exportProjectPdf(filename)
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
    if (this.projectKey) {
      localStorage.setItem(AppShell.LAST_OPEN_PROJECT_KEY_STORAGE, this.projectKey)
      localStorage.setItem(AppShell.LAST_OPEN_PAGE_KEY_STORAGE, key)
    }

    location.hash = `#!/editor/model?project=${this.projectKey}&page=${key}`
    this.projectDirty = false
    this.#syncRemotePresence()
    this.#refreshBoundOneLineCatalog()

    const nativeApp = await this.#nativeAppForPage(key)
    if (this.project?.pages?.[key]?.pageType === 'circuit-schedule') {
      this.circuitScheduleItems = nativeApp?.getCircuitScheduleEditorItems?.() ?? []
    }
  }

  async #nativeAppForPage(pageKey: string): Promise<NativeAppElement | null> {
    // A route/page change may replace <cadle-app>. Re-query every frame instead
    // of awaiting the editor instance that belonged to the previous page.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
      if (!nativeApp?.waitForPageReady) continue
      if (await nativeApp.waitForPageReady(pageKey)) return nativeApp
    }
    return null
  }

  async generateAutoOneWireSchema() {
    if (!this.projectKey) {
      globalThis.alert('Create or open a project before generating a one-wire plan.')
      return
    }

    const nativeApp = this.shadowRoot?.querySelector('cadle-app') as NativeAppElement | null
    try {
      await nativeApp?.flushPendingCircuitUpdates?.()
      await nativeApp?.flushPendingSave?.()
    } catch {
      globalThis.alert('The floor plan could not be saved. One-wire generation was cancelled to protect your work.')
      return
    }
    this.project = await getProjectData(this.projectKey)

    const report = nativeApp?.analyzeBindings?.() ?? null
    const preflight = evaluateOneWirePreflight(report)
    if (preflight.ready === false) {
      if (report) {
        this.validationReportData = report
        this.validationReportOpen = true
      } else {
        globalThis.alert(preflight.message)
      }
      return
    }

    const oneWirePage = await ensureOneWirePage(this.projectKey, this.project)
    if (!oneWirePage) return
    this.project = oneWirePage.project

    await this.loadPage(oneWirePage.pageKey)
    let activeApp = await this.#nativeAppForPage(oneWirePage.pageKey)
    if (!activeApp) {
      globalThis.alert('The one-wire page did not finish loading. Please try again.')
      return
    }
    const result = activeApp.generateAutoOneWire?.(0)
    if (!result?.generated) globalThis.alert(result?.message ?? 'Unable to generate the one-wire diagram.')
    if (!result?.generated || !result.pageCount || result.pageCount <= 1) return

    await activeApp.flushPendingSave?.()
    for (let pageIndex = 1; pageIndex < result.pageCount; pageIndex += 1) {
      const pageName = `One-wire diagram ${pageIndex + 1}`
      let overflowPageKey = Object.entries(this.project.pages).find(
        ([, page]) => page.pageType === 'onewire' && page.name === pageName
      )?.[0]
      if (!overflowPageKey) {
        await addPage(this.projectKey, pageName, { version: 'native-svg-1', objects: [] }, 'onewire')
        this.project = await getProjectData(this.projectKey)
        overflowPageKey = Object.entries(this.project.pages).find(
          ([, page]) => page.pageType === 'onewire' && page.name === pageName
        )?.[0]
      }
      if (!overflowPageKey) continue
      await this.loadPage(overflowPageKey)
      activeApp = await this.#nativeAppForPage(overflowPageKey)
      if (!activeApp) {
        globalThis.alert(`The one-wire page “${pageName}” did not finish loading.`)
        return
      }
      activeApp.generateAutoOneWire?.(pageIndex)
      await activeApp.flushPendingSave?.()
    }
    this.project = await getProjectData(this.projectKey)
    await this.loadPage(oneWirePage.pageKey)
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

  showShortcuts = async () => {
    if (!customElements.get('keyboard-shortcuts')) await import('./screens/keyboard-shortcuts.js')
    const shortcuts = this.shadowRoot?.querySelector('keyboard-shortcuts') as KeyboardShortcutsElement | null
    if (shortcuts) shortcuts.open = true
  }

  pickColor = async (): Promise<Color> => {
    const pickerDialog = this.shadowRoot?.querySelector('color-picker-dialog')
    if (!pickerDialog) throw new Error('Color picker not found')
    const color = await pickerDialog.pick(this.#normalizeColorInput(state.styling.fill)) as Color
    state.styling.fill = color
    this.actions.fill = color
    this._currentColor = color
    return color
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

  #lightweightRouteTemplate() {
    const route = this.activeRoute
    const routeContent =
      route === 'create-project'
        ? html`<create-project-field data-route="create-project"></create-project-field>`
        : route === 'add-page'
          ? html`<add-page-field data-route="add-page"></add-page-field>`
          : route === 'settings'
            ? html`<settings-field data-route="settings"></settings-field>`
            : route === 'home'
              ? html`<home-field data-route="home"></home-field>`
              : html`<projects-field data-route="projects"></projects-field>`
    return html`
      <page-operation-dialog
        @page-operation-submit=${this.#onPageOperationSubmit}></page-operation-dialog>
      <main class="route-only">${routeContent}</main>
    `
  }

  render() {
    if (this.activeRoute !== 'editor/model') return this.#lightweightRouteTemplate()
    const circuitSchedulePage = this.currentPage?.pageType === 'circuit-schedule'

    return html`
      <page-operation-dialog
        @page-operation-submit=${this.#onPageOperationSubmit}></page-operation-dialog>
      <color-picker-dialog></color-picker-dialog>
      <validation-report
        .open=${this.validationReportOpen}
        .report=${this.validationReportData}
        .projectName=${this.projectName ?? this.project?.name ?? ''}
        @close=${() => (this.validationReportOpen = false)}
        @focus-binding=${(event: CustomEvent<{ bindingId: string }>) => this.#focusBindingGroup(event.detail.bindingId)}>
      </validation-report>
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
      <circuit-schedule-dialog
        .open=${this.circuitScheduleDialogOpen}
        .items=${this.circuitScheduleItems}
        .layout=${this.project?.circuitScheduleLayout ?? {}}
        @close=${() => (this.circuitScheduleDialogOpen = false)}
        @saved=${async (event: CustomEvent<{ layout: CircuitScheduleLayout }>) => {
          if (!this.projectKey || !this.project) return
          this.project = { ...this.project, circuitScheduleLayout: event.detail.layout }
          await setProjectData(this.projectKey, this.project)
          this.circuitScheduleDialogOpen = false
        }}></circuit-schedule-dialog>
      <project-share-dialog
        .open=${this.projectShareDialogOpen}
        .project=${this.project}
        .projectKey=${this.projectKey}
        @close=${() => (this.projectShareDialogOpen = false)}
        @project-received=${async () => {
          this.projects = await getProjects()
        }}></project-share-dialog>
      <onewire-prompt-dialog
        .open=${this.oneWirePromptDialogOpen}
        .prompt=${this.project?.oneWirePrompt ?? ''}
        @close=${() => (this.oneWirePromptDialogOpen = false)}
        @apply-topology=${(event: CustomEvent<{
          prompt: string
          topology: OneWireTopologyPlan
          parserTopology: OneWireTopologyPlan
        }>) => {
          void this.#applyOneWireTopology(event.detail)
        }}></onewire-prompt-dialog>
      <onewire-training-panel
        .open=${this.oneWireTrainingPanelOpen}
        @close=${() => (this.oneWireTrainingPanelOpen = false)}>
      </onewire-training-panel>
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
        <section class="layout" data-circuit-schedule=${circuitSchedulePage ? 'true' : 'false'}>
          <aside
            id="project-drawer"
            class="left-rail"
            data-mobile-open=${this.mobileDrawerOpen ? 'true' : 'false'}>
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
              <button
                class="mobile-drawer-toggle"
                type="button"
                aria-label="Open project menu"
                aria-controls="project-drawer"
                aria-expanded=${this.mobileDrawerOpen ? 'true' : 'false'}
                @click=${this.#toggleMobileDrawer}>
                <custom-icon icon=${this.mobileDrawerOpen ? 'menu_open' : 'menu'}></custom-icon>
              </button>
              ${circuitSchedulePage ? '' : html`<cadle-actions></cadle-actions><onewire-actions></onewire-actions>`}
              ${this.loadedPage && this.project?.pages?.[this.loadedPage]
                ? html`<span style="font-size: 14px; color: var(--md-sys-color-on-surface-variant);"
                    >${this.project.pages[this.loadedPage].name}</span
                  >`
                : ''}
              ${circuitSchedulePage ? '' : html`<design-mode-toggle></design-mode-toggle>`}
            </div>
            <custom-pages attr-for-selected="data-route">
              <home-field data-route="home"></home-field>
              <div data-route="editor/model" style="width:100%;height:100%;min-height:0;">
                <cadle-app style=${circuitSchedulePage ? 'display:none' : ''}></cadle-app>
                ${circuitSchedulePage
                  ? html`
                      <circuit-schedule-field
                        .items=${this.circuitScheduleItems}
                        .layout=${this.project?.circuitScheduleLayout ?? {}}
                        @schedule-layout-changed=${async (event: CustomEvent<{ layout: CircuitScheduleLayout }>) => {
                          if (!this.projectKey || !this.project) return
                          this.project = { ...this.project, circuitScheduleLayout: event.detail.layout }
                          await setProjectData(this.projectKey, this.project)
                        }}>
                      </circuit-schedule-field>
                    `
                  : ''}
              </div>
              <projects-field data-route="projects"></projects-field>
              <add-page-field data-route="add-page"></add-page-field>
              <create-project-field data-route="create-project"></create-project-field>
              <settings-field data-route="settings"></settings-field>
            </custom-pages>
          </main>
          ${circuitSchedulePage ? '' : html`<aside class="right-rail"><object-pane></object-pane></aside>`}
          <button
            class="mobile-drawer-backdrop"
            type="button"
            aria-label="Close project menu"
            data-open=${this.mobileDrawerOpen ? 'true' : 'false'}
            @click=${this.#closeMobileDrawer}></button>
        </section>
        <status-bar></status-bar>
      </div>
      <keyboard-shortcuts></keyboard-shortcuts>
    `
  }
}
