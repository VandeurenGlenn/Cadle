import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js'
import { consume } from '@lit-labs/context';
import { Project, projectContext } from '../../context/project-context.js';
import '@material/web/textfield/outlined-text-field.js'
import '@material/web/iconbutton/filled-icon-button.js'
import '@vandeurenglenn/lit-elements/drawer-item.js'
import '@vandeurenglenn/lit-elements/selector.js'
import '@vandeurenglenn/lit-elements/button.js'
import '@vandeurenglenn/lit-elements/dropdown.js'
import '@vandeurenglenn/lit-elements/list-item.js'
import './../list/item.js'
import './contextmenu.js'

declare global {
  interface HTMLElementTagNameMap {
    'project-element': ProjectElement;
  }
}

@customElement('project-element')
export class ProjectElement extends LitElement {

  @consume({context: projectContext, subscribe: true})
  @property({attribute: false})
  @state()
  project: Project
  
  @query('.page-input')
  pageInput: HTMLInputElement

  set addingPage(value: boolean) {
    if (value !== this.addingPage)
    if (value) {
      this.pageInput.value = ''
      this.setAttribute('addingPage', '')
      this.pageInput.focus()
      this.addEventListener('keydown', this.#keydown.bind(this))
    }
    else {
      this.removeAttribute('addingPage')
      this.handleInput()
    }
    this.requestUpdate('addingPage')
  }

  async handleInput() {
    const page: string = this.pageInput.value
    if (page.length > 0) {
      const project = cadleShell.project
      project.pages.push({name: page, schema: {}, creationTime: new Date().getTime()})
      cadleShell.project = project
      await cadleShell.save.bind(cadleShell)()
      this.#cleanupListeners()
      this.pageInput.value = ''
    }
    
  }

  async #keydown(event) {
    if (event.key === 'Escape') {
      this.addingPage = false
      this.renderRoot.querySelector('.add-page').selected = false
    } else if (event.key === 'Enter') {
      await this.handleInput()
      this.addingPage = false
      this.renderRoot.querySelector('.add-page').selected = false
    }
  }

  #cleanupListeners() {
    this.removeEventListener('keydown', this.#keydown)
  }

  #showMenu = (event) => {
    event.preventDefault()
    const menu = this.renderRoot.querySelector('context-menu')
    menu.open = !menu.open
  }

  get addingPage() {
    return this.hasAttribute('addingPage')
  }

  connectedCallback(): void {
    super.connectedCallback()
    this.addEventListener("contextmenu", this.#showMenu);
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
      }

      .page-input {

        pointer-events: none;
        opacity: 0;
        padding: 3px;
        outline: 1px solid #eee;
        border: none;
        background: var(--md-sys-color-surface, #fef7ff);
      }

      :host([addingPage]) .page-input {
        pointer-events: auto;
        opacity: 1;
      }

      .add-container {
        box-sizing: border-box;
        padding: 12px 24px;
        align-items: center;
        bottom: 12px;
        right: 12px;
        width: 240px;
      }

      .input-container {
        box-sizing: border-box;
        padding: 12px 24px;
        align-items: center;
      }
    `
  ];

 
  get #projectTemplate() {
    return this.project.pages.map(item => html`
      <custom-drawer-item .headline=${item.name} data-project=${item.name} @click=${(event) => { cadleShell.loadPage(item.name); location.hash = '#!/draw'}}>${item.name}</custom-drawer-item>
    `)
  }

  render() {
    return html`
        <context-menu>
          <custom-list-item type="menu">
            <custom-icon-font slot="start">delete</custom-icon-font>
            delete
          </custom-list-item>
        </context-menu>
        
        <custom-selector>
          ${this.project?.pages?.length > 0 ? this.#projectTemplate : ''}
        </custom-selector>
      

      <flex-row class="input-container">
        <input class="page-input">
        <flex-one></flex-one>
        <custom-icon-button class="add-page" @click=${() => this.addingPage = !this.addingPage}>${this.addingPage ? 'done' : 'add'}</custom-icon-button>
      </flex-row>
      

    `;
  }
}
