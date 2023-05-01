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
import { projectContext, Project } from './context/project-context.js';
import { provide } from '@lit-labs/context';

@customElement('app-shell')

export class AppShell extends LitElement {
  symbol: string

  @property({ type: String })
  action: string

  @provide({context: projectContext})
  @property({attribute: false})
  public project: Project = { pages: [], symbols: [] }

  @property({ type: Object })
  manifest: {}


  constructor() {
    super()
  }

  async connectedCallback(): void {
    super.connectedCallback()
    await this.updateComplete
    await Promise.all([
      import('./controllers/routing.js'),
      import('./controllers/mouse.js'),
      import('./controllers/keyboard.js'),
      (async () => {
        // this.project.symbols = (await import('../www/symbols/manifest.js')).default
      })()
    ])
    
    this.requestUpdate()

    
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

  get drawer() {
    return this.renderRoot.querySelector('project-drawer')
  }

  static styles = [
    css`
      :host {
        display: flex;
      }

      section {
        display: flex;
        flex-direction: column;
      }
    `
  ];

  render() {
    return html`
    <project-drawer .manifest=${this.manifest} .project=${this.project}>
      <flex-row>
        <md-standard-icon-button @click="${() => (this.action = 'draw')}">draw</md-standard-icon-button>
        <md-standard-icon-button @click="${() => (this.action = 'draw-square')}">square</md-standard-icon-button>
        <md-standard-icon-button @click="${() => (this.action = 'draw-circle')}">circle</md-standard-icon-button>
        <md-standard-icon-button @click="${() => (this.action = 'draw-arc')}">line_curve</md-standard-icon-button>
        <md-standard-icon-button @click="${() => (this.action = 'draw-line')}">horizontal_rule</md-standard-icon-button>
        <md-standard-icon-button @click="${() => (this.action = 'draw-text')}">insert_text</md-standard-icon-button>
      </flex-row>
      <flex-row>
      
        <md-standard-icon-button @click="${() => (this.action = 'select')}">arrow_selector_tool</md-standard-icon-button>
        <md-standard-icon-button @click="${this.download.bind(this)}">download</md-standard-icon-button>
      </flex-row>
    </project-drawer>
    <custom-pages attr-for-selected="data-route">
      <home-field data-route="home"></home-field>
      <draw-field data-route="draw"></draw-field>
      <save-field data-route="save"></save-field>
      <add-page-field data-route="add-page"></add-page-field>
    </custom-pages>
    `;
  }
}