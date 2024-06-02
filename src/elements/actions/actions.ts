import { LitElement, html, css } from 'lit'
import { map } from 'lit/directives/map.js'
import { customElement, property } from 'lit/decorators.js'
import '@vandeurenglenn/lit-elements/icon.js'
import '@vandeurenglenn/lit-elements/icon-button.js'
import '@vandeurenglenn/lit-elements/toggle-button.js'
import '@vandeurenglenn/lit-elements/list-item.js'
import '@vandeurenglenn/flex-elements/it.js'
import '@vandeurenglenn/flex-elements/row.js'
import { field, incrementLetter, incrementSocket, positionObject, shell } from '../../utils.js'
import { Textbox } from 'fabric'
import state from '../../state.js'
import { Color } from '../../symbols/default-options.js'

declare global {
  interface HTMLElementTagNameMap {
    'cadle-actions': CadleActions
  }
}

@customElement('cadle-actions')
export class CadleActions extends LitElement {
  @property({ type: Boolean, reflect: true })
  open: boolean = true
  static styles = [
    css`
      :host {
        display: flex;
        flex-direction: row;
        width: 100%;
        opacity: 0;
        height: 54px;
      }
      custom-list-item {
        width: 100%;
      }
      :host([open]) {
        opacity: 1;
      }
    `
  ]

  @property()
  fill: Color = state.styling.fill

  show() {
    this.open = true
  }

  hide() {
    this.open = false
  }

  constructor() {
    super()
    this.addEventListener('mousedown', () => {
      const menu = this.renderRoot.querySelector('context-menu')
      if (menu.open) menu.open = false
    })
    this.addEventListener('contextmenu', this.#showMenu)
  }

  #showMenu = event => {
    event.preventDefault()

    const target = event.composedPath()[0]
    console.log({ target })
    const menu = this.renderRoot.querySelector('context-menu')
    if (target.dataset.menu === 'insert-text') {
      menu.innerHTML = `
      <custom-list-item type="menu" name="normal">
        <custom-toggle active="${state.text.type === 'normal' ? 1 : 0}" slot="end">
          <custom-icon-font slot="icon">check_box_outline_blank</custom-icon-font>
          <custom-icon-font slot="icon">check_box</custom-icon-font>
        </custom-toggle>
        normal
      </custom-list-item>

      <custom-list-item type="menu" name="socket">
        <custom-toggle active="${state.text.type === 'socket' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font slot="icon">check_box</custom-icon-font>
        </custom-toggle>
        sockets
      </custom-list-item>

      <custom-list-item type="menu" name="switch">
        <custom-toggle active="${state.text.type === 'switch' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font slot="icon">check_box</custom-icon-font>
        </custom-toggle>
        switches
      </custom-list-item>

      <custom-list-item type="menu" name="alphabet">
        <custom-toggle active="${state.text.type === 'alphabet' ? 1 : 0}" slot="end">
          <custom-icon-font >check_box_outline_blank</custom-icon-font>
          <custom-icon-font slot="icon">check_box</custom-icon-font>
        </custom-toggle>
        alphabet
      </custom-list-item>
      `
      menu.show({
        clientX: event.clientX + menu?.shadowRoot?.querySelector('custom-dropdown')?.getBoundingClientRect().width,
        clientY: event.clientY + menu?.shadowRoot?.querySelector('custom-dropdown')?.getBoundingClientRect().height * 2,
        target
      })
    }
    // drop.style.opacity = 0
    // drop.addEventListener('transitionend', () => {
    //   drop.style.left = `${left - width - drop.getBoundingClientRect().width}px`
    // })
  }

  #selected = async ({ detail }) => {
    if (detail === 'alphabet' || detail === 'normal' || detail === 'switch' || detail === 'socket') {
      state.text.type = detail
      cadleShell.dialog.innerHTML = `
      <form id="text-input" slot="content" method="dialog">
        <md-filled-text-field
          label="input"
          value="${state.text.current}"
          dialogFocus>
        </md-filled-text-field>
      </form>
      <div slot="actions">
        <md-filled-button form="text-input" value="confirm-input">
          done
        </md-filled-button>
      </div>
      `
      cadleShell.dialog.open = true
    }
  }

  drawText() {
    shell.action = 'draw-text'

    const { left, top } = positionObject()

    field._current = new Textbox(state.text.current, {
      fontFamily: 'system-ui',
      fontSize: 12,
      fontStyle: 'normal',
      fontWeight: 'normal',
      controls: false,
      left,
      top
    })
  }
  @property({ type: Array })
  actions = [
    {
      title: 'undo changes',
      icon: 'undo',
      action: globalThis.cadleShell.undo
    },
    {
      title: 'redo changes',
      icon: 'redo',
      action: globalThis.cadleShell.redo
    },
    {
      title: 'select',
      icon: 'arrow_selector_tool',
      action: () => (globalThis.cadleShell.action = 'select')
    },
    {
      title: 'snap to grid',
      togglers: ['grid_on', 'grid_off'],
      action: () => (globalThis.cadleShell.freeDraw = !globalThis.cadleShell.freeDraw),
      seperates: true
    },
    {
      title: 'insert text',
      icon: 'insert_text',
      action: this.drawText,
      menu: 'insert-text'
    },
    {
      title: 'draw wall',
      icon: 'polyline',
      action: () => (globalThis.cadleShell.action = 'draw-wall'),
      seperates: true
    },
    {
      title: 'freedraw',
      icon: 'draw',
      action: () => (globalThis.cadleShell.action = 'draw')
    },
    {
      title: 'draw square',
      icon: 'square',
      menu: 'draw-square',
      menuPosition: 'right',
      action: () => (globalThis.cadleShell.action = 'draw-square')
    },
    {
      title: 'draw circle',
      icon: 'circle',
      action: () => (globalThis.cadleShell.action = 'draw-circle')
    },
    {
      title: 'draw arc',
      icon: 'line_curve',
      action: () => (globalThis.cadleShell.action = 'draw-arc')
    },
    {
      title: 'draw line',
      icon: 'horizontal_rule',
      action: () => (globalThis.cadleShell.action = 'draw-line')
    },
    {
      title: 'pick color',
      color: true,
      action: globalThis.cadleShell.pickColor
    }
  ]

  render() {
    return html`
      ${map(this.actions, ({ action, icon, title, seperates, togglers, menu, menuPosition, color }) => {
        if (togglers)
          return html` <md-icon-button
              @click=${action}
              toggle>
              <custom-icon icon=${togglers[0]}>${togglers[0]}</custom-icon>
              <custom-icon
                slot="selected"
                icon=${togglers[1]}></custom-icon>
            </md-icon-button>
            ${seperates ? html`<flex-it></flex-it>` : ''}`

        if (color) {
          return html` <custom-button
              @mouseup=${action}
              title=${title}
              data-menu=${menu}
              .menu-position=${menuPosition}
              style="width: 40px; border-radius: 50%;">
              <div
                style="width: 24px; height: 24px; border: 1px solid #555; border-radius: 50%; background-color: ${this
                  .fill}"
                slot="icon"></div>
            </custom-button>
            ${seperates ? html`<flex-it></flex-it>` : ''}`
        }

        return html`
          <custom-button
            @mouseup=${action}
            title=${title}
            data-menu=${menu}
            .menu-position=${menuPosition}>
            <custom-icon
              slot="icon"
              icon=${icon}></custom-icon>
          </custom-button>
          ${seperates ? html`<flex-it></flex-it>` : ''}
        `
      })}

      <context-menu @selected=${this.#selected}> </context-menu>
    `
  }
}
