import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './contextmenu.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
@customElement('context-menu')
export class Contextmenu extends LiteElement {
  @property({ type: Boolean, reflect: true })
  accessor open: boolean = false

  @property({ type: Boolean, reflect: true })
  accessor quick: boolean = false

  currentTarget: HTMLElement | null = null
  hide() {
    this.open = false
  }

  async show(event: { target: HTMLElement; clientY: number }) {
    console.log({ event })
    const drop = this.shadowRoot?.querySelector('custom-dropdown') as HTMLElement | null
    if (!drop) return
    drop.style.opacity = '0'
    this.quick = true
    this.open = true
    await this.rendered
    const { top, bottom, height } = event.target.getBoundingClientRect()
    console.log(top, bottom)
    const dropRect = drop.getBoundingClientRect()
    this.open = false
    await this.rendered
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
    drop.style.opacity = '1'
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

  static styles = [styles]

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
