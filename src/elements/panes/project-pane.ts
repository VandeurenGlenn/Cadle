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

  select(selected: string) {
    this.selected = selected
  }

  set action(value: string) {
    const shell = document.querySelector('app-shell') as any
    if (shell) shell.action = value
  }

  set symbol(value: string) {
    const shell = document.querySelector('app-shell') as any
    if (shell) shell.symbol = value
  }

  static styles = [styles]

  _dragstart(e: DragEvent) {
    console.log(e)
  }

  render() {
    return html`
      ${this.selected === 'project'
        ? html`<project-element .project=${this.project}></project-element>`
        : html`<catalog-element .catalog=${this.catalog}></catalog-element>`}
    `
  }
}
