import { LiteElement, html, customElement, property } from '@vandeurenglenn/lite'
import styles from './validation-report.css' with { type: 'css' }

type ValidationIssue = {
  bindingId: string
  severity: 'error' | 'warn' | string
  message: string
}

type ValidationGroup = {
  bindingId: string
  ready: boolean
  switches: number
  loads: number
  neutral: number
  specification?: {
    breakerCurrentA: number
    cableSectionMm2: number
    poles: number
    phaseConfiguration: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
    breakerCurve?: string
    rcdSensitivityMa?: number
    rcdType?: string
    boardId?: string
    railId?: string
    notes?: string
    source: 'explicit' | 'suggested'
    sources: {
      breakerCurrentA: 'entered' | 'suggested'
      cableSectionMm2: 'entered' | 'suggested'
      poles: 'entered' | 'project' | 'suggested'
      phaseConfiguration: 'entered' | 'project' | 'suggested'
    }
  }
}

export type ValidationReport = {
  totalGroups: number
  readyGroups: number
  errorCount: number
  warningCount: number
  issues: ValidationIssue[]
  groups: ValidationGroup[]
  valid: boolean
}

@customElement('validation-report')
export class ValidationReportModal extends LiteElement {
  @property({ type: Boolean }) accessor open = false
  @property({ attribute: false }) accessor report: ValidationReport | null = null
  @property({ type: String }) accessor projectName = ''
  static styles = [styles]

  onChange(property: string) {
    if (property !== 'open') return

    this.toggleAttribute('data-open', this.open)
    this.setAttribute('aria-hidden', String(!this.open))
  }

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #focusBinding(bindingId: string) {
    this.dispatchEvent(new CustomEvent('focus-binding', { bubbles: true, composed: true, detail: { bindingId } }))
  }

  #generate = () => {
    this.dispatchEvent(new CustomEvent('generate-one-wire', { bubbles: true, composed: true }))
  }

  render() {
    const report = this.report
    if (!this.open || !report) return html``
    return html`
      <div
        class="panel"
        @click=${(event: Event) => event.stopPropagation()}>
        <div class="header">
          <div class="title">
            <h3>Circuit check</h3>
            <p>${this.projectName || 'Current project'} • everything needed for the one-wire diagram</p>
          </div>
          <button @click=${this.#close}>Close</button>
        </div>
        <div class="content">
          <div class="stats">
            <div class="stat"><strong>${report.totalGroups}</strong><span>Circuits</span></div>
            <div class="stat"><strong>${report.readyGroups}</strong><span>Ready</span></div>
            <div class="stat"><strong>${report.errorCount}</strong><span>Errors</span></div>
            <div class="stat"><strong>${report.warningCount}</strong><span>Warnings</span></div>
          </div>
          <div class="group">
            <strong>Technical check</strong>
            <div>
              Cadle checks missing links and conflicting circuit values before building the diagram. Confirm suggested
              protection and cable values against the installation before inspection.
            </div>
          </div>
          <div class="issues">
            <div class="row">
              <strong>Needs attention</strong>
              <span>${report.issues.length} item${report.issues.length === 1 ? '' : 's'}</span>
            </div>
            ${report.issues.length === 0
              ? html`<div class="group">
                  <div class="row"><strong>All circuit data is complete</strong><span class="pill ok">ready</span></div>
                </div>`
              : report.issues.map(
                  (issue: ValidationIssue) => html`
                    <div
                      class="issue"
                      data-severity=${issue.severity}>
                      <div class="row">
                        <strong>${issue.bindingId}</strong>
                        <div class="issue-actions">
                          <span class="pill ${issue.severity === 'error' ? 'error' : 'warn'}">${issue.severity}</span>
                          <button @click=${() => this.#focusBinding(issue.bindingId)}>Review circuit</button>
                        </div>
                      </div>
                      <div>${issue.message}</div>
                    </div>
                  `
                )}
          </div>
          <div class="groups">
            <div class="row"><strong>Circuit details</strong></div>
            ${report.groups.map(
              (group: ValidationGroup) => html`
                <details class="group circuit-detail">
                  <summary class="row">
                    <strong>${group.bindingId}</strong>
                    <span class="pill ${group.ready ? 'ok' : 'warn'}">${group.ready ? 'ready' : 'incomplete'}</span>
                  </summary>
                  <div class="circuit-detail-body">
                    <div>${group.switches} switches • ${group.loads} loads/sockets • ${group.neutral} other</div>
                    ${group.specification
                      ? html`
                          <div>
                            ${group.specification.breakerCurrentA} A (${group.specification.sources.breakerCurrentA}) •
                            ${group.specification.cableSectionMm2} mm² (${group.specification.sources.cableSectionMm2})
                            • ${group.specification.poles}P (${group.specification.sources.poles}) •
                            ${group.specification.phaseConfiguration === 'three-phase' ? '3-phase' : '1-phase'}
                            (${group.specification.sources.phaseConfiguration})
                          </div>
                          <div>
                            ${group.specification.breakerCurve
                              ? `Curve ${group.specification.breakerCurve}`
                              : 'Curve not set'}
                            •
                            ${group.specification.rcdSensitivityMa
                              ? `${group.specification.rcdSensitivityMa} mA ${group.specification.rcdType ?? ''}`
                              : 'No circuit-specific RCD'}
                            • ${group.specification.boardId ?? 'main'} / ${group.specification.railId ?? 'rail-1'}
                          </div>
                          ${group.specification.notes ? html`<div>${group.specification.notes}</div>` : ''}
                        `
                      : ''}
                  </div>
                </details>
              `
            )}
          </div>
        </div>
        <div class="footer">
          <div>
            ${report.valid
              ? 'Everything is ready. Cadle can build the one-wire diagram now.'
              : 'Review the errors above before creating the one-wire diagram.'}
          </div>
          <div class="footer-actions">
            <button @click=${this.#close}>Close</button>
            ${report.valid
              ? html`<button
                  class="primary"
                  @click=${this.#generate}>
                  Create one-wire diagram
                </button>`
              : ''}
          </div>
        </div>
      </div>
    `
  }
}
