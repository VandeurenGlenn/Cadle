import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js'
import { getProjects } from '../../api/project.js'

@customElement('projects-field')
export class ProjectsField extends LitElement {
  @property({ type: Array })
  projects: string[]

  async connectedCallback() {
    super.connectedCallback()
    this.projects = await getProjects()
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    md-list {
      width: 100%;
      max-width: 640px;
      height: 100%;
    }
  `

  render() {
    return html`
      <md-list>
        ${this.projects
          ? map(
              this.projects,
              (project) => html`
                <md-list-item
                  headline=${project}
                  @click=${() => cadleShell.loadProject(project, project)}></md-list-item>
              `
            )
          : ''}
      </md-list>
    `
  }
}
