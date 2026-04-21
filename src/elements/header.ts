import { LitElement, css, html } from 'lit'
import { customElement } from 'lit/decorators.js'

declare global {
  interface HTMLElementTagNameMap {
    'cadle-header': CadleHeader
  }
}

@customElement('cadle-header')
export class CadleHeader extends LitElement {
  static styles = [
    css`
      :host {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 64px;
        padding: 0 20px;
        box-sizing: border-box;
        border-bottom: 1px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        gap: 16px;
      }

      .start {
        min-width: 0;
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        gap: 8px;
      }

      .end {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-left: 0;
      }

      ::slotted(*) {
        min-width: 0;
      }
    `
  ]

  render() {
    return html`
      <div class="start">
        <slot></slot>
      </div>
      <div class="end">
        <slot name="end"></slot>
      </div>
    `
  }
}
