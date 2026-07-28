import { LiteElement, customElement, html, property } from '@vandeurenglenn/lite'
import '@vandeurenglenn/lite-elements/button.js'
import styles from './project-share-dialog.css' with { type: 'css' }
import type { Project } from '../../types.js'
import {
  peernetProjectShare,
  type CadlePeer,
  type ProjectOffer,
  type ProjectTransfer
} from '../../sharing/peernet-project-share.js'
import { importProjectPayload } from '../../api/project.js'

type PendingSend = { peer: CadlePeer; transferId: string; project: Project & { projectKey: string } }
const encoder = new TextEncoder()

const projectChecksum = async (project: Project & { projectKey: string }) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(project)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

@customElement('project-share-dialog')
export class ProjectShareDialog extends LiteElement {
  static styles = [styles]

  @property({ type: Boolean, reflect: true }) accessor open = false
  @property({ attribute: false }) accessor project: Project | undefined = undefined
  @property({ type: String }) accessor projectKey = ''
  @property({ type: String }) accessor status = ''
  @property({ type: Array }) accessor peers: CadlePeer[] = []
  @property({ attribute: false }) accessor incomingOffer: ProjectOffer | undefined = undefined

  #pendingSend?: PendingSend
  #acceptedOffer?: ProjectOffer
  #connected = false

  onChange(property: string) {
    if (property === 'open' && this.open) void this.#connect()
  }

  disconnectedCallback() {
    this.#removeListeners()
    super.disconnectedCallback()
  }

