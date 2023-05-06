import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import '@material/web/button/tonal-button.js'
import '@material/web/iconbutton/standard-icon-button.js'
import '@material/web/list/list.js'
import '@material/web/list/list-item-link.js'
import '@material/web/navigationtab/navigation-tab.js'
import 'custom-tabs/custom-tabs.js'
import 'custom-tabs/custom-tab.js'
import 'custom-pages'
import {DrawField} from './elements/draw-field.js'
import './elements/draw-field.js'
import './elements/save-field.js'
import './elements/project-drawer.js'
import '@vandeurenglenn/flex-elements'
import { map } from 'lit/directives/map.js';
import { projectContext, Project, Page } from './context/project-context.js';
import { provide } from '@lit-labs/context';
import ProjectsStore from './storage/projects.js'
import { Projects, projectsContext } from './context/projects.js';
import { Catalog, catalogContext } from './context/catalog.js';
import '@material/web/dialog/dialog.js'
import '@material/web/textfield/filled-text-field.js'
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import { ContextProvider } from '@lit-labs/context';

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
  const cadleShell: AppShell
}

declare type dialogAction = 'create-project' | 'open-project' | 'create-page' | 'rename-project' | 'rename-page' 

@customElement('app-shell')
export class AppShell extends LitElement {
  projectsStore: ProjectsStore
  symbol: string
  projectName: string

  @property({ type: String })
  action: string


  @property({ type: Object })
  manifest: {}

  @property({type: Boolean})
  freeDraw: false



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

  private _projectsProvider = new ContextProvider(this, projectsContext);
  private _projectProvider = new ContextProvider(this, projectContext);

  constructor() {
    super()
    globalThis.cadleShell= document.querySelector('app-shell')
  }

  async connectedCallback(): void {
    this.projectsStore = new ProjectsStore()
    super.connectedCallback()
    await this.updateComplete
    
    await Promise.all([
      import('./controllers/routing.js'),
      import('./controllers/mouse.js'),
      import('./controllers/keyboard.js')
    ])

    this.catalog = (await import('./symbols/manifest.js')).default
    
    this.projects = await this.projectsStore.keys()
    
    // this.requestUpdate()
    this.dialog.addEventListener('closed', this.#dialogAction.bind(this))
    
  }


  get dialog() {
    return this.renderRoot.querySelector('md-dialog')
  }
  
  get pages() {
    return this.renderRoot.querySelector('custom-pages')
  }

  async #dialogAction(event: CustomEvent) {
      const action: dialogAction = event.detail.action
      console.log(action);
      
      if (action === 'create-project') {

        this.projectName = this.dialog.querySelector('md-filled-text-field').value
        this.projectsStore.set(this.projectName, {creationTime: new Date().getTime(), pages: []})
        
        this._projectsProvider.setValue([...this.projects, this.projectName])
        this.project = await this.projectsStore.get(this.projectName)
        this.loadPage(this.project.pages[0]?.name)
        location.hash = '#!/draw'
      }

      if (action === 'open-project') {
        this.projectName = this.dialog.querySelector('md-filled-text-field').value
        
        this.project = await this.projectsStore.get(this.projectName)
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

      <md-filled-button slot="footer"dialogAction="create-project">
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
          value=${projectKey}
          dialogFocus>
        </md-filled-text-field>
      </flex-column>
    
      <flex-row slot="footer" style="width: 100%;">
        <md-outlined-button dialogAction="cancel-open-project">
          cancel
        </md-outlined-button>
        <flex-one></flex-one>
        <md-filled-button dialogAction="open-project">
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
      await this.renderRoot.querySelector('save-field').loadFromJSON(json)

      const url = this.renderRoot.querySelector('save-field').toDataURL()
    console.log(url);
    
    }
  }

  async save() {
    console.log(this.projectName);
    await this.savePage()
    this.projectsStore.set(this.projectName, this.project)
  }

  get drawer() {
    return this.renderRoot.querySelector('project-drawer')
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

      flex-row.main {
        width: calc(100% - 2px);
        height: calc(100% - 50px);
      }

      .file-controls {
        width: 230px;
      }
    `
  ];

  render() {
    return html`

    <md-dialog>
    </md-dialog>

    <header>
      <flex-row class="file-controls">
        <md-standard-icon-button title="create project" @click=${this.createProject}>create_new_folder</md-standard-icon-button>
        <md-standard-icon-button title="upload project"  @click=${this.uploadProject}>upload_file</md-standard-icon-button>
        <md-standard-icon-button title="download project"  @click=${this.download.bind(this)}>download</md-standard-icon-button>
        <md-standard-icon-button title="save project" @click=${this.save.bind(this)}>save</md-standard-icon-button>
        <md-standard-icon-button title="show projects"  href="#!/projects">folder_open</md-standard-icon-button>
      </flex-row>

      <md-standard-icon-button @click="${() => (this.action = 'select')}">arrow_selector_tool</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.freeDraw = !this.freeDraw)}" toggle>
        grid_on
        <span slot="selectedIcon">grid_off</span>
      </md-standard-icon-button>
      <flex-one></flex-one>
      <md-standard-icon-button @click="${() => (this.action = 'draw')}">draw</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.action = 'draw-square')}">square</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.action = 'draw-circle')}">circle</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.action = 'draw-arc')}">line_curve</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.action = 'draw-line')}">horizontal_rule</md-standard-icon-button>
      <md-standard-icon-button @click="${() => (this.action = 'draw-text')}">insert_text</md-standard-icon-button>
    </header>


    <flex-row class="main">
    <project-drawer .manifest=${this.manifest} .project=${this.project}>
      
    </project-drawer>
      <custom-pages attr-for-selected="data-route">
        <home-field data-route="home"></home-field>
        <draw-field data-route="draw"></draw-field>
        <save-field data-route="save"></save-field>
        <add-page-field data-route="add-page"></add-page-field>
        <projects-field data-route="projects"></projects-field>
      </custom-pages>
    </flex-row>
    `;
  }
}