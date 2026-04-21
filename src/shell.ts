import { LitElement, html, css } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'

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
import { provide } from '@lit/context'
import { projectsContext } from './context/projects.js'
import { Catalog } from './context/catalog.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/outlined-button.js'
import '@material/web/icon/icon.js'
import { ContextProvider } from '@lit/context'
import '@vandeurenglenn/lite-elements/icon-set.js'
import '@vandeurenglenn/lite-elements/icon.js'
import state from './state.js'
import { Color } from './symbols/default-options.js'
import './elements/actions/project-actions.js'
import '@vandeurenglenn/lite-elements/tabs.js'
import '@vandeurenglenn/lite-elements/tab.js'
import { Project } from './types.js'
import { create, getProjectData, getProjects, projectStore, setProjectData } from './api/project.js'
import { DrawField } from './fields/draw.js'
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

declare type A4Orientation = 'portrait' | 'landscape'

@customElement('app-shell')
export class AppShell extends LitElement {
  projectStore = projectStore
  symbol: string
  projectName: string
  loadedPage: string
  _currentColor

  @query('cadle-actions')
  actions

  @query('project-pane')
  projectPane

  @query('draw-field')
  field: DrawField

  @query('custom-pages')
  pages

  @property({ type: Object })
  manifest: {}

  @property({ type: Boolean })
  freeDraw: boolean = false

  _showMeasurements = false

  set showMeasurements(value) {
    this._showMeasurements = value
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
    this.field.requestUpdate()
  }

  get showMeasurements() {
    return this._showMeasurements
  }

  _action

  projectKey: `'${string}-${string}-${string}-${string}-${string}'`

  set action(value) {
    if (value) this.field.canvas.defaultCursor = 'crosshair'
    else this.field.canvas.defaultCursor = 'default'
    this._action = value
  }

  get action(): string {
    return this._action
  }

  get projects() {
    return this._projectsProvider.value
  }

  set projects(value) {
    this._projectsProvider.setValue(value)
  }

  get project(): Project {
    return this._projectProvider.value
  }

  set project(value: Project) {
    this._projectProvider.setValue(value)
    this._projectProvider.updateObservers()
  }

  @provide({ context: 'catalogContext' })
  @property({ attribute: false })
  catalog: Catalog
  _baseCatalog: Catalog = []

  private _projectsProvider = new ContextProvider(this, { context: projectsContext, initialValue: [] })
  private _projectProvider = new ContextProvider(this, { context: 'projectContext' })

  constructor() {
    super()
    globalThis.cadleShell = this
  }

  #mergeCatalogWithBoundSymbols(boundSymbols: Catalog[number]['symbols']) {
    const baseCatalog = this._baseCatalog ?? []
    const nextCatalog = [...baseCatalog]

    if (boundSymbols.length > 0) {
      nextCatalog.unshift({
        category: 'Bound Situation Elements',
        symbols: boundSymbols
      })
    }

