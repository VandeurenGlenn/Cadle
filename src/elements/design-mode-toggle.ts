import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './design-mode-toggle.css' with { type: 'css' }
import state_, { type DesignMode } from '../state.js'
/**
 * Header chip that toggles between three design workflows:
 *
 *   - free            : draw anything anywhere (current default).
 *   - situation-first : place devices on the situation plan, then bind.
 *                       Mirrors Automaticals' installation-first flow.
 *   - one-line-first  : draw circuits on the one-line, then bind to plan.
 *                       Mirrors Trikker's diagram-first flow.
 *
 * Selection is broadcast as a `cadle-design-mode-change` CustomEvent on
 * `window` so any module can react without coupling to this element.
 */
@customElement('design-mode-toggle')
export class DesignModeToggle extends LiteElement {
  @property()
  private accessor mode: DesignMode = state_.designMode

  static styles = [styles]

  #set(mode: DesignMode) {
    this.mode = mode
    state_.designMode = mode
    window.dispatchEvent(new CustomEvent('cadle-design-mode-change', { detail: { mode } }))
  }

  render() {
    const opts: Array<{ id: DesignMode; label: string; title: string }> = [
      { id: 'free', label: 'Free', title: 'No workflow constraint' },
      {
        id: 'situation-first',
        label: 'Plan first',
        title: 'Place devices on the situation plan, then bind to circuits'
      },
      {
        id: 'one-line-first',
        label: 'One-line first',
        title: 'Draw circuits on the one-line, then bind to floor plan'
      }
    ]
    return html`${opts.map(
      (o) => html`
        <button
          type="button"
          title=${o.title}
          aria-pressed=${this.mode === o.id ? 'true' : 'false'}
          @click=${() => this.#set(o.id)}>
          ${o.label}
        </button>
      `
    )}`
  }
}
