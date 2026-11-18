import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './project-pane.css' with { type: 'css' }
import type { Project, Catalog } from '../../types.js'
import '@vandeurenglenn/lite-elements/button.js'
import '@vandeurenglenn/lite-elements/selector.js'
import '../catalog/catalog.js'
import '../project/project.js'
@customElement('project-pane')
export class ProjectPane extends LiteElement {
  @property({ type: String }) accessor selected = 'symbols'
  @property({ attribute: false }) accessor project!: Project
  @property({ attribute: false }) accessor catalog: Catalog = []
  #projectVisited = false
  #catalogVisited = false

  select(selected: string) {
    this.selected = selected
  }

  set action(value: string) {
    const shell = document.querySelector('app-shell') as (HTMLElement & { action?: string }) | null
    if (shell) shell.action = value
  }

  set symbol(value: string) {
    const shell = document.querySelector('app-shell') as (HTMLElement & { symbol?: string }) | null
    if (shell) shell.symbol = value
  }

  static styles = [styles]

  _dragstart() {
  }

  render() {
    if (this.selected === 'project') this.#projectVisited = true
    else this.#catalogVisited = true
    return html`
      ${this.#projectVisited ? html`<project-element
        ?hidden=${this.selected !== 'project'} .project=${this.project}></project-element>` : ''}
      ${this.#catalogVisited ? html`<catalog-element
        ?hidden=${this.selected === 'project'} .catalog=${this.catalog}></catalog-element>` : ''}
    `
  }
}
