import { LiteElement, html, property, customElement, query } from '@vandeurenglenn/lite'
import { shellStyles } from './shell/styles.js'
import { exportCanvasToA4PNG, type A4Orientation, type A4ExportResult } from './shell/export.js'
import { parseHash } from './shell/routing.js'
import { PresenceController } from './shell/presence.js'
import type { Canvas, FabricObject } from 'fabric'
import './elements/design-mode-toggle.js'
import { generateBOMFiles, normalizeBindingId } from './shell/bom.js'
import { iconSetTemplate } from './shell/icon-set.js'
import { getStoredCustomSymbols, setStoredCustomSymbols, getCustomCatalogSections } from './shell/custom-symbols.js'
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
import './fields/draw.js'
import './elements/save-field.js'
import './elements/panes/project-pane.js'
import './elements/panes/object-pane.js'
import './elements/pdf-importer.js'
import './elements/header.js'
import './elements/status-bar.js'
import './elements/actions/actions.js'
import pubsub from './pubsub.js'
import './elements/modals/validation-report.js'
import './elements/modals/template-library.js'
import './elements/panels/history-panel.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/outlined-button.js'
import '@material/web/icon/icon.js'
import '@vandeurenglenn/lite-elements/icon-set.js'
import '@vandeurenglenn/lite-elements/icon.js'
import state from './state.js'
import { Color } from './symbols/default-options.js'
import './elements/actions/project-actions.js'
import { Project, type Projects, type UUID, type Catalog, type JsonValue } from './types.js'
import { addPage, getProjectData, getProjects, projectStore, setProjectData } from './api/project.js'
import { DrawField } from './fields/draw.js'
import { isOpeningObject, isWallObject, getWallEndpoints } from './fields/draw/wall-snap.js'
import { circuitTemplates } from './templates/circuit-templates.js'

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

type ShellProjectStore = {
  set: (key: Uint8Array, value: unknown) => Promise<void>
  get: (key: string) => Promise<Project>
}

type ShellFabricObject = FabricObject & {
  bindingId?: string
  left?: number
  top?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  bindingRole?: string
  originY?: 'top' | 'center' | 'bottom'
  type?: string
  doorSwingDirection?: string
  doorHingeSide?: string
}

