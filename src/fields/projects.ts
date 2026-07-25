import { LiteElement, html, customElement, property, query } from '@vandeurenglenn/lite'
import styles from './projects.css' with { type: 'css' }
import { Projects, type Project, type UUID } from './../types.js'
import '@material/web/elevation/elevation.js'
import '@material/web/dialog/dialog.js'
import '@material/web/button/filled-button.js'
import '@material/web/button/outlined-button.js'
import '@material/web/button/text-button.js'
import '@vandeurenglenn/lite-elements/dropdown.js'
import '@vandeurenglenn/lite-elements/list-item.js'
import '@vandeurenglenn/lite-elements/icon-button.js'
import '@vandeurenglenn/flex-elements/container.js'
import { CustomDropdown } from '@vandeurenglenn/lite-elements/dropdown.js'
import { del, getProjects, renameProject, upload } from '../api/project.js'
import pubsub from '../pubsub.js'
@customElement('projects-field')
export class ProjectsField extends LiteElement {
  static readonly WELCOME_SEEN_STORAGE = 'cadle.welcomeSeen'

  @property({ attribute: false })
  accessor projects: Projects = []

  @property({ type: Boolean })
  accessor showReopenPreviousProjectPrompt = false

  @property({ type: String })
  accessor previousProjectName = ''

  @query('.contextmenu')
  accessor contextmenu!: CustomDropdown

  @query('.welcome-dialog')
  accessor welcomeDialog!: HTMLElement & { open: boolean; close?: () => void }

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
    if (this.projects.length === 0 && !localStorage.getItem(ProjectsField.WELCOME_SEEN_STORAGE)) {
      localStorage.setItem(ProjectsField.WELCOME_SEEN_STORAGE, 'true')
      requestAnimationFrame(() => {
        if (this.welcomeDialog) this.welcomeDialog.open = true
      })
    }
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

