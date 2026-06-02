import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './template-library.css' with { type: 'css' }
@customElement('template-library')
export class TemplateLibrary extends LiteElement {
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ type: Array }) accessor templates: Array<{
    id: string
    name: string
    description: string
    category?: string
    highlights?: string[]
  }> = []

  static styles = [styles]

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #selectTemplate(id: string) {
    this.dispatchEvent(new CustomEvent('select-template', { bubbles: true, composed: true, detail: { id } }))
  }

  render() {
    return html`
      <div
        class="panel"
        @click=${(event: Event) => event.stopPropagation()}>
        <div class="header">
          <div>
            <h3>Template Library</h3>
            <p>Start a new page from a preconfigured electrical circuit layout.</p>
          </div>
          <button @click=${this.#close}>Close</button>
        </div>
        <div class="grid">
          ${this.templates.map(
            (template) => html`
              <div class="card">
                ${template.category ? html`<div class="eyebrow">${template.category}</div>` : null}
                <h4>${template.name}</h4>
                <p>${template.description}</p>
                ${template.highlights?.length
                  ? html`
                      <div class="highlights">
                        ${template.highlights.map((highlight) => html`<span class="chip">${highlight}</span>`)}
                      </div>
                    `
                  : null}
                <button
                  class="primary"
                  @click=${() => this.#selectTemplate(template.id)}>
                  Use template
                </button>
              </div>
            `
          )}
        </div>
      </div>
    `
  }
}
