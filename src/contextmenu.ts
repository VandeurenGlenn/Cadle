import { LitElement, html, css } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import { cp } from 'fs'

@customElement('context-menu')
export class Contextmenu extends LitElement {
  @property({ type: Boolean, reflect: true })
  open: boolean = false

  @property({ type: Boolean, reflect: true })
  quick: boolean = false

  currentTarget

  hide() {
    this.open = false
  }

  async show(event) {
    console.log({ event })
    const drop = this.renderRoot.querySelector('custom-dropdown')
    drop.style.opacity = 0
    this.quick = true
    this.open = true
    await this.updateComplete
    const { top, left, bottom, height } = event.target.getBoundingClientRect()
    console.log(top, bottom)

    const dropRect = drop.getBoundingClientRect()
    this.open = false

    await this.updateComplete
    this.currentTarget = event.target
    // const transitionEnd = () => {

    console.log(dropRect)

    if (event.target.getAttribute('menu-position') === 'bottom') {
      drop.style.top = `${top - height - dropRect.height}px`
    } else
      drop.style.top =
        event.target.localName === 'custom-selector'
          ? `${event.clientY - dropRect.height / 2}px`
          : `${event.target.offsetTop + height}px`

    if (event.target.getAttribute('menu-position') === 'right') {
      drop.style.left = `${event.target.offsetLeft - dropRect.width}px`
    } else {
      drop.style.left = `${event.target.offsetLeft}px`
    }
    // }
    // drop?.addEventListener('transitionend', transitionEnd.bind(this))
    drop.style.opacity = 1
    this.quick = false
    this.open = true
    // await this.updateComplete

    // if (target.getAttribute('menu-position') === 'right') {
    //   drop.style.left = `${left - 280 * 2}px`
    // } else {
    //   drop.style.left = `${left - width - 280}px`
    // }
  }

  #selected = ({ detail }: CustomEvent) => {
    console.log(detail)

    this.dispatchEvent(new CustomEvent('selected', { detail }))
  }

  static styles = [
    css`
      :host {
        display: block;
        position: absolute;
        width: 100%;
      }
      custom-dropdown {
        display: flex;
        flex-direction: column;
        width: 100%;
        min-width: 120px;
        max-width: 280px;

        padding: 8px 0;
        border-radius: var(--md-sys-shape-corner-extra-small);
        anchor: --contextmenu-anchor;
      }

      :host([quick]) custom-dropdown {
        transition: none;
      }

      custom-elevation {
        --md-elevation-level: var(--elevation-level, 1);
        border-radius: var(--md-sys-shape-corner-extra-small);
      }
    `
  ]

  render() {
    return html`
      <custom-dropdown
        class="contextmenu"
        @click=${this.hide}
        .open=${this.open}>
        <custom-elevation></custom-elevation>
        <custom-menu @selected=${this.#selected}>
          <slot></slot>
        </custom-menu>
      </custom-dropdown>
    `
  }
}
