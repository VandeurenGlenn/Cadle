import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import styles from './input-form-dialog.css' with { type: 'css' }

export type InputFormField = {
  name: string
  label: string
  value?: string
  placeholder?: string
  description?: string
  type?: 'text' | 'number'
  required?: boolean
  min?: number
  max?: number
  options?: ReadonlyArray<{ label: string; value: string }>
}

export type InputFormRequest = {
  title: string
  description?: string
  submitLabel?: string
  fields: ReadonlyArray<InputFormField>
}

@customElement('input-form-dialog')
export class InputFormDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ attribute: false }) accessor request: InputFormRequest | null = null
  @property({ type: String }) accessor error = ''

  static styles = [styles]
  #resolve: ((values: Record<string, string> | null) => void) | null = null

  show(request: InputFormRequest): Promise<Record<string, string> | null> {
    this.#resolve?.(null)
    this.request = request
    this.error = ''
    this.open = true
    this.toggleAttribute('data-open', true)
    this.setAttribute('aria-hidden', 'false')
    requestAnimationFrame(() => this.shadowRoot?.querySelector<HTMLInputElement>('input, select')?.focus())
    return new Promise((resolve) => {
      this.#resolve = resolve
    })
  }

  #close(values: Record<string, string> | null) {
    this.open = false
    this.toggleAttribute('data-open', false)
    this.setAttribute('aria-hidden', 'true')
    this.#resolve?.(values)
    this.#resolve = null
  }

  #submit = (event: SubmitEvent) => {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    if (!form.reportValidity()) return
    const values: Record<string, string> = {}
    for (const field of this.request?.fields ?? []) {
      const control = form.elements.namedItem(field.name)
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        values[field.name] = control.value.trim()
      }
    }
    this.#close(values)
  }

  render() {
    const request = this.request
    if (!this.open || !request) return html``
    return html`
      <form @submit=${this.#submit}>
        <div>
          <h2>${request.title}</h2>
          ${request.description ? html`<p>${request.description}</p>` : ''}
        </div>
        <div class="fields">
          ${request.fields.map(
            (field) => html`
              <label>
                <span>${field.label}</span>
                ${field.options
                  ? html`<select
                      name=${field.name}
                      ?required=${field.required}>
                      ${field.options.map(
                        (option) =>
                          html`<option
                            value=${option.value}
                            ?selected=${option.value === field.value}>
                            ${option.label}
                          </option>`
                      )}
                    </select>`
                  : html`<input
                      name=${field.name}
                      type=${field.type ?? 'text'}
                      .value=${field.value ?? ''}
                      placeholder=${field.placeholder ?? ''}
                      ?required=${field.required}
                      min=${field.min ?? ''}
                      max=${field.max ?? ''} />`}
                ${field.description ? html`<small>${field.description}</small>` : ''}
              </label>
            `
          )}
        </div>
        ${this.error
          ? html`<div
              class="error"
              role="alert">
              ${this.error}
            </div>`
          : ''}
        <div class="actions">
          <button
            type="button"
            @click=${() => this.#close(null)}>
            Cancel
          </button>
          <button
            class="primary"
            type="submit">
            ${request.submitLabel ?? 'Save'}
          </button>
        </div>
      </form>
    `
  }
}
