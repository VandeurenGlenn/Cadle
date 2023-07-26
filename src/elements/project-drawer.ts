import { LitElement, html, css } from 'lit';
import { map } from 'lit/directives/map.js';
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/button.js'
import '@vandeurenglenn/lit-elements/selector.js'
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
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        --md-list-item-list-item-container-color: #fff;
        --md-list-item-list-item-leading-avatar-color: #fff;
        --md-list-item-list-item-leading-avatar-shape: 0
      }

      section {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      custom-button {
        pointer-events: auto;
      }

      custom-selector {
        width: 100%;
        height: auto;
        flex-direction: row;
        pointer-events: auto;
      }
    `
  ];

  _dragstart(e) {
    console.log(e);
    
  }

  render() {
    return html`
        <custom-selector attr-for-selected="route" @selected=${(e) => this.#pages.select(e.detail)}>
          <custom-button route="project" label="project" type="outlined"></custom-button>
          <custom-button route="symbols" label="catalog"></custom-button>
        </custom-selector>

        <custom-pages attr-for-selected="data-route">
          <project-element data-route="project"></project-element>
          <catalog-element data-route="symbols"></catalog-element>
        </custom-pages>

        <slot></slot>
    `;
  }
}
