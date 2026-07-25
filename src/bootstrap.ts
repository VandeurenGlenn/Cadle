import { LiteElement, html, customElement } from '@vandeurenglenn/lite'
import './fields/projects.js'

const afterPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

@customElement('cadle-startup')
export class CadleStartup extends LiteElement {
  #handoffStarted = false

  async connectedCallback(): Promise<void> {
    if (super.connectedCallback) await super.connectedCallback()
    await this.rendered
    if (this.#handoffStarted) return
    this.#handoffStarted = true
    await afterPaint()

    // Start shell loading only after Projects has had a real paint opportunity.
    // The shell takes over this host once its custom element is registered.
    try {
      await import('./shell.js')
      const shell = document.createElement('app-shell')
      this.replaceWith(shell)
    } catch (error) {
      console.error('Failed to load Cadle shell', error)
    }
  }

  render() {
    return html`<projects-field></projects-field>`
  }
}