    return nextCatalog
  }

  #refreshBoundOneLineCatalog = () => {
    const symbols = this.field?.getBoundOneLineCatalogSymbols?.() ?? []
    this.catalog = this.#mergeCatalogWithBoundSymbols(symbols)
  }

  #onBindingLookupUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<{ symbols?: Catalog[number]['symbols'] }>
    const symbols = customEvent.detail?.symbols ?? []
    this.catalog = this.#mergeCatalogWithBoundSymbols(symbols)
  }

  #beforePrint = async (e: Event) => {
    this.actions.hide()
    this.field.style.position = 'fixed'
    this.field.style.left = '0'
    const exported = await this.exportA4PNG('auto')
    const dataUrl = exported.dataUrl

    let windowContent = '<!DOCTYPE html>'
    windowContent += '<html>'
    windowContent += '<head><title>Print Cadle Project</title>'
    windowContent += '<style>'
    windowContent += `@page{size:A4 ${exported.orientation};margin:0;}`
    windowContent += 'html,body{margin:0;background:#fff;}'
    windowContent += 'img{width:100%;display:block;image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;}'
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
    this.field.style.position = 'absolute'
    this.field.style.left = 'auto'
    this.actions.show()
    this.field.canvas.renderAll()
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    // const entries = await this.projectStore.entries()

    // for (const [key, value] of entries) {
    //   this.projectStore.set(globalThis.crypto.randomUUID(), { ...value, name: key })
    // }

    const decoder = new TextDecoder()
    try {
      const projects = await getProjects()
      this.projects = projects
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
      // import('./controllers/mouse.js'),
      import('./controllers/keyboard.js')
    ])

    // @ts-ignore
    this._baseCatalog = (await import(`${location.origin}${location.pathname}symbols/manifest.js`)).default
    this.catalog = this.#mergeCatalogWithBoundSymbols([])

    await this.requestUpdate('projects')

    // addEventListener('beforeprint', this.#beforePrint)
    // addEventListener('afterprint', this.#afterPrint)

    await this.updateComplete

    onhashchange = this.#onhashchange.bind(this)
    this.#onhashchange()

    this.addEventListener('drop', this.#drop.bind(this))
    this.addEventListener('dragover', this.#dragover.bind(this))
    this.addEventListener('binding-lookup-updated', this.#onBindingLookupUpdated as EventListener)

    // this.addEventListener('mousedown', () => {
    //   const target = this.shadowRoot.querySelector('[open]')
    //   if (target) target.open = false
    // })
    await this.dialog.updateComplete
    console.log(this.dialog)

    this.dialog.addEventListener('close', this.#dialogAction)
  }

  #dragover(event) {
    event.preventDefault()
    this.setAttribute('show-drop', '')
  }

  #drop(event) {
    event.preventDefault()
    console.log(event)
  }

  #debang(possibleBangedHash) {
    const parts = possibleBangedHash.split('#!/')
    if (parts.length > 1) return parts[1]
    return possibleBangedHash
  }

  #dehash(possibleHash) {
    const parts = possibleHash.split('#')
    if (parts.length > 1) return parts[1]
    return possibleHash
  }

  #dequery(routeWithPossibleQuery) {
    const parts = routeWithPossibleQuery.split('?')
    if (parts.length > 1) return { route: parts[0], query: parts[1] }
    return { route: routeWithPossibleQuery }
  }

  #paramify(query) {
    const parts = query.split('&')
    const params = {}
    for (const part of parts) {
      const [key, value] = part.split('=')
      params[key] = value
    }
    return params
  }

  #parsheHash(hash) {
    let routeWithPossibleQuery
    if (hash.includes('#!/')) routeWithPossibleQuery = this.#debang(hash)
    if (routeWithPossibleQuery === hash && hash.includes('#')) routeWithPossibleQuery = this.#dehash(hash)

    const { route, query } = this.#dequery(routeWithPossibleQuery)
    if (query) {
      const params = this.#paramify(query)
      return { route, params }
    }
    return {
      route
    }
  }

  #onhashchange = async () => {
    const { route, params } = this.#parsheHash(location.hash)
    if (!customElements.get(`${route}-field`)) await import(`./${route}.js`)
    await this.pages.select(route)
    if (params) {
      const selected = this.shadowRoot.querySelector('custom-pages').querySelector('.custom-selected')
      for (const [key, value] of Object.entries(params)) {
        selected[key] = value
      }
    }
  }

  get dialog() {
    return this.renderRoot.querySelector('md-dialog')
  }

  #dialogAction = async (event: Event) => {
    console.log(event.returnValue)
    console.log(event)

    console.log(event.returnValue)

    const action: dialogAction = this.dialog.returnValue as dialogAction
    const projectKey = this.dialog.dataset?.key

    console.log(action)

    if (action === 'confirm-input') {
      const value = this.dialog.querySelector('md-filled-text-field').value
      state.text.current = value
      const match = value.match(/\d+/g)
      if (match?.length > 0) {
        const number = Number(match.join(''))
        state.text.lastNumber = number
      }
    }

    if (action === 'create-project') {
      await cadleShell.savePage()
      cadleShell.projectName = cadleShell.dialog.querySelector('md-filled-text-field').value
      cadleShell.projectStore.set(new TextEncoder().encode(cadleShell.projectName), {
        creationTime: new Date().getTime(),
        pages: []
      })

      cadleShell._projectsProvider.setValue([...cadleShell.projects, cadleShell.projectName])
      cadleShell.project = await cadleShell.projectStore.get(cadleShell.projectName)
      cadleShell.loadPage(cadleShell.project.pages[0]?.name)
      location.hash = '#!/draw'
    }

    if (action === 'open-project') {
      console.log(projectKey)

      await this.savePage()

      this.project = await getProjectData(projectKey)
      this.projectKey = projectKey
      console.log(this.project)
      const keys = Object.keys(this.project.pages)
      this.loadPage(keys[0])
      location.hash = '#!/draw'
      this.projectPane.select('project')
    }
  }

  async loadProject(projectKey, projectName) {
    this.dialog.addEventListener('close', this.#dialogAction)
    console.log(projectKey, projectName)

    cadleShell.dialog.dataset.key = projectKey

    cadleShell.dialog.innerHTML = `
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

    cadleShell.dialog.open = true
  }

  #getExportDimensions(orientation: A4Orientation) {
    return orientation === 'portrait' ? { width: 794, height: 1123 } : { width: 1123, height: 794 }
  }

  #getCanvasContentBounds(canvas: any) {
    const objects = canvas.getObjects().filter((obj: any) => obj.visible !== false)
    if (objects.length === 0) {
      return {
        objects,
        minLeft: 0,
        minTop: 0,
        maxRight: 0,
        maxBottom: 0,
        contentWidth: 1,
        contentHeight: 1
      }
    }

    let minLeft = Number.POSITIVE_INFINITY
    let minTop = Number.POSITIVE_INFINITY
    let maxRight = Number.NEGATIVE_INFINITY
    let maxBottom = Number.NEGATIVE_INFINITY

    for (const obj of objects) {
      const bounds = obj.getBoundingRect(true, true)
      minLeft = Math.min(minLeft, Number(bounds.left ?? 0))
      minTop = Math.min(minTop, Number(bounds.top ?? 0))
      maxRight = Math.max(maxRight, Number(bounds.left ?? 0) + Number(bounds.width ?? 0))
      maxBottom = Math.max(maxBottom, Number(bounds.top ?? 0) + Number(bounds.height ?? 0))
    }

    return {
      objects,
      minLeft,
      minTop,
      maxRight,
      maxBottom,
      contentWidth: Math.max(1, maxRight - minLeft),
      contentHeight: Math.max(1, maxBottom - minTop)
    }
  }

  #resolveBestOrientation(contentWidth: number, contentHeight: number, margin: number): A4Orientation {
    const landscape = this.#getExportDimensions('landscape')
    const portrait = this.#getExportDimensions('portrait')

    const landscapeZoom = Math.min(
      Math.max(1, landscape.width - margin * 2) / contentWidth,
      Math.max(1, landscape.height - margin * 2) / contentHeight
    )
    const portraitZoom = Math.min(
      Math.max(1, portrait.width - margin * 2) / contentWidth,
      Math.max(1, portrait.height - margin * 2) / contentHeight
    )

    return portraitZoom > landscapeZoom ? 'portrait' : 'landscape'
  }

  async exportA4PNG(orientation: A4Orientation | 'auto' = 'auto') {
    const canvas = this.field.canvas
    const exportMargin = 28
    const previousDimensions = {
      width: Number(canvas.getWidth() ?? 1123),
      height: Number(canvas.getHeight() ?? 794)
    }
    const previousViewportTransform = (canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0]).slice() as number[]
    const bounds = this.#getCanvasContentBounds(canvas)

    const resolvedOrientation: A4Orientation =
      orientation === 'auto'
        ? this.#resolveBestOrientation(bounds.contentWidth, bounds.contentHeight, exportMargin)
        : orientation
    const { width: exportWidth, height: exportHeight } = this.#getExportDimensions(resolvedOrientation)

    const exportMultiplier = Math.max(2, Math.ceil(window.devicePixelRatio || 1))

    try {
      canvas.setDimensions({ width: exportWidth, height: exportHeight })

      if (bounds.objects.length === 0) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      } else {
        const availableWidth = Math.max(1, exportWidth - exportMargin * 2)
        const availableHeight = Math.max(1, exportHeight - exportMargin * 2)
        const fitZoom = Math.max(
          0.1,
          Math.min(3, Math.min(availableWidth / bounds.contentWidth, availableHeight / bounds.contentHeight))
        )
        const translateX = exportWidth / 2 - (bounds.minLeft + bounds.contentWidth / 2) * fitZoom
        const translateY = exportHeight / 2 - (bounds.minTop + bounds.contentHeight / 2) * fitZoom

        canvas.setViewportTransform([fitZoom, 0, 0, fitZoom, translateX, translateY])
      }

      canvas.renderAll()

      const dataUrl = canvas.toDataURL({
        multiplier: exportMultiplier,
        quality: 100,
        format: 'png',
        width: exportWidth,
        height: exportHeight,
        enableRetinaScaling: true
      })

      return {
        dataUrl,
        orientation: resolvedOrientation,
        width: exportWidth,
        height: exportHeight
      }
    } finally {
      canvas.setDimensions(previousDimensions)
      canvas.setViewportTransform(previousViewportTransform)
      canvas.renderAll()
    }
  }

  async toPNG() {
    const exported = await this.exportA4PNG('landscape')
    return exported.dataUrl
  }

  async downloadAsPNG(name) {
    const dataUrl = await this.toPNG()
    // const url = URL.createObjectURL(blob);
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${this.projectName}-${name}.png`
    a.click()
  }

  get drawer() {
    return this.renderRoot.querySelector('.left-rail')
  }

  async savePage() {
    if (this.loadedPage) {
      this.project.pages[this.loadedPage].schema = this.renderRoot.querySelector('draw-field').toJSON()
      console.log(this.project)
      console.log(this.projectKey)

      await setProjectData(this.projectKey, this.project)
    }
  }

  async loadPage(key: string) {
    this.loadedPage = key
    const page = this.project.pages[key]
    console.log(page, key)

    await this.renderRoot.querySelector('draw-field').fromJSON(page.schema || {})
    this.#refreshBoundOneLineCatalog()
  }

  undo() {
    this.renderRoot.querySelector('draw-field').canvas.undo()
  }

  redo() {
    this.renderRoot.querySelector('draw-field').canvas.undo()
  }

  importShare = () => {
    // if (this.projects)
  }

  showShortcuts = async () => {
    if (!customElements.get('keyboard-shortcuts')) await import('./screens/keyboard-shortcuts.js')
    this.shadowRoot.querySelector('keyboard-shortcuts').open = true
  }

  pickColor = async (): Promise<Color> => {
    await this.updateComplete
    return new Promise(async (resolve, reject) => {
      const picker = this.renderRoot.querySelector('input[type="color"]') as HTMLInputElement
      const pickerDialog = this.renderRoot.querySelector('.color-picker') as HTMLFormElement
      pickerDialog.addEventListener('close', () => {
        if (pickerDialog.returnValue === 'confirm-color') {
          const color = picker.value as Color
          state.styling.fill = color
          this.actions.fill = color
          this._currentColor = color
          resolve(color)
        }
      })
      await pickerDialog.show()
      picker.click()
    })
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        --custom-top-app-bar-height: 64px;
      }

      .layout {
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr) 320px;
        grid-template-rows: 1fr;
        width: 100%;
        height: 100%;
        min-height: 0;
      }

      .left-rail,
      .right-rail {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--md-sys-color-surface);
      }

      .left-rail {
        border-right: 1px solid var(--md-sys-color-outline-variant);
        box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
      }

      cadle-header project-actions {
        width: 100%;
      }

      .right-rail {
        border-left: 1px solid var(--md-sys-color-outline-variant);
        box-shadow: -2px 0 8px rgba(0, 0, 0, 0.06);
      }

      .center-stage {
          background: var(--md-sys-color-background);
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      }

      .left-rail project-pane,
      .right-rail object-pane {
        position: static !important;
        top: auto !important;
        right: auto !important;
        bottom: auto !important;
        width: 100% !important;
        height: 100% !important;
      }

      .right-rail object-pane {
        border-left: 0;
      }

      section {
        display: flex;
        flex-direction: column;
      }

      custom-pages {
        display: flex;
        width: 100%;
        height: calc(100% - 1px);
        min-width: 0;
        min-height: 0;
      }

      draw-field,
      save-field,
      projects-field,
      home-field,
      add-page-field,
      create-project-field,
      settings-field {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
      }

      flex-row.main {
        width: calc(100% - 2px);
        height: calc(100% - 64px);
      }

      .file-controls {
        width: 230px;
        pointer-events: auto;
      }

      input[type='color'] {
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
      }

      custom-tabs {
        width: 100%;
        padding: 12px 16px 0 16px;
        justify-content: center;
        border-top: 1px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface);
      }

      custom-tab {
        pointer-events: auto;
      }

      custom-tab custom-icon {
        margin-right: 6px;
      }

      @media (max-width: 1280px) {
        .layout {
          grid-template-columns: 280px minmax(0, 1fr) 280px;
        }
      }

      @media (max-width: 1024px) {
        .layout {
          grid-template-columns: 260px minmax(0, 1fr);
        }

        .right-rail {
          display: none;
        }
      }
    `
  ]

  deletePage(pageName) {
    let i = 0
    for (const page of this.project.pages) {
      if (page.name === pageName) {
        this.project.pages.splice(i, 1)
        break
      }
      i += 1
    }
  }

  render() {
    return html`
      <md-dialog></md-dialog>

      <custom-icon-set>
        <template>
          <span name="abc">@symbol-abc</span>
          <span name="add">@symbol-add</span>
          <span name="check_box">@symbol-check_box</span>
          <span name="check_box_outline_blank">@symbol-check_box_outline_blank</span>
          <span name="delete">@symbol-delete</span>
          <span name="check">@symbol-check</span>
          <span name="menu">@symbol-menu</span>
          <span name="menu_open">@symbol-menu_open</span>
          <span name="shapes">@symbol-shapes</span>
          <span name="folder">@symbol-folder</span>
          <span name="keyboard">@symbol-keyboard</span>
          <span name="undo">@symbol-undo</span>
          <span name="redo">@symbol-redo</span>
          <span name="arrow_selector_tool">@symbol-arrow_selector_tool</span>
          <span name="grid_on">@symbol-grid_on</span>
          <span name="grid_off">@symbol-grid_off</span>
          <span name="draw">@symbol-draw</span>
          <span name="square">@symbol-square</span>
          <span name="circle">@symbol-circle</span>
          <span name="line_curve">@symbol-line_curve</span>
          <span name="horizontal_rule">@symbol-horizontal_rule</span>
          <span name="insert_text">@symbol-insert_text</span>
          <span name="tree_closed">@symbol-keyboard_arrow_right</span>
          <span name="tree_open">@symbol-keyboard_arrow_down</span>
          <span name="polyline">@symbol-polyline</span>
          <span name="save">@symbol-save</span>
          <span name="create_new_folder">@symbol-create_new_folder</span>
          <span name="folder_open">@symbol-folder_open</span>
          <span name="upload_file">@symbol-upload_file</span>
          <span name="download">@symbol-download</span>
          <span name="swap-vert">@symbol-swap_vert</span>
          <span name="swap-horiz">@symbol-swap_horiz</span>
          <span name="share">@symbol-share</span>
          <span name="more_vert">@symbol-more_vert</span>
          <span name="keyboard_arrow_down">@symbol-keyboard_arrow_down</span>
          <span name="keyboard_arrow_up">@symbol-keyboard_arrow_up</span>
          <span name="palette">@symbol-palette</span>
          <span name="border_color">@symbol-border_color</span>
          <span name="format_color_fill">@symbol-format_color_fill</span>
          <span name="opacity">@symbol-opacity</span>
          <span name="place_item">@symbol-place_item</span>
          <span name="output">@symbol-output</span>
          <span name="format_size">@symbol-format_size</span>
          <span name="open_with">@symbol-open_with</span>
          <span name="format_bold">@symbol-format_bold</span>
          <span name="format_italic">@symbol-format_italic</span>
          <span name="format_underlined">@symbol-format_underlined</span>
          <span name="format_align_center">@symbol-format_align_center</span>
          <span name="format_align_justify">@symbol-format_align_justify</span>
          <span name="format_align_left">@symbol-format_align_left</span>
          <span name="format_align_right">@symbol-format_align_right</span>
          <span name="format_indent_increase">@symbol-format_indent_increase</span>
          <span name="format_indent_decrease">@symbol-format_indent_decrease</span>
          <span name="format_list_bulleted">@symbol-format_list_bulleted</span>
          <span name="format_list_numbered">@symbol-format_list_numbered</span>
          <span name="format_quote">@symbol-format_quote</span>
          <span name="format_strikethrough">@symbol-format_strikethrough</span>
          <span name="format_clear">@symbol-format_clear</span>
          <span name="format_color_text">@symbol-format_color_text</span>
          <span name="format_paint">@symbol-format_paint</span>
          <span name="format_shapes">@symbol-format_shapes</span>
          <span name="format_size">@symbol-format_size</span>
          <span name="format_textdirection_l_to_r">@symbol-format_textdirection_l_to_r</span>
          <span name="format_textdirection_r_to_l">@symbol-format_textdirection_r_to_l</span>
          <span name="window">@symbol-window</span>
          <span name="width">@symbol-width</span>
          <span name="height">@symbol-height</span>
          <span name="measuring_tape">@symbol-measuring_tape</span>
          <span name="door_front">@symbol-door_front</span>
          <span name="polyline">@symbol-polyline</span>
          <span name="zoom_in">@symbol-zoom_in</span>
          <span name="resize">@symbol-resize</span>
        </template>
      </custom-icon-set>

      <section class="layout">
        <aside class="left-rail">
          <cadle-header>
            <project-actions></project-actions>
          </cadle-header>

          <project-pane
            .manifest=${this.manifest}
            .project=${this.project}></project-pane>

          <custom-tabs
            round
            attr-for-selected="route"
            default-selected="symbols"
            @selected=${(e) => this.projectPane.select(e.detail)}>
            <custom-tab route="project"><custom-icon icon="folder"></custom-icon>project</custom-tab>
            <custom-tab route="symbols"><custom-icon icon="format_shapes"></custom-icon>symbols</custom-tab>
          </custom-tabs>
        </aside>

        <main class="center-stage">
          <cadle-header><cadle-actions></cadle-actions></cadle-header>
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
