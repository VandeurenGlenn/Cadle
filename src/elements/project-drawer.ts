import { LitElement, html, css } from 'lit'
import { map } from 'lit/directives/map.js'
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

  select(selected) {
    this.#pages.select(selected)
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
        --md-list-item-list-item-leading-avatar-shape: 0;
        pointer-events: auto;
        border-top: 1px solid var(--md-sys-color-outline);
      }

      section {
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }

      custom-button {
        pointer-events: auto;
      }
    `
  ]

  _dragstart(e) {
    console.log(e)
  }

  render() {
    return html`
      <custom-pages
        attr-for-selected="data-route"
        default-selected="symbols">
        <project-element data-route="project"></project-element>
        <catalog-element data-route="symbols"></catalog-element>
      </custom-pages>
    `
  }
}