type CanvasWithUndoRedo = Canvas & {
  undo?: () => void
  redo?: () => void
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

  @query('draw-field')
  accessor field!: DrawField

  @query('custom-pages')
  accessor pages!: ShellPagesElement

  @property({ type: Object })
  accessor manifest: Record<string, JsonValue> = {}

  @property({ type: Boolean })
  accessor validationReportOpen = false

  @property()
  accessor validationReportData: JsonValue | null = null

  @property({ type: Boolean })
  accessor historyPanelOpen = false

  @property({ type: Array })
  accessor historyEntries: Array<{ id: string; label: string; timestamp: number }> = []

  @property({ type: Boolean })
  accessor projectDirty = false

  @property({ type: Boolean })
  accessor templateLibraryOpen = false

  _freeDraw: boolean = false
  set freeDraw(value: boolean) {
    const next = !!value
    if (this._freeDraw === next) return
    this._freeDraw = next
    pubsub.publish('shell.snap', !next)
  }

  get freeDraw(): boolean {
    return this._freeDraw
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
    if (this.field) {
      this.field.showMeasurements = value
    }

    if (!this.field?.canvas) return
    const objects = this.field.canvas.getObjects()
    for (const object of objects) {
      if (object.type === 'CadleWall' || object.type === 'CadleWindow') {
        object.set('showMeasurements', value)
      }

      // Legacy labels stay hidden; architectural side overlay is the measurement source.
      if (object.type === 'CadleWidth' || object.type === 'CadleDepth') {
        object.set('visible', false)
      }
    }

    this.field.canvas.requestRenderAll()
  }

  get showMeasurements() {
    return this._showMeasurements
  }

  _action: string = ''
  @property({ attribute: false, provides: 'projectKey' })
  accessor projectKey: UUID = '' as UUID

  set action(value) {
    const canvas = this.field?.canvas as Canvas | undefined
    if (canvas) canvas.defaultCursor = value ? 'crosshair' : 'default'
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
    const symbols = this.field?.getBoundOneLineCatalogSymbols?.() ?? []
    const groupSymbols = this.field?.getBindingGroupCatalogSymbols?.() ?? []
    this.catalog = this.#mergeCatalogWithBoundSymbols(symbols, groupSymbols)
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
    if (this.field) {
      this.field.remoteCursors = this._presence
        .activeCursors(this.projectKey, this.loadedPage)
        .map(({ id, name, color, x, y }) => ({ id, name, color, x, y }))
    }
  }

  #broadcastPresence(position?: { x: number; y: number }, hidden = false) {
    this._presence.broadcast(this.projectKey, this.loadedPage, position, hidden)
  }

  #focusBindingGroup(bindingId: string) {
    const targetId = normalizeBindingId(bindingId)
    if (!targetId || !this.field?.canvas) return
    const canvas = this.field.canvas
    const target = canvas
      .getObjects()
      .find((object: ShellFabricObject) => normalizeBindingId(String(object.bindingId ?? '')) === targetId)
    if (!target) return
    canvas.discardActiveObject()
    canvas.setActiveObject(target)
    canvas.requestRenderAll()
    location.hash = '#!/draw'
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
    const category = globalThis.prompt('Catalog category', 'My Symbols')?.trim() || 'My Symbols'
    const bindingRole = (globalThis.prompt('Binding role (switch, load, neutral)', 'neutral')?.trim().toLowerCase() ||
      'neutral') as 'switch' | 'load' | 'neutral'
    const situationElementType = globalThis.prompt('Situation element type (optional)', '')?.trim() || undefined
    const path = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
    const symbols = getStoredCustomSymbols()
    symbols.push({
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
    setStoredCustomSymbols(symbols)
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
    location.hash = '#!/draw'
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

  #beforePrint = async () => {
    this.actions.hide()
    // No style mutation on DrawField in Lite; skip
    const exported = await this.exportA4PNG('auto')
    const dataUrl = exported.dataUrl
    let windowContent = '<!DOCTYPE html>'
    windowContent += '<html>'
    windowContent += '<head><title>Print Cadle Project</title>'
    windowContent += '<style>'
    windowContent += `@page{size:A4 ${exported.orientation};margin:0;}`
    windowContent += 'html,body{margin:0;background:#fff;}'
    windowContent +=
      'img{width:100%;display:block;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;}'
    windowContent += '</style></head>'
    windowContent += '<body style="margin:0;background:#fff;">'
    windowContent += '<img src="' + dataUrl + '" onload=window.print();>'
    windowContent += '</body>'
    windowContent += '</html>'
    const printWin = window.open('', '', 'width=340,height=260')
    if (!printWin) return
    printWin.document.open()
    printWin.document.write(windowContent)
  }

  #afterPrint = () => {
    // No style mutation on DrawField in Lite; skip
    this.actions.show()
    this.field.canvas.renderAll()
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
    await Promise.all([
      import('./elements/actions/actions.js'),
      import('./controllers/routing.js'),
      import('./controllers/mouse.js'),
      import('./controllers/keyboard.js')
    ])
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
    // Default = BroadcastChannel (same-browser tabs). Opt-in to
    // cross-machine sync by setting localStorage['cadle-multi-user'] = 'peernet'.
    if (localStorage.getItem('cadle-multi-user') === 'peernet') {
      const { PeernetTransport } = await import('./shell/multi-user-transport.js')
      this._presence.connect(new PeernetTransport('cadle-presence'))
    } else if ('BroadcastChannel' in globalThis) {
      this._presence.connect()
    }

    onhashchange = this.#onhashchange.bind(this)
    this.#onhashchange()
    this.addEventListener('drop', this.#drop.bind(this))
    this.addEventListener('dragover', this.#dragover.bind(this))
    this.addEventListener('binding-lookup-updated', this.#onBindingLookupUpdated as EventListener)
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
    const validRoutes = new Set(['home', 'draw', 'save', 'projects', 'add-page', 'create-project', 'settings'])
    const fallbackRoute = this.project?.pages ? 'draw' : 'projects'
    // If draw is requested but no project is loaded, redirect to projects
    const nextRoute = validRoutes.has(route) && !(route === 'draw' && !this.project?.pages) ? route : fallbackRoute
    if (!customElements.get(`${nextRoute}-field`)) {
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
      location.hash = '#!/draw'
    }

    if (action === 'open-project' && projectKey) {
      console.log(projectKey)
      await this.savePage()
      this.project = await getProjectData(projectKey as UUID)
      this.projectKey = projectKey as UUID
      console.log(this.project)
      const keys = Object.keys(this.project.pages)
      if (keys[0]) await this.loadPage(keys[0])
      location.hash = '#!/draw'
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
      const clonedSchema = this.#clonePageSchema(page.schema, {
        includeWalls: includeWalls || outsideWalls,
        outsideWallsOnly: outsideWalls,
        includeOpenings,
        includeElectrical
      })
      await addPage(this.projectKey, newPageName, clonedSchema)
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

  #clonePageSchema(
    schema: { version?: string; objects?: unknown[] },
    options: {
      includeWalls: boolean
      outsideWallsOnly: boolean
      includeOpenings: boolean
      includeElectrical: boolean
    }
  ) {
    const version = schema?.version ?? '6.0.0'
    const objects = Array.isArray(schema?.objects) ? schema.objects : []
    const { includeWalls, outsideWallsOnly, includeOpenings, includeElectrical } = options

    const shouldFilter = includeWalls || includeOpenings || includeElectrical
    if (!shouldFilter) {
      return structuredClone({ version, objects })
    }

    const selectedObjects = new Set<ShellFabricObject>()
    const walls = objects.filter((obj): obj is ShellFabricObject => isWallObject(obj as FabricObject | null))
    const selectedWalls = includeWalls ? (outsideWallsOnly ? this.#selectOutsideWalls(walls) : walls) : []

    if (includeWalls) {
      selectedWalls.forEach((wall) => selectedObjects.add(wall))
    }

    if (includeOpenings) {
      const openings = objects.filter((obj): obj is ShellFabricObject => isOpeningObject(obj as FabricObject | null))
      const filteredOpenings = outsideWallsOnly
        ? openings.filter((opening) => this.#openingBelongsToWalls(opening, selectedWalls))
        : openings
      filteredOpenings.forEach((object) => selectedObjects.add(object))
    }

    if (includeElectrical) {
      objects
        .filter((obj): obj is ShellFabricObject => {
          const candidate = obj as FabricObject & { bindingRole?: string }
          return candidate.bindingRole === 'switch' || candidate.bindingRole === 'load'
        })
        .forEach((object) => selectedObjects.add(object))
    }
    return { version, objects: structuredClone(Array.from(selectedObjects)) }
  }

  #openingBelongsToWalls(opening: ShellFabricObject, walls: ShellFabricObject[]) {
    const openingCenter = this.#getObjectCenter(opening)
    if (!openingCenter) return false
    return walls.some((wall) => {
      const wallEndpoints = getWallEndpoints(wall)
      if (!wallEndpoints || wallEndpoints.length !== 2) return false
      const distance = this.#distanceToSegment(openingCenter, wallEndpoints[0], wallEndpoints[1])
      return distance <= this.#wallThicknessForMatch(wall)
    })
  }

  #getObjectCenter(object: ShellFabricObject) {
    const left = Number(object.left ?? 0)
    const top = Number(object.top ?? 0)
    const width = Math.abs(Number(object.width ?? 0) * Number(object.scaleX ?? 1))
    const height = Math.abs(Number(object.height ?? 0) * Number(object.scaleY ?? 1))
    if (!isFinite(width) || !isFinite(height)) return null
    return { x: left + width / 2, y: top + height / 2 }
  }

  #distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const wx = point.x - a.x
    const wy = point.y - a.y
    const c1 = vx * wx + vy * wy
    if (c1 <= 0) return Math.hypot(point.x - a.x, point.y - a.y)
    const c2 = vx * vx + vy * vy
    if (c2 <= c1) return Math.hypot(point.x - b.x, point.y - b.y)
    const t = c1 / c2
    const projX = a.x + t * vx
    const projY = a.y + t * vy
    return Math.hypot(point.x - projX, point.y - projY)
  }

  #wallThicknessForMatch(wall: ShellFabricObject) {
    const width = Math.abs(Number(wall.width ?? 0) * Number(wall.scaleX ?? 1))
    const height = Math.abs(Number(wall.height ?? 0) * Number(wall.scaleY ?? 1))
    return Math.max(8, Math.min(width, height, 12))
  }

  #selectOutsideWalls(walls: ShellFabricObject[]) {
    const validWalls = walls.filter((wall) => {
      const width = Math.abs(Number(wall.width ?? 0) * Number(wall.scaleX ?? 1))
      const height = Math.abs(Number(wall.height ?? 0) * Number(wall.scaleY ?? 1))
      return width > 0 && height > 0
    })

    if (validWalls.length === 0) {
      return []
    }

    const endpoints = validWalls.map((wall) => ({
      wall,
      points: getWallEndpoints(wall)
    }))

    const allXs = endpoints.flatMap(({ points }) => points.map((point) => point.x))
    const allYs = endpoints.flatMap(({ points }) => points.map((point) => point.y))
    const minX = Math.min(...allXs)
    const minY = Math.min(...allYs)
    const maxX = Math.max(...allXs)
    const maxY = Math.max(...allYs)
    const edgeTolerance = 6
    return endpoints
      .filter(({ points }) =>
        points.some(
          (point) =>
            point.x <= minX + edgeTolerance ||
            point.y <= minY + edgeTolerance ||
            point.x >= maxX - edgeTolerance ||
            point.y >= maxY - edgeTolerance
        )
      )
      .map(({ wall }) => wall)
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
    return exportCanvasToA4PNG(this.field.canvas, orientation)
  }

  async toPNG() {
    const exported = await this.exportA4PNG('landscape')
    return exported.dataUrl
  }

  async downloadAsPNG(name: string) {
    const dataUrl = await this.toPNG()
    // const url = URL.createObjectURL(blob);
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${this.projectName}-${name}.png`
    a.click()
  }

  get drawer() {
    return this.shadowRoot?.querySelector('.left-rail') ?? this.querySelector('.left-rail')
  }

  async savePage() {
    if (!this.loadedPage || !this.field) return
    const schema = this.field.toJSON?.()
    if (!schema) return
    if (!this.project?.pages || !this.project.pages[this.loadedPage]) {
      console.warn('savePage skipped because no loaded page exists', {
        loadedPage: this.loadedPage,
        projectPages: this.project?.pages
      })
      return
    }

    this.project.pages[this.loadedPage].schema = schema
    await setProjectData(this.projectKey, this.project)
    this.projectDirty = false
    pubsub.publish('project.saved', { projectKey: this.projectKey, pageKey: this.loadedPage })
  }

  async loadPage(key: string) {
    this.loadedPage = key
    const page = this.project.pages[key]
    console.log({ page, key })
    // Wait for the draw-field element to be available and its canvas initialized
    // No updateComplete in Lite; rely on property updates
    const drawField = this.shadowRoot?.querySelector('draw-field') as typeof this.field
    if (drawField) {
      if (drawField.fromJSON) {
        const schema = (page.schema as unknown as { version: string; objects: JsonValue[] }) ?? {
          version: '6.0.0',
          objects: [] as JsonValue[]
        }
        await drawField.fromJSON(schema)
      }

      this.historyEntries = drawField
        .getHistoryEntries?.()
        .map(({ id, label, timestamp }: { id: string; label: string; timestamp: number }) => ({
          id,
          label,
          timestamp
        }))
    }

    this.projectDirty = false
    this.#syncRemotePresence()
    this.#refreshBoundOneLineCatalog()
  }

  async generateAutoOneWireSchema() {
    if (!this.project || !this.projectKey) return
    await this.savePage()
    const report = this.field.getBindingValidationReport()
    if (report.totalGroups === 0) {
      globalThis.alert('No binding groups found. Add IDs like A1 to switches and loads/sockets first.')
      return
    }

    if (report.errorCount > 0) {
      const proceed = globalThis.confirm(
        `Found ${report.errorCount} binding errors and ${report.warningCount} warnings.\n\nContinue generating one-wire anyway?`
      )
      if (!proceed) return
    }

    const schema = this.field.buildAutoOneWireSchema()
    const existingEntry = Object.entries(this.project.pages).find(([, page]) =>
      String(page?.name ?? '')
        .toLowerCase()
        .startsWith('auto one-wire')
    )
    const pageName = 'Auto One-Wire'
    let pageKey = existingEntry?.[0]
    if (pageKey) {
      this.project.pages[pageKey].name = pageName
      this.project.pages[pageKey].schema = schema
      this.project.pages[pageKey].creationTime = this.project.pages[pageKey].creationTime ?? Date.now()
    } else {
      pageKey = crypto.randomUUID()
      this.project.pages[pageKey] = {
        creationTime: Date.now(),
        name: pageName,
        schema
      }
    }

    await setProjectData(this.projectKey, this.project)
    await this.loadPage(pageKey)
    location.hash = '#!/draw'
    this.projectPane?.select?.('project')
  }

  async validateBindingsForOneWire() {
    if (!this.project || !this.projectKey) return
    await this.savePage()
    const report = this.field.getBindingValidationReport()
    this.validationReportData = report as unknown as JsonValue
    this.validationReportOpen = true
    return report
  }

  async generateBOM() {
    if (!this.project || !this.projectKey || !this.field?.canvas) return
    await this.savePage()
    const projectName = this.projectName ?? this.project?.name ?? 'Cadle Project'
    const ok = generateBOMFiles(this.field.canvas, projectName)
    if (!ok) {
      globalThis.alert('No bindable electrical items found for BOM export.')
    }
  }

  undo() {
    const field = this.field
    if (field && field.canvas && 'undo' in field.canvas) {
      ;(field.canvas as CanvasWithUndoRedo).undo?.()
    }
  }

  redo() {
    const field = this.field
    if (field && field.canvas && 'redo' in field.canvas) {
      ;(field.canvas as CanvasWithUndoRedo).redo?.()
    }
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
      <history-panel
        .open=${this.historyPanelOpen}
        .entries=${this.historyEntries}
        @close=${() => (this.historyPanelOpen = false)}
        @restore-history=${async (event: CustomEvent<{ id: string }>) => {
          await this.field?.restoreHistoryEntry?.(event.detail.id)
          this.historyEntries =
            this.field
              ?.getHistoryEntries?.()
              .map(({ id, label, timestamp }: { id: string; label: string; timestamp: number }) => ({
                id,
                label,
                timestamp
              })) ?? []
          location.hash = '#!/draw'
        }}></history-panel>
      ${iconSetTemplate}
      <div class="shell-frame">
        <section class="layout">
          <aside class="left-rail">
            <cadle-header>
              <project-actions></project-actions>
            </cadle-header>
            <div
              class="rail-tabs"
              role="tablist">
              <button
                class="rail-tab"
                role="tab"
                type="button"
                title="Project pages"
                aria-label="Project pages"
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
                aria-selected=${this.railView === 'symbols'}
                @click=${() => this.#selectRailView('symbols')}>
                <custom-icon icon="format_shapes"></custom-icon>
              </button>
            </div>
            <project-pane
              .manifest=${this.manifest}
              .project=${this.project}
              .catalog=${this.catalog}></project-pane>
          </aside>
          <main class="center-stage">
            <div class="center-stage-toolbar">
              <cadle-actions></cadle-actions>
              ${this.loadedPage && this.project?.pages?.[this.loadedPage]
                ? html`<span style="font-size: 14px; color: var(--md-sys-color-on-surface-variant);"
                    >${this.project.pages[this.loadedPage].name}</span
                  >`
                : ''}
              <design-mode-toggle></design-mode-toggle>
            </div>
            <custom-pages attr-for-selected="data-route">
              <home-field data-route="home"></home-field>
              <draw-field data-route="draw"></draw-field>
              <save-field data-route="save"></save-field>
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
              value="${state.styling.fill}"
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
