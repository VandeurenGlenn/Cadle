import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './contextmenu.css' with { type: 'css' }
import '@vandeurenglenn/lite-elements/menu.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon.js'
@customElement('context-menu')
export class Contextmenu extends LiteElement {
  @property({ type: Boolean, reflect: true })
  accessor open: boolean = false

  @property({ type: Boolean, reflect: true })
  accessor quick: boolean = false

  @property({ type: String })
  accessor expandedSection: 'flip' | 'rotate' | '' = ''

  currentTarget: { type?: string; localName?: string } | null = null
  selectedCount = 0

  hide() {
    this.open = false
    this.expandedSection = ''
  }

  async showAt(
    clientX: number,
    clientY: number,
    target: { type?: string; localName?: string } | null = null,
    selectedCount = 0
  ) {
    const drop = this.shadowRoot?.querySelector('custom-dropdown') as HTMLElement | null
    if (!drop) return
    drop.style.position = 'fixed'
    drop.style.left = `${clientX}px`
    drop.style.top = `${clientY}px`
    this.currentTarget = target
    this.selectedCount = selectedCount
    this.expandedSection = ''
    this.quick = false
    this.open = true
  }

  async show(event: { target: HTMLElement; clientY: number }) {
    const drop = this.shadowRoot?.querySelector('custom-dropdown') as HTMLElement | null
    if (!drop) return
    drop.style.position = 'fixed'
    this.currentTarget = event.target
    const { top, height } = event.target.getBoundingClientRect()
    drop.style.left = `${event.target.getBoundingClientRect().left}px`
    drop.style.top = `${event.target.getAttribute('menu-position') === 'bottom' ? top - height : event.clientY}px`
    this.expandedSection = ''
    this.quick = false
    this.open = true
  }

  #selected = ({ detail }: CustomEvent) => {
    const action = detail?.getAttribute?.('action') as string | undefined
    if (action === 'toggle-flip') {
      this.expandedSection = this.expandedSection === 'flip' ? '' : 'flip'
      return
    }

    if (action === 'toggle-rotate') {
      this.expandedSection = this.expandedSection === 'rotate' ? '' : 'rotate'
      return
    }

    this.dispatchEvent(new CustomEvent('selected', { detail }))
    this.hide()
  }

  static styles = [styles]

  render() {
    const canGroup = this.selectedCount > 1 || this.currentTarget?.type === 'activeSelection'
    const canUngroup = this.currentTarget?.type === 'group'
    const flipOpen = this.expandedSection === 'flip'
    const rotateOpen = this.expandedSection === 'rotate'
    return html`
      <custom-dropdown
        class="contextmenu"
        .open=${this.open}>
        <custom-elevation></custom-elevation>
        <custom-menu @selected=${this.#selected}>
          <slot></slot>
          ${canGroup
            ? html`<custom-list-item
                type="menu"
                action="group">
                <custom-icon
                  slot="start"
                  icon="group"></custom-icon>
                group
              </custom-list-item>`
            : ''}
          ${canUngroup
            ? html`<custom-list-item
                type="menu"
                action="ungroup">
                <custom-icon
                  slot="start"
                  icon="ungroup"></custom-icon>
                ungroup
              </custom-list-item>`
            : ''}
          <custom-list-item
            class="submenu-toggle"
            type="menu"
            action="toggle-flip">
            <custom-icon
              slot="start"
              icon=${flipOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}></custom-icon>
            flip
          </custom-list-item>
          <custom-list-item
            class="submenu-item ${flipOpen ? '' : 'submenu-hidden'}"
            type="menu"
            action="flip-horizontal"
            ?non-interactive=${!flipOpen}>
            <custom-icon
              slot="start"
              icon="flip"></custom-icon>
            mirror horizontal
          </custom-list-item>
          <custom-list-item
            class="submenu-item ${flipOpen ? '' : 'submenu-hidden'}"
            type="menu"
            action="flip-vertical"
            ?non-interactive=${!flipOpen}>
            <custom-icon
              slot="start"
              icon="flip"></custom-icon>
            mirror vertical
          </custom-list-item>
          <custom-list-item
            class="submenu-toggle"
            type="menu"
            action="toggle-rotate">
            <custom-icon
              slot="start"
              icon=${rotateOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}></custom-icon>
            rotate
          </custom-list-item>
          <custom-list-item
            class="submenu-item ${rotateOpen ? '' : 'submenu-hidden'}"
            type="menu"
            action="rotate-left"
            ?non-interactive=${!rotateOpen}>
            <custom-icon
              slot="start"
              icon="rotate_left"></custom-icon>
            rotate left
          </custom-list-item>
          <custom-list-item
            class="submenu-item ${rotateOpen ? '' : 'submenu-hidden'}"
            type="menu"
            action="rotate-right"
            ?non-interactive=${!rotateOpen}>
            <custom-icon
              slot="start"
              icon="rotate_right"></custom-icon>
            rotate right
          </custom-list-item>
        </custom-menu>
      </custom-dropdown>
    `
  }
}
