import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js'
import '@material/web/button/tonal-button.js'
import '@material/web/iconbutton/standard-icon-button.js'
import '@material/web/list/list.js'
import '@material/web/list/list-item-link.js'
import '@vandeurenglenn/lit-elements/pages.js'
import {DrawField} from './fields/draw.js'
import './fields/draw.js'
import './elements/save-field.js'
import './elements/project-drawer.js'
import '@vandeurenglenn/flex-elements'
import { projectContext, Project, Page } from './context/project-context.js';
import { provide } from '@lit-labs/context';
import ProjectsStore from './storage/projects.js'
import { Projects, projectsContext } from './context/projects.js';
import { Catalog, catalogContext } from './context/catalog.js';
import '@material/web/dialog/dialog.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/icon/icon.js'
import { ContextProvider } from '@lit-labs/context';
import { IText } from 'fabric';
import './elements/actions/actions.js'
import '@vandeurenglenn/lit-elements/drawer-layout.js'
import '@vandeurenglenn/lit-elements/theme.js'

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
  var cadleShell: AppShell
}

declare type dialogAction = 'create-project' | 'open-project' | 'create-page' | 'rename-project' | 'rename-page' | 'confirm-input'

@customElement('app-shell')
export class AppShell extends LitElement {
  projectsStore: ProjectsStore
  symbol: string
  projectName: string
  inputType: 'wcd' | 'normal' = 'normal'
  lastNumber: number
  currentText: string

  @query('cadle-actions')
  actions

  @property({ type: String })
  action: string


  @property({ type: Object })
  manifest: {}

  @property({type: Boolean})
  freeDraw: boolean = false
  


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

  @provide({context: catalogContext})
  @property({attribute: false})
  catalog: Catalog

  private _projectsProvider = new ContextProvider(this, {context: projectsContext, initialValue: []});
  private _projectProvider = new ContextProvider(this, {context: projectContext});

  constructor() {
    super()
    globalThis.cadleShell = this
  }

