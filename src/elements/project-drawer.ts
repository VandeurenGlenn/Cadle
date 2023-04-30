import { LitElement, html, css } from 'lit';
import { map } from 'lit/directives/map.js';
import { customElement, property } from 'lit/decorators.js'
import {consume} from '@lit-labs/context';
import {Project, projectContext} from './../context/project-context.js';
import'@material/web/list/list-item.js'
import'@material/web/menu/sub-menu-item.js'
import { loadSVGFromURL, util } from 'fabric';

@customElement('project-drawer')

export class ProjectDrawer extends LitElement {

  @consume({context: projectContext, subscribe: true})
  @property({attribute: false})
  
  public get project() {
    return this._project
  }
  public set project(v : Project) {
    this._project = v;
    this.requestUpdate()
  }

  private _project
  

  get #pages() {
    return this.renderRoot.querySelector('custom-pages')
  }

  set action(value) {
    document.querySelector('app-shell').action = value
  }

  set symbol(value) {
    document.querySelector('app-shell').symbol = value
  }
  static styles = [
    css`
      :host {
        display: block;
        --md-list-item-list-item-container-color: #fff;
        --md-list-item-list-item-leading-avatar-color: #fff;
        --md-list-item-list-item-leading-avatar-shape: 0
      }

      aside {
        width: 230px;
        height: 100%;
        display: flex;
        position: relative;
        flex-direction: column;
      }
      section {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
    `
  ];

  _dragstart(e) {
    console.log(e);
    
  }

  render() {
    return html`
      <aside opened>
        <custom-tabs attr-for-selected="data-route" @selected=${(e) => this.#pages.select(e.detail)}>
          <custom-tab data-route="project"><span>project</span></custom-tab>
          <custom-tab data-route="symbols"><span>symbols</span></custom-tab>
        </custom-tabs>

        <custom-pages attr-for-selected="data-route">
        <section  data-route="project">
          ${this.project?.pages ? map(Object.entries(this.project.pages), item => html`
            <md-list-item .headLine="${item}">
              <md-sub-menu-item>${item}</md-sub-menu-item>
              <flex-one></flex-one>
              <md-standard-icon-button data-variant="icon" toggle slot="end" aria-label="expand_more" selected-aria-label="expand_less">expand_more <span slot="selectedIcon">expand_less</span></md-standard-icon-button>
          </md-list-item>
          `) : ''}
            
          
            
            <md-standard-icon-button href="#!/add-page">add</md-standard-icon-button>
          </span>
        </section>

        <section data-route="symbols">
          ${this.project?.symbols ? map(this.project.symbols, ({category,  symbols}) => html`
            <md-list-item .headline="${category}">
              
              <flex-one></flex-one>
              <md-standard-icon-button data-variant="icon" toggle slot="end" aria-label="expand_more" selected-aria-label="expand_less">expand_more <span slot="selectedIcon">expand_less</span></md-standard-icon-button>

              
             
          </md-list-item>
          ${map(symbols, item => html`
          
          <md-list-item .headline="${item}">
            <img data-variant="image" slot="end" draggable="true" src="./symbols/${category}/${item}" @click="${() => {
              this.action = 'draw-symbol'
              this.symbol = `./symbols/${category}/${item}`
              console.log(`./symbols/${category}/${item}`);
              
              loadSVGFromURL(`./symbols/${category}/${item}`, (objects, options) => {
                document.querySelector('app-shell').renderRoot.querySelector('draw-field')._current = util.groupSVGElements(objects);
               
                
              })
            }}" @dragstart=${this._dragstart.bind(this)}>
          </md-list-item>
        `)}
          `) : ''}
          </section>


      </custom-pages>

      <slot></slot>
    </aside>
    `;
  }
}
