import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './page-operation-dialog.css' with { type: 'css' }

export type PageOperationMode = 'clone' | 'rename'

export type PageOperationSubmitDetail = {
  mode: PageOperationMode
  pageKey: string
  pageName: string
  includeWalls: boolean
  outsideWallsOnly: boolean
  includeOpenings: boolean
  includeElectrical: boolean
}

@customElement('page-operation-dialog')
export class PageOperationDialog extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ type: String }) accessor mode: PageOperationMode = 'rename'
  @property({ type: String }) accessor pageKey = ''
  @property({ type: String }) accessor sourcePageName = ''
  @property({ type: String }) accessor pageName = ''

  static styles = [styles]

  onChange(property: string) {
    if (property === 'open') {
      this.toggleAttribute('data-open', this.open)
      this.setAttribute('aria-hidden', String(!this.open))
    }
  }

  show(mode: PageOperationMode, pageKey: string, sourcePageName: string) {
    this.mode = mode
    this.pageKey = pageKey
    this.sourcePageName = sourcePageName
    this.pageName = mode === 'clone' ? `${sourcePageName} copy` : sourcePageName
    this.open = true
  }

  #close = () => {
    this.open = false
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #submit = () => {
    const readChecked = (selector: string, fallback = false) =>
      this.shadowRoot?.querySelector<HTMLInputElement>(selector)?.checked ?? fallback
    const pageName = this.shadowRoot?.querySelector<HTMLInputElement>('#page-name')?.value.trim() || this.pageName
    const detail: PageOperationSubmitDetail = {
      mode: this.mode,
      pageKey: this.pageKey,
      pageName,
      includeWalls: readChecked('#clone-walls', true),
      outsideWallsOnly: readChecked('#clone-outside-walls'),
      includeOpenings: readChecked('#clone-openings'),
      includeElectrical: readChecked('#clone-electrical')
    }
    this.open = false
    this.dispatchEvent(new CustomEvent<PageOperationSubmitDetail>('page-operation-submit', {
      detail,
      bubbles: true,
      composed: true
    }))
  }

  render() {
    if (!this.open) return html``
    const cloning = this.mode === 'clone'
    return html`
      <button class="scrim" type="button" aria-label="Close" @click=${this.#close}></button>
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="page-operation-title">
        <h2 id="page-operation-title">${cloning ? 'Clone page' : 'Rename page'}</h2>
        ${cloning ? html`<p>Clone “${this.sourcePageName}” into a new page.</p>` : ''}
        <div class="fields">
          ${cloning
            ? html`
                <label><input id="clone-walls" type="checkbox" checked />Clone walls</label>
                <label><input id="clone-outside-walls" type="checkbox" />Only outside walls</label>
                <label><input id="clone-openings" type="checkbox" />Include doors, windows and gates</label>
                <label><input id="clone-electrical" type="checkbox" />Include switches and loads</label>
              `
            : ''}
          <label class="name-field">
            <span>${cloning ? 'New page name' : 'Page name'}</span>
            <input id="page-name" type="text" .value=${this.pageName} />
          </label>
        </div>
        <div class="actions">
          <custom-button type="text" label="Cancel" @click=${this.#close}></custom-button>
          <custom-button
            type="filled"
            .label=${cloning ? 'Clone' : 'Rename'}
            @click=${this.#submit}></custom-button>
        </div>
      </section>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'page-operation-dialog': PageOperationDialog
  }
}
