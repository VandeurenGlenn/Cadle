import { LitElement, html, css } from 'lit';
import { map } from 'lit/directives/map.js';
import { customElement, property } from 'lit/decorators.js'
import'@material/web/list/list-item.js'
import'@material/web/menu/sub-menu-item.js'
import './catalog/catalog.js'
import './project/project.js'

@customElement('project-drawer')

export class ProjectDrawer extends LitElement {
  

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

      img {
        width: 32px;
        height: 32px;
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
          <custom-tab data-route="project"><span>pages</span></custom-tab>
          <custom-tab data-route="symbols"><span>catalog</span></custom-tab>
        </custom-tabs>

        <custom-pages attr-for-selected="data-route">
          <project-element data-route="project"></project-element>
          <catalog-element data-route="symbols"></catalog-element>
        </custom-pages>

        <slot></slot>
      </aside>
    `;
  }
}
