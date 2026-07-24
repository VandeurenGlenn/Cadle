import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './projects.css' with { type: 'css' }
import { Projects, type UUID } from './../types.js'
import '@material/web/elevation/elevation.js'
import '@material/web/button/outlined-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/container.js'
import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { del, getProjects, renameProject, upload } from '../api/project.js'
import pubsub from '../pubsub.js'
@customElement('projects-field')
export class ProjectsField extends LiteElement {
  @property({ attribute: false })
  accessor projects: Projects = []

  @property({ type: Boolean })
  accessor showReopenPreviousProjectPrompt = false

  @property({ type: String })
  accessor previousProjectName = ''

  @query('.contextmenu')
  accessor contextmenu!: CustomDropdown

  _currentSelected
  _transitionEnd?: () => void
  _reopenPromptFocusedButton: 'open' | 'dismiss' = 'open'
  _onClick = (event: Event) => this._click(event)
  static styles = [styles]

  async connectedCallback(): Promise<void> {
    super.connectedCallback()
    this.projects = await getProjects()
    this.shadowRoot?.addEventListener('click', this._onClick)
    const shell = cadleShell as unknown as {
      showReopenPreviousProjectPrompt?: boolean
      previousProjectName?: string
    }
    this.showReopenPreviousProjectPrompt = Boolean(shell.showReopenPreviousProjectPrompt)
    this.previousProjectName = String(shell.previousProjectName ?? '')
    pubsub.subscribe('shell.reopen-previous-project-prompt', this.#onReopenPreviousProjectPrompt)
  }

  disconnectedCallback(): void {
    super.disconnectedCallback()
    this.shadowRoot?.removeEventListener('click', this._onClick)
    pubsub.unsubscribe('shell.reopen-previous-project-prompt', this.#onReopenPreviousProjectPrompt)
  }

  _actionTarget(event: Event): HTMLElement | null {
    const path = event.composedPath()
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue
      if (node.hasAttribute('data-action')) return node
    }
    return null
  }

  _pathAttribute(event: Event, attribute: string): string | null {
    const path = event.composedPath()
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue
      const value = node.getAttribute(attribute)
      if (value) return value
    }
    return null
  }

