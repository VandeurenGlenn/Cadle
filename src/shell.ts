import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js'
import '@material/web/button/filled-tonal-button.js'
import '@material/web/iconbutton/icon-button.js'
import '@material/web/list/list.js'
import '@material/web/list/list-item.js'
import '@vandeurenglenn/lit-elements/pages.js'
import {DrawField} from './fields/draw.js'
import './fields/draw.js'
import './elements/save-field.js'
import './elements/project-drawer.js'
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
import '@vandeurenglenn/lit-elements/drawer-layout.js'
import '@vandeurenglenn/lit-elements/theme.js'
import state from './state.js';
import { Color } from './symbols/default-options.js';

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
  loadedPage: string

  @query('cadle-actions')
  actions

  @query('draw-field')
  field

  @query('custom-drawer-layout')
  drawerLayout

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

  #beforePrint = (e: Event) => {
    this.drawerLayout.drawerOpen = false
    this.drawerLayout.keepClosed = true
    this.actions.hide()
    this.field.style.position = 'fixed'
    this.field.style.left = '0'
    // const {width, height} = this.getBoundingClientRect()
    // this.field.canvas.setWidth(width)
    // this.field.canvas.setHeight(height)
    this.field.canvas.renderAll()
      var dataUrl = this.field.canvas.toDataURL(); //attempt to save base64 string to server using this var  
      var windowContent = '<!DOCTYPE html>';
      windowContent += '<html>'
      windowContent += '<head><title>Print Cadle Project</title></head>';
      windowContent += '<body>'
      windowContent += '<img style="width: 100%;" src="' + dataUrl + '" onload=window.print();>';
      windowContent += '</body>';
      windowContent += '</html>';
      var printWin = window.open('', '', 'width=340,height=260');
      printWin.document.open();
      printWin.document.write(windowContent);
  }
   

  #afterPrint = () => {
    
    this.drawerLayout.drawerOpen = true
    this.drawerLayout.keepClosed = false
    this.field.style.position = 'absolute'
    this.field.style.left = 'auto'
    this.actions.show()
    this.field.canvas.renderAll()
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
      
      import('./elements/actions/actions.js'),
      import('./controllers/routing.js'),
      // import('./controllers/mouse.js'),
      import('./controllers/keyboard.js')
    ])

    // @ts-ignore
    this.catalog = (await import('./symbols/manifest.js')).default
    
    await this.requestUpdate('projects')

    addEventListener("beforeprint", this.#beforePrint);
    addEventListener("afterprint", this.#afterPrint);

    await this.updateComplete

    this.dialog.addEventListener('close', this.#dialogAction)
    
    
  }


  get dialog() {
    return this.renderRoot.querySelector('md-dialog')
  }
  
  get pages() {
    return this.renderRoot.querySelector('custom-pages')
  }

  #dialogAction = async (event: Event) => {
    console.log(event.returnValue);
    console.log(event);

    console.log(event.returnValue);
    
    
    const action: dialogAction = this.dialog.returnValue as dialogAction
    if (action === 'confirm-input') {
      const value = this.dialog.querySelector('md-filled-text-field').value
      const match = value.match(/\d+/g)
      if (match?.length > 0) {
        const number = Number(match.join(''))
        state.text.lastNumber = number
      }
      state.text.current = value
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

      <form id="form" slot="content" method="dialog">
        <md-filled-text-field
          label="Project name"
          dialogFocus>
        </md-filled-text-field>
      </form>

      <flex-row slot="actions">
        <md-filled-button form="form" value="create-project">
          create
        </md-filled-button>
      </flex-row>
    `

    this.dialog.open = true
  }

  async loadProject(projectKey) {
    this.dialog.innerHTML = `
      <form id="load" slot="content" method="dialog">
        <flex-column>
          <p>Are you sure you want to open ${projectKey}?</p>
          <small>make sure you saved your open project</small>
          <md-filled-text-field
            label="Project name"
            value="${projectKey}"
            dialogFocus>
          </md-filled-text-field>
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

  pickColor(): Promise<Color> {
    return new Promise((resolve, reject) => {
      const picker = this.renderRoot.querySelector('input[type="color"]')
      const pickerDialog = this.renderRoot.querySelector('.color-picker')
      pickerDialog.addEventListener('close', () => {
        if (pickerDialog.returnValue === 'confirm-color') {
          resolve(picker.value)
        }
        
      })

      pickerDialog.show()
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

      input[type="color"] {
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%)
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
      
      <cadle-actions slot="top-app-bar-end"></cadle-actions>

      <custom-pages attr-for-selected="data-route">
        <home-field data-route="home"></home-field>
        <draw-field data-route="draw"></draw-field>
        <save-field data-route="save"></save-field>
        <add-page-field data-route="add-page"></add-page-field>
        <projects-field data-route="projects"></projects-field>
      </custom-pages>
    </custom-drawer-layout>
    
    <md-dialog class="color-picker">      
      <form id="pick-color" slot="content" method="dialog">
        <flex-it></flex-it>
        <flex-row>
          <input
            type="color"
            label="color"
            value="${state.styling.fill}"
            dialogFocus/>
          <flex-it></flex-it>
        </flex-row>
      </form>
      <div slot="actions">
        <md-filled-button form="pick-color" value="confirm-color">
          done
        </md-filled-button>
      </div>
    </md-dialog>
    
    `;
  }
}