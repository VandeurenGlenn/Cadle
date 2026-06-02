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
}

type ValidationReport = {
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
  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ attribute: false }) accessor report: ValidationReport | null = null
  @property({ type: String }) accessor projectName = ''
  static styles = [styles]

  #close = () => {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))
  }

  #focusBinding(bindingId: string) {
    this.dispatchEvent(new CustomEvent('focus-binding', { bubbles: true, composed: true, detail: { bindingId } }))
  }

  #generateOneWire() {
    this.dispatchEvent(new CustomEvent('generate-one-wire', { bubbles: true, composed: true }))
  }

  render() {
    const report = this.report
    if (!report) return html``
    return html`
      <div
        class="panel"
        @click=${(event: Event) => event.stopPropagation()}>
        <div class="header">
          <div class="title">
            <h3>Binding Validation</h3>
            <p>${this.projectName || 'Current project'} • review one-wire readiness and jump to issues</p>
          </div>
          <button @click=${this.#close}>Close</button>
        </div>
        <div class="content">
          <div class="stats">
            <div class="stat"><strong>${report.totalGroups}</strong><span>Total groups</span></div>
            <div class="stat"><strong>${report.readyGroups}</strong><span>Ready circuits</span></div>
            <div class="stat"><strong>${report.errorCount}</strong><span>Errors</span></div>
            <div class="stat"><strong>${report.warningCount}</strong><span>Warnings</span></div>
          </div>
          <div class="issues">
            <div class="row">
              <strong>Issues</strong>
              <span>${report.issues.length} item${report.issues.length === 1 ? '' : 's'}</span>
            </div>
            ${report.issues.length === 0
              ? html`<div class="group">
                  <div class="row"><strong>No issues found</strong><span class="pill ok">ready</span></div>
                </div>`
              : report.issues.map(
                  (issue: ValidationIssue) => html`
                    <div
                      class="issue"
                      data-severity=${issue.severity}
                      @click=${() => this.#focusBinding(issue.bindingId)}>
                      <div class="row">
                        <strong>${issue.bindingId}</strong>
                        <span class="pill ${issue.severity === 'error' ? 'error' : 'warn'}">${issue.severity}</span>
                      </div>
                      <div>${issue.message}</div>
                    </div>
                  `
                )}
          </div>
          <div class="groups">
            <div class="row"><strong>Binding groups</strong></div>
            ${report.groups.map(
              (group: ValidationGroup) => html`
                <div class="group">
                  <div class="row">
                    <strong>${group.bindingId}</strong>
                    <span class="pill ${group.ready ? 'ok' : 'warn'}">${group.ready ? 'ready' : 'incomplete'}</span>
                  </div>
                  <div>${group.switches} switches • ${group.loads} loads/sockets • ${group.neutral} other</div>
                </div>
              `
            )}
          </div>
        </div>
        <div class="footer">
          <div>${report.valid ? 'Validation passed.' : 'Fix issues or continue when you are ready.'}</div>
          <div class="footer-actions">
            <button @click=${this.#close}>Done</button>
            <button
              class="primary"
              ?disabled=${report.totalGroups === 0}
              @click=${this.#generateOneWire}>
              Generate One-Wire
            </button>
          </div>
        </div>
      </div>
    `
  }
}