  #closeWelcome = () => {
    if (this.welcomeDialog?.close) this.welcomeDialog.close()
    else if (this.welcomeDialog) this.welcomeDialog.open = false
  }

  #createFirstProject = () => {
    this.#closeWelcome()
    location.hash = '#!/create-project'
  }

  #uploadFirstProject = () => {
    this.#closeWelcome()
    void upload()
  }

  _loadProject(key: string, projectName: string) {
    cadleShell.loadProject(key as unknown as UUID, projectName)
  }

  _selectedProject() {
    if (typeof this._currentSelected !== 'string') return null
    const selected = this.projects.find(([projectId]) => projectId === this._currentSelected)
    return selected ? { id: selected[0], name: selected[1] } : null
  }

  _onProjectRowClick(id: string, name: string) {
    this._loadProject(id, name)
  }

  _onProjectMenuTriggerClick(event: Event, id: string) {
    event.stopPropagation()
    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null
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
  }

  _onContextActionClick(event: Event, action: 'edit' | 'rename' | 'delete') {
    event.stopPropagation()
    const selected = this._selectedProject()
    if (!selected) return

    if (action === 'edit') {
      this._loadProject(selected.id, selected.name)
      this.contextmenu.open = false
      return
    }

    if (action === 'rename') {
      void this._rename(selected.id, selected.name)
      return
    }

    void this._delete(selected.id)
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
    const deletingActiveProject = cadleShell.projectKey === (id as UUID)
    await del(id)
    const projects: Projects = []
    for (const [key, value] of await getProjects()) {
      projects.push([key, value])
    }

    const dropdown = this.shadowRoot?.querySelector('custom-dropdown') as CustomDropdown | null
    this.projects = projects
    cadleShell.projects = projects

    if (deletingActiveProject) {
      cadleShell.projectKey = '' as UUID
      cadleShell.loadedPage = ''
      cadleShell.projectName = ''
      cadleShell.project = {} as Project
      cadleShell.previousProjectKey = ''
      cadleShell.previousPageKey = ''
      cadleShell.previousProjectName = ''
      cadleShell.showReopenPreviousProjectPrompt = false
      localStorage.removeItem('cadle.lastOpenProjectKey')
      localStorage.removeItem('cadle.lastOpenPageKey')
      location.hash = '#!/projects'
    }

    this._currentSelected = undefined
    if (dropdown) {
      dropdown.open = false
      ;(dropdown as CustomDropdown & { shown?: boolean }).shown = false
    }
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
            @click=${() => this._onProjectRowClick(key, name)}
            tabindex="0">
            <span>${name}</span>
            <custom-icon-button
              icon="more_vert"
              data-id=${key}
              data-action="showContextMenu"
              @click=${(event: Event) => this._onProjectMenuTriggerClick(event, key)}
              slot="end"></custom-icon-button>
          </custom-list-item>`
      )}
    </div> `
  }

  render() {
    return html`
      <md-dialog class="welcome-dialog">
        <div slot="headline">Hello, welcome to Cadle</div>
        <div slot="content" class="welcome-dialog-content">
          <p>Cadle helps you build a ground plan and turn its circuits into a clear AREI one-wire diagram.</p>
          <p>Start a new project, or upload an existing Cadle project to continue working.</p>
        </div>
        <div slot="actions">
          <md-text-button @click=${this.#closeWelcome}>Maybe later</md-text-button>
          <md-outlined-button @click=${this.#uploadFirstProject}>Upload project</md-outlined-button>
          <md-filled-button @click=${this.#createFirstProject}>Create project</md-filled-button>
        </div>
      </md-dialog>
      <custom-dropdown class="contextmenu">
        <custom-list-item
          data-action="editProjectDetails"
          @click=${(event: Event) => this._onContextActionClick(event, 'edit')}>
          <span>projectgegevens</span>
          <custom-icon
            icon="edit_note"
            slot="end"></custom-icon>
        </custom-list-item>
        <custom-list-item
          data-action="rename"
          @click=${(event: Event) => this._onContextActionClick(event, 'rename')}>
          <span>rename</span>
          <custom-icon
            icon="abc"
            slot="end"></custom-icon>
        </custom-list-item>
        <custom-list-item
          data-action="delete"
          @click=${(event: Event) => this._onContextActionClick(event, 'delete')}>
          <span>delete</span>
          <custom-icon
            icon="delete"
            slot="end"></custom-icon>
        </custom-list-item>
      </custom-dropdown>
      <div class="projects-landing">
        <section class="projects-hero" aria-labelledby="projects-hero-title">
          <div class="hero-eyebrow"><span></span> Built for Belgian electrical plans</div>
          <div class="mobile-brand" aria-label="Cadle">
            <svg viewBox="0 0 72 72" aria-hidden="true">
              <path class="brand-plan" d="M55 18H22a7 7 0 0 0-7 7v29h26V39h14"></path>
              <path class="brand-circuit" d="M23 30h18v17h14"></path>
              <circle cx="23" cy="30" r="4"></circle>
              <circle cx="41" cy="47" r="4"></circle>
              <path class="brand-pencil" d="m49 15 8 8-18 18-10 2 2-10Z"></path>
            </svg>
            <span>Cadle</span>
          </div>
          <div class="hero-copy">
            <h2 id="projects-hero-title">From ground plan<br />to one-wire.</h2>
            <p>Draw naturally, connect your circuits, and let Cadle keep the technical structure clear.</p>
          </div>
          <div class="groundplan-scene" aria-hidden="true">
            <svg viewBox="0 0 520 390" role="img">
              <defs>
                <linearGradient id="plan-glow" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stop-color="var(--md-sys-color-primary)" stop-opacity=".28"></stop>
                  <stop offset="1" stop-color="var(--md-sys-color-tertiary)" stop-opacity=".04"></stop>
                </linearGradient>
                <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="12" stdDeviation="12" flood-opacity=".14"></feDropShadow>
                </filter>
              </defs>
              <rect class="plan-paper" x="42" y="28" width="436" height="326" rx="20"></rect>
              <rect class="plan-wash" x="42" y="28" width="436" height="326" rx="20"></rect>
              <g class="plan-lines" filter="url(#soft-shadow)">
                <path class="plan-stroke s1" pathLength="1" d="M92 82H270V202H92Z"></path>
                <path class="plan-stroke s2" pathLength="1" d="M270 82H426V164H270"></path>
                <path class="plan-stroke s3" pathLength="1" d="M92 202V304H226V202"></path>
                <path class="plan-stroke s4" pathLength="1" d="M226 304H426V164"></path>
                <path class="plan-stroke s5" pathLength="1" d="M270 164H346V304"></path>
                <path class="plan-door s6" pathLength="1" d="M270 120h32m-32 0a32 32 0 0 1 32 32"></path>
                <path class="plan-door s7" pathLength="1" d="M226 246h-28m28 0a28 28 0 0 0-28 28"></path>
                <path class="plan-door s8" pathLength="1" d="M346 224h28m-28 0a28 28 0 0 1 28 28"></path>
              </g>
              <g class="circuit">
                <path class="circuit-wire" pathLength="1" d="M128 122H224V164H310V264H390"></path>
                <g class="device d1" transform="translate(128 122)">
                  <circle r="10"></circle><path d="M-4 0h8M0-4v8"></path>
                </g>
                <g class="device d2" transform="translate(224 164)">
                  <circle r="10"></circle><path d="M-4 0h8M0-4v8"></path>
                </g>
                <g class="device d3" transform="translate(310 264)">
                  <circle r="10"></circle><path d="M-4 0h8M0-4v8"></path>
                </g>
                <g class="device d4" transform="translate(390 264)">
                  <circle r="10"></circle><path d="M-4 0h8M0-4v8"></path>
                </g>
                <circle class="current-dot" r="5">
                  <animateMotion dur="4s" repeatCount="indefinite" path="M128 122H224V164H310V264H390"></animateMotion>
                </circle>
              </g>
              <g class="plan-labels">
                <text x="108" y="104">LIVING</text>
                <text x="292" y="106">KITCHEN</text>
                <text x="112" y="226">HALL</text>
                <text x="272" y="328">TECHNICAL PLAN</text>
              </g>
            </svg>
            <div class="scene-status"><span></span> Circuit A1 connected</div>
          </div>
        </section>

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
      </div>
    `
  }
}