  async #connect() {
    if (this.#connected) {
      await peernetProjectShare.announce()
      this.#updatePeers()
      return
    }
    this.status = 'Andere Cadle-apparaten zoeken…'
    try {
      await peernetProjectShare.start()
      this.#connected = true
      peernetProjectShare.addEventListener('peers-changed', this.#updatePeers)
      peernetProjectShare.addEventListener('offer', this.#receiveOffer)
      peernetProjectShare.addEventListener('accept', this.#acceptSend)
      peernetProjectShare.addEventListener('decline', this.#declineSend)
      peernetProjectShare.addEventListener('project', this.#receiveProject)
      this.#updatePeers()
      this.status = ''
    } catch (error) {
      console.error('Unable to start Cadle peer sharing', error)
      this.status = 'P2P delen kon niet worden gestart. Gebruik de systeemdeelknop als alternatief.'
    }
  }

  #removeListeners() {
    if (!this.#connected) return
    peernetProjectShare.removeEventListener('peers-changed', this.#updatePeers)
    peernetProjectShare.removeEventListener('offer', this.#receiveOffer)
    peernetProjectShare.removeEventListener('accept', this.#acceptSend)
    peernetProjectShare.removeEventListener('decline', this.#declineSend)
    peernetProjectShare.removeEventListener('project', this.#receiveProject)
    this.#connected = false
  }

  #updatePeers = () => {
    this.peers = peernetProjectShare.peers
  }

  #receiveOffer = (event: Event) => {
    this.incomingOffer = (event as CustomEvent<ProjectOffer>).detail
  }

  #acceptSend = (event: Event) => {
    const message = (event as CustomEvent<{ senderId: string; transferId: string }>).detail
    const pending = this.#pendingSend
    if (!pending || pending.transferId !== message.transferId || pending.peer.id !== message.senderId) return
    void peernetProjectShare.sendProject(pending.peer.id, pending.transferId, pending.project).then(() => {
      this.status = `${pending.project.name} is verstuurd naar ${pending.peer.name}.`
      this.#pendingSend = undefined
    })
  }

  #declineSend = (event: Event) => {
    const message = (event as CustomEvent<{ transferId: string }>).detail
    if (this.#pendingSend?.transferId !== message.transferId) return
    this.status = 'De ontvanger heeft de overdracht geweigerd.'
    this.#pendingSend = undefined
  }

  #receiveProject = async (event: Event) => {
    const transfer = (event as CustomEvent<ProjectTransfer>).detail
    try {
      const accepted = this.#acceptedOffer
      if (!accepted || accepted.transferId !== transfer.transferId || accepted.senderId !== transfer.senderId) {
        throw new Error('Shared project was not accepted')
      }
      if (transfer.checksum !== accepted.checksum || await projectChecksum(transfer.project) !== transfer.checksum) {
        throw new Error('Shared project checksum does not match')
      }
      await importProjectPayload(transfer.project)
      this.status = `${transfer.project.name} is ontvangen en aan je projecten toegevoegd.`
      this.incomingOffer = undefined
      this.#acceptedOffer = undefined
      this.dispatchEvent(new CustomEvent('project-received', { bubbles: true, composed: true }))
    } catch (error) {
      console.error('Unable to import shared Cadle project', error)
      this.status = 'Het ontvangen project is ongeldig en werd niet geïmporteerd.'
    }
  }

  #send = async (peer: CadlePeer) => {
    if (!this.project || !this.projectKey) return
    const project = { ...this.project, projectKey: this.projectKey }
    const transferId = await peernetProjectShare.offer(peer.id, project)
    this.#pendingSend = { peer, transferId, project }
    this.status = `Wachten op bevestiging van ${peer.name}…`
  }

  #answerOffer = async (accept: boolean) => {
    if (!this.incomingOffer) return
    if (accept) this.#acceptedOffer = this.incomingOffer
    await peernetProjectShare.respond(this.incomingOffer, accept)
    if (accept) this.status = `${this.incomingOffer.projectName} ontvangen…`
    this.incomingOffer = undefined
  }

  #nativeShare = async () => {
    if (!this.project) return
    const file = new File(
      [JSON.stringify({ ...this.project, projectKey: this.projectKey }, null, 2)],
      `${this.project.name || 'cadle-project'}.json`,
      { type: 'application/json' }
    )
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: this.project.name, files: [file] })
      } else {
        await navigator.share({ title: this.project.name, text: 'Cadle project' })
      }
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') this.status = 'Systeemdelen is niet beschikbaar.'
    }
  }

  #close = () => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))

  render() {
    return html`
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="project-share-title">
        <header>
          <div class="hero-mark" aria-hidden="true">
            <span class="hero-node node-left"></span>
            <span class="hero-node node-right"></span>
            <span class="hero-path"></span>
          </div>
          <div class="heading-copy">
            <span class="eyebrow">P2P · zonder cloudupload</span>
            <h3 id="project-share-title">Delen met Cadle</h3>
            <p>Kies een apparaat en stuur je project rechtstreeks door.</p>
          </div>
          <custom-button type="text" label="Sluiten" @click=${this.#close}></custom-button>
        </header>
        <main>
          <section class="project-summary" aria-label="Project dat wordt gedeeld">
            <span class="project-glyph" aria-hidden="true"></span>
            <span>
              <small>Geselecteerd project</small>
              <strong>${this.project?.name || 'Cadle project'}</strong>
            </span>
            <span class="ready-badge"><i></i>Klaar om te delen</span>
          </section>
          ${this.incomingOffer ? html`
            <section class="offer">
              <span class="offer-symbol" aria-hidden="true">↓</span>
              <span class="offer-copy">
                <strong>${this.incomingOffer.senderName} wil “${this.incomingOffer.projectName}” delen</strong>
                <small>${Math.max(1, Math.ceil(this.incomingOffer.byteLength / 1024))} kB · alleen importeren na jouw bevestiging</small>
              </span>
              <div class="offer-actions">
                <custom-button type="text" label="Weigeren" @click=${() => this.#answerOffer(false)}></custom-button>
                <custom-button type="filled" label="Ontvangen" @click=${() => this.#answerOffer(true)}></custom-button>
              </div>
            </section>
          ` : ''}
          <section class="devices" aria-label="Beschikbare apparaten">
            ${this.peers.length ? this.peers.map((peer) => html`
              <button class="device" type="button" @click=${() => this.#send(peer)}>
                <span class="device-icon">${peer.name.slice(0, 1).toUpperCase()}</span>
                <span class="device-copy"><strong>${peer.name}</strong><small>Beschikbaar via Cadle</small></span>
                <span class="send-label">Stuur <b aria-hidden="true">→</b></span>
              </button>
            `) : html`
              <div class="empty">
                <span class="radar" aria-hidden="true"><i></i></span>
                <div>
                  <strong>Op zoek naar apparaten…</strong>
                  <span>Open deze deelweergave ook op het ontvangende apparaat.</span>
                </div>
              </div>
            `}
          </section>
          ${this.status ? html`<p class="status" role="status">${this.status}</p>` : ''}
        </main>
        <footer>
          <span class="privacy-note"><i aria-hidden="true"></i>De ontvanger moet iedere overdracht bevestigen.</span>
          <custom-button type="outlined" label="Delen via systeem" @click=${this.#nativeShare}></custom-button>
        </footer>
      </section>
    `
  }
}