  #toggleInputType = () => {
    if (this.inputType === 'normal') this.inputType = 'wcd'
    else this.inputType = 'normal'
  }

  async connectedCallback(): Promise<void> {
    this.projectsStore = new ProjectsStore()
    super.connectedCallback()
    
    const decoder = new TextDecoder()
    const keys = await this.projectsStore.keys()
    const projects = []
    for (const key of keys) {
      projects.push(decoder.decode(key))
    }

    this.projects = projects

    await Promise.all([
      import('./controllers/routing.js'),
      import('./controllers/mouse.js'),
      import('./controllers/keyboard.js')
    ])

    // @ts-ignore
    this.catalog = (await import('./symbols/manifest.js')).default
    
    await this.requestUpdate('projects')
    this.dialog.addEventListener('closed', this.#dialogAction)
  }


  get dialog() {
    return this.renderRoot.querySelector('md-dialog')
  }
  
  get pages() {
    return this.renderRoot.querySelector('custom-pages')
  }

  #dialogAction = async (event: CustomEvent) => {
    const action: dialogAction = event.detail.action
    if (action === 'confirm-input') {
      const value = this.dialog.querySelector('md-filled-text-field').value
      const match = value.match(/\d+/g)
      if (match?.length > 0) {
        const number = Number(match.join(''))
        cadleShell.lastNumber = number
      }
      cadleShell.currentText = value
    }
    
    if (action === 'create-project') {

      this.projectName = this.dialog.querySelector('md-filled-text-field').value
      this.projectsStore.set(new TextEncoder().encode(this.projectName), {creationTime: new Date().getTime(), pages: []})
      
      this._projectsProvider.setValue([...this.projects, this.projectName])
      this.project = await this.projectsStore.get(this.projectName)
      this.loadPage(this.project.pages[0]?.name)
      location.hash = '#!/draw'
    }

    if (action === 'open-project') {
      this.projectName = this.dialog.querySelector('md-filled-text-field').value
      console.log(this.projectName);
      
      this.project = await this.projectsStore.get(new TextEncoder().encode(this.projectName))
      this.loadPage(this.project.pages[0]?.name)
      location.hash = '#!/draw'
    }
      
  }
 
  async createProject() {
    this.dialog.innerHTML = `
    
      <md-filled-text-field
        label="Project name"
        dialogFocus>
      </md-filled-text-field>

      <md-filled-button slot="footer"dialog-action="create-project">
        create
      </md-filled-button>
    
    `

    this.dialog.open = true
  }

  async loadProject(projectKey) {
    this.dialog.innerHTML = `

      <flex-column>
        <p>Are you sure you want to open ${projectKey}?</p>
        <small>make sure you saved your open project</small>
        <md-filled-text-field
          label="Project name"
          value="${projectKey}"
          dialogFocus>
        </md-filled-text-field>
      </flex-column>
    
      <flex-row slot="footer" style="width: 100%;">
        <md-outlined-button dialog-action="cancel-open-project">
          cancel
        </md-outlined-button>
        <flex-one></flex-one>
        <md-filled-button dialog-action="open-project">
          open
        </md-filled-button>

      </flex-row>
    
    `

    this.dialog.open = true
  }

  async uploadProject() {
    
  }
 
  
  async download() {
    const fields: DrawField[] = Array.from(this.renderRoot.querySelectorAll('draw-field'))
    for (const field of fields) {
      const json = field.toJSON()
      console.log(json);
      // await this.renderRoot.querySelector('draw-field').loadFromJSON(json)

      const url = this.renderRoot.querySelector('draw-field').toDataURL()
    console.log(url);
    const a = document.createElement('a')
    a.href = url
    a.download = `${this.loadedPage}.png`
    a.click()
    
    }
  }

  async save() {
    await this.savePage()
    this.projectsStore.set(new TextEncoder().encode(this.projectName), this.project)
  }

  get drawer() {
    return this.renderRoot.querySelector('custom-drawer-layout').shadowRoot.querySelector('custom-drawer')
  }
  async savePage() {
    if (this.loadedPage) { 
      const pageToSave = this.project.pages.filter(page => page.name === this.loadedPage)[0]
      const pageIndex = this.project.pages.indexOf(pageToSave)

      this.project.pages[pageIndex].schema = this.renderRoot.querySelector('draw-field').toJSON()
    }
  }

  async loadPage(name: string) {
    
    await this.savePage()

    this.loadedPage = name
    const page = this.project.pages.filter(page => page.name === name)[0]
    
    this.renderRoot.querySelector('draw-field').fromJSON(page.schema)
  }

  undo() {
    this.renderRoot.querySelector('draw-field').canvas.undo()
  }

  redo() {
    this.renderRoot.querySelector('draw-field').canvas.undo()
  }

  drawText() {
    this.action = 'draw-text'
    this.renderRoot.querySelector('draw-field')._current = new IText('Tap and Type', { 
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      left: globalThis.currentMousePosition.x - this.drawer.getBoundingClientRect().width,
      top: globalThis.currentMousePosition.y
    })
  }
 
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
      }

      section {
        display: flex;
        flex-direction: column;
      }

      header {
        display: flex;
        width: 100%;
        height: 48px;
        align-items: center;
      }

      custom-pages {
        display: flex;
      }

      

      flex-row.main {
        width: calc(100% - 2px);
        height: calc(100% - 50px);
      }

      .file-controls {
        width: 230px;
        pointer-events: auto;
      }
    `
  ];

  render() {
    return html`

    <md-dialog>
    </md-dialog>
    
    <custom-theme load-symbols="false"></custom-theme>
    
    <custom-drawer-layout>  
      <flex-row class="file-controls" slot="drawer-headline" style="height: 40px;">
        <custom-button 
          title="create project"
          @click=${this.createProject}>
          <custom-icon-font slot="icon">create_new_folder</custom-icon-font>
        </custom-button>

        <custom-button 
          title="upload project"
           @click=${this.uploadProject}>
          <custom-icon-font slot="icon">upload_file</custom-icon-font>
        </custom-button>

        <custom-button 
          title="download project"
           @click=${this.download.bind(this)}>
          <custom-icon-font slot="icon">download</custom-icon-font>
        </custom-button>

        <custom-button 
          title="save project"
          @click=${this.save.bind(this)}>
          <custom-icon-font slot="icon">save</custom-icon-font>
        </custom-button>

        <custom-button 
          title="show projects"
           href="#!/projects">
          <custom-icon-font slot="icon">folder_open</custom-icon-font>
        </custom-button>
      </flex-row>
      
      <project-drawer .manifest=${this.manifest} .project=${this.project} slot="drawer-content"></project-drawer>
      
      <header  slot="top-app-bar-end">
        <cadle-actions></cadle-actions>
      </header>

      <custom-pages attr-for-selected="data-route">
        <home-field data-route="home"></home-field>
        <draw-field data-route="draw"></draw-field>
        <save-field data-route="save"></save-field>
        <add-page-field data-route="add-page"></add-page-field>
        <projects-field data-route="projects"></projects-field>
      </custom-pages>
    </custom-drawer-layout>

    <flex-row class="main">
    
    </flex-row>
    `;
  }
}