import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import styles from './projects-field.css' with { type: 'css' }

@customElement('projects-field-screen')
export class ProjectsFieldScreen extends LiteElement {
  static styles = [styles]

  render() {
    return html`<div class="projects-screen"></div>`
  }
}
