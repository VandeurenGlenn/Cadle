import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { map } from 'lit/directives/map.js';

import { consume } from '@lit-labs/context';
import { Projects, projectsContext } from './../context/projects.js';

import './../elements/list/item.js'

@customElement('projects-field')
export class ProjectsField extends LitElement {
  @consume({context: projectsContext, subscribe: true})
  @property({attribute: false})
  projects: Projects
  

  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        align-items: center;
      }
    `
  ];

  constructor() {
    super()

  }
 
  get #projectsTemplate() {
    console.log(this.projects);
    
    return this.projects.map(item => html`
      <cadle-list-item .headline=${item} data-project=${item} @list-click=${(event) => { cadleShell.loadProject(item)}}></cadle-list-item>
    `)
  }

  render() {
    return html`
      <flex-container>
      ${this.projects?.length > 0 ? this.#projectsTemplate : html`<md-outlined-button @click=${cadleShell.uploadProject.bind(cadleShell)}>upload</md-outlined-button> <md-filled-button @click=${cadleShell.createProject.bind(cadleShell)}>create</md-filled-button>`}
      </flex-container>
    `;
  }
}