  #onReopenPreviousProjectPrompt = (payload: { open?: boolean; projectName?: string }) => {
    this.showReopenPreviousProjectPrompt = Boolean(payload?.open)
    this.previousProjectName = String(payload?.projectName ?? '')
    if (payload?.open) {
      // Reset focus when prompt opens
      this._reopenPromptFocusedButton = 'open'
      // Set up keyboard listener for the prompt
      setTimeout(() => {
        const openBtn = this.shadowRoot?.querySelector(
          '.projects-reopen-actions md-filled-button'
        ) as HTMLElement | null
        openBtn?.focus()
      }, 0)
    }
  }

  #handleReopenPromptKeydown = (event: KeyboardEvent) => {
    if (!this.showReopenPreviousProjectPrompt) return

    if (event.key === 'Tab') {
      event.preventDefault()
      // Toggle between open and dismiss buttons
      this._reopenPromptFocusedButton = this._reopenPromptFocusedButton === 'open' ? 'dismiss' : 'open'
      // Move focus to the newly selected button
      setTimeout(() => {
        const selector =
          this._reopenPromptFocusedButton === 'open'
            ? '.projects-reopen-actions md-filled-button'
            : '.projects-reopen-actions md-outlined-button'
        const btn = this.shadowRoot?.querySelector(selector) as HTMLElement | null
        btn?.focus()
      }, 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // Activate the focused button
      if (this._reopenPromptFocusedButton === 'open') {
        void this.#openPreviousProjectFromPrompt()
      } else {
        this.#dismissPreviousProjectPrompt()
      }
    }
  }

  #openPreviousProjectFromPrompt = async () => {
    const shell = cadleShell as unknown as { openPreviousProjectFromPrompt?: () => Promise<void> | void }
    await shell.openPreviousProjectFromPrompt?.()
  }

  #dismissPreviousProjectPrompt = () => {
    const shell = cadleShell as unknown as { dismissReopenPreviousProjectPrompt?: () => void }
    shell.dismissReopenPreviousProjectPrompt?.()
  }

  _loadProject(key: string, projectName: string) {
    cadleShell.loadProject(key as unknown as UUID, projectName)
  }

  _click(event: Event) {
    const actionTarget = this._actionTarget(event)
    if (!actionTarget) return

    const action = actionTarget.getAttribute('data-action')
    const selectedId =
      this._pathAttribute(event, 'data-id') ??
      actionTarget.getAttribute('data-id') ??
      (typeof this._currentSelected === 'string' ? this._currentSelected : null)
    const selectedProject = selectedId ? this.projects.find(([projectId]) => projectId === selectedId) : undefined
    const id = selectedId
    const name =
      this._pathAttribute(event, 'data-name') ?? actionTarget.getAttribute('data-name') ?? selectedProject?.[1] ?? null
    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null

    if (action === 'showContextMenu') {
      if (!id) return
      if (this._transitionEnd) dropdown?.removeEventListener('transitionend', this._transitionEnd)
      if (this._currentSelected !== undefined && id !== this._currentSelected) {
        this._transitionEnd = () => {
          this._showContextMenu(id)
          this._currentSelected = id
          dropdown?.removeEventListener('transitionend', this._transitionEnd)
        }

        dropdown?.addEventListener('transitionend', this._transitionEnd)
        if (this._currentSelected) this._showContextMenu(this._currentSelected)
      } else {
        this._showContextMenu(id)
        if (!this.contextmenu.open) this._currentSelected = undefined
        else this._currentSelected = id
      }
      return
    }

    if (action === 'loadProject') {
      if (!id || !name) return
      this._loadProject(id, name)
      return
    }

    if (action === 'editProjectDetails') {
      if (!id || !name) return
      this._loadProject(id, name)
      return
    }

    if (action === 'rename') {
      if (!id) return
      void this._rename(id, name)
      return
    }

    if (action === 'delete') {
      if (!id) return
      void this._delete(id)
      return
    }
  }

  async _rename(id: string, currentName: string | null) {
    const fallback = this.projects.find(([projectId]) => projectId === id)?.[1] ?? ''
    const nextName = window.prompt('Project name', currentName ?? fallback)?.trim()
    if (!nextName || nextName === fallback) return

    await renameProject(id, nextName)
    const projects = await getProjects()
    this.projects = projects
    cadleShell.projects = projects
    if (cadleShell.projectKey === (id as unknown as UUID) && cadleShell.project) {
      cadleShell.project.name = nextName
      cadleShell.projectName = nextName
    }
    this._currentSelected = id
    this.contextmenu.open = false
  }

  async _delete(id: string) {
    await del(id)
    const projects: Projects = []
    for (const [key, value] of await getProjects()) {
      projects.push([key, value])
    }

    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null
    this.projects = projects
    cadleShell.projects = projects
    this._currentSelected = undefined
    if (dropdown) (dropdown as CustomDropdown & { shown?: boolean }).shown = false
  }

  __showContextMenu(projectName: string) {
    const target = this.shadowRoot.querySelector(`[data-id="${projectName}"]`) as HTMLElement | null
    if (!target) return
    const { top, height, width, right } = target.getBoundingClientRect()
    this.contextmenu.style.top = `${top - height / 2}px`
    this.contextmenu.style.left = `${right - width}px`
  }

  _showContextMenu(projectName) {
    this.contextmenu.open = !this.contextmenu.open
    if (this.contextmenu.open) this.__showContextMenu(projectName)
  }

  get #projectsTemplate() {
    return html`<div class="list">
      ${this.projects.map(
        ([key, name]) =>
          html` <custom-list-item
            type="one-line"
            data-id=${key}
            data-name=${name}
            data-action="loadProject"
            tabindex="0">
            <span>${name}</span>
            <custom-icon-button
              icon="more_vert"
              data-id=${key}
              data-action="showContextMenu"
              slot="end"></custom-icon-button>
          </custom-list-item>`
      )}
    </div> `
  }

  render() {
    return html`
      <custom-dropdown class="contextmenu">
        <custom-list-item data-action="editProjectDetails">
          <span>projectgegevens</span>
          <custom-icon
            icon="edit_note"
            slot="end"></custom-icon>
        </custom-list-item>
        <custom-list-item data-action="rename">
          <span>rename</span>
          <custom-icon
            icon="abc"
            slot="end"></custom-icon>
        </custom-list-item>
        <custom-list-item data-action="delete">
          <span>delete</span>
          <custom-icon
            icon="delete"
            slot="end"></custom-icon>
        </custom-list-item>
      </custom-dropdown>
      <flex-container>
        <header class="header">
          <h1>Projects</h1>
          <p>Pick up where you left off, or start something new.</p>
        </header>
        <div class="actions-row">
          <md-outlined-button @click=${() => upload()}>Upload</md-outlined-button>
          <flex-it></flex-it>
          <md-filled-button @click=${() => (location.hash = '#!/create-project')}>Create</md-filled-button>
        </div>
        ${this.showReopenPreviousProjectPrompt
          ? html`
              <section
                class="projects-reopen-bubble"
                @keydown=${this.#handleReopenPromptKeydown}>
                <div class="projects-reopen-title">Open previous project?</div>
                <div class="projects-reopen-name">${this.previousProjectName || 'Previous project'}</div>
                <div class="projects-reopen-actions">
                  <md-filled-button
                    @click=${this.#openPreviousProjectFromPrompt}
                    ?data-focused=${this._reopenPromptFocusedButton === 'open'}
                    >Open</md-filled-button
                  >
                  <md-outlined-button
                    @click=${this.#dismissPreviousProjectPrompt}
                    ?data-focused=${this._reopenPromptFocusedButton === 'dismiss'}
                    >Dismiss</md-outlined-button
                  >
                </div>
              </section>
            `
          : ''}
        ${this.projects?.length > 0
          ? this.#projectsTemplate
          : html` <section class="empty-state">
              <h3>Welcome to Cadle</h3>
              <h4>Start by creating a project or uploading an existing one.</h4>
              <p>
                Projects save your pages, symbols, and one-line mappings so you can continue exactly where you left off.
              </p>
            </section>`}
      </flex-container>
    `
  }
}
