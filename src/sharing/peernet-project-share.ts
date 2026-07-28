import type { Project } from '../types.js'
import '../shims/process.js'

const NETWORK = 'leofcoin:peach'
const NETWORK_VERSION = 'peach'
// Matches @leofcoin/networks' current peach rendezvous configuration.
const STAR = 'wss://star.leofcoin.org'
const TOPIC = 'cadle:project-share:v1'
const IDENTITY_SECRET_KEY = 'cadle.peernet.identity-secret'
const DISPLAY_NAME_KEY = 'cadle.presenceName'
const MAX_PROJECT_BYTES = 20 * 1024 * 1024

type ShareMessage =
  | { type: 'presence'; senderId: string; senderName: string; timestamp: number }
  | {
      type: 'offer'
      senderId: string
      senderName: string
      recipientId: string
      transferId: string
      projectName: string
      byteLength: number
      checksum: string
      timestamp: number
    }
  | { type: 'accept' | 'decline'; senderId: string; recipientId: string; transferId: string; timestamp: number }
  | {
      type: 'project'
      senderId: string
      recipientId: string
      transferId: string
      project: Project & { projectKey: string }
      checksum: string
      timestamp: number
    }

export type CadlePeer = { id: string; name: string; lastSeen: number }
export type ProjectOffer = Extract<ShareMessage, { type: 'offer' }>
export type ProjectTransfer = Extract<ShareMessage, { type: 'project' }>

type PeernetNode = {
  id: string
  publish(topic: string, data: Uint8Array): Promise<void>
  subscribe(topic: string, callback: (data: Uint8Array) => void): Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const identitySecret = () => {
  let secret = localStorage.getItem(IDENTITY_SECRET_KEY)
  if (!secret) {
    secret = `${crypto.randomUUID()}-${crypto.randomUUID()}`
    localStorage.setItem(IDENTITY_SECRET_KEY, secret)
  }
  return secret
}

const displayName = () => localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || 'Cadle user'

const checksum = async (data: Uint8Array) => {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(data).buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const decodeMessage = (data: Uint8Array): ShareMessage | undefined => {
  try {
    const value = JSON.parse(decoder.decode(data)) as ShareMessage
    return value && typeof value === 'object' && typeof value.type === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

export class PeernetProjectShare extends EventTarget {
  #node?: PeernetNode
  #starting?: Promise<void>
  #peers = new Map<string, CadlePeer>()

  get id() {
    return this.#node?.id ?? ''
  }

  get peers() {
    const freshAfter = Date.now() - 45_000
    return [...this.#peers.values()]
      .filter((peer) => peer.lastSeen >= freshAfter)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  start() {
    this.#starting ??= this.#start().catch((error) => {
      this.#starting = undefined
      throw error
    })
    return this.#starting
  }

  async #start() {
    const { default: Peernet } = await import('@leofcoin/peernet/browser')
    this.#node = (await new Peernet(
      {
        network: NETWORK,
        networkVersion: NETWORK_VERSION,
        version: '1.0.0',
        stars: [STAR],
        storePrefix: 'cadle-share',
        root: '.cadle/share',
        autoStart: true
      },
      identitySecret()
    )) as unknown as PeernetNode
    await this.#node.subscribe(TOPIC, this.#receive)
    await this.announce()
    setInterval(() => void this.announce(), 15_000)
  }

  async announce() {
    if (!this.#node) return
    await this.#publish({
      type: 'presence',
      senderId: this.#node.id,
      senderName: displayName(),
      timestamp: Date.now()
    })
  }

  async offer(recipientId: string, project: Project & { projectKey: string }) {
    if (!this.#node) throw new Error('Peernet is not ready')
    const transferId = crypto.randomUUID()
    const projectBytes = encoder.encode(JSON.stringify(project))
    const byteLength = projectBytes.byteLength
    if (byteLength > MAX_PROJECT_BYTES) throw new Error('Project is too large to share')
    await this.#publish({
      type: 'offer',
      senderId: this.#node.id,
      senderName: displayName(),
      recipientId,
      transferId,
      projectName: project.name,
      byteLength,
      checksum: await checksum(projectBytes),
      timestamp: Date.now()
    })
    return transferId
  }

  respond(offer: ProjectOffer, accept: boolean) {
    if (!this.#node) throw new Error('Peernet is not ready')
    return this.#publish({
      type: accept ? 'accept' : 'decline',
      senderId: this.#node.id,
      recipientId: offer.senderId,
      transferId: offer.transferId,
      timestamp: Date.now()
    })
  }

  async sendProject(recipientId: string, transferId: string, project: Project & { projectKey: string }) {
    if (!this.#node) throw new Error('Peernet is not ready')
    const projectBytes = encoder.encode(JSON.stringify(project))
    if (projectBytes.byteLength > MAX_PROJECT_BYTES) throw new Error('Project is too large to share')
    return this.#publish({
      type: 'project',
      senderId: this.#node.id,
      recipientId,
      transferId,
      project,
      checksum: await checksum(projectBytes),
      timestamp: Date.now()
    })
  }

  async #publish(message: ShareMessage) {
    await this.#node?.publish(TOPIC, encoder.encode(JSON.stringify(message)))
  }

  #receive = (data: Uint8Array) => {
    const message = decodeMessage(data)
    if (!message || message.senderId === this.id) return
    if (message.type === 'presence') {
      const knownPeer = this.#peers.has(message.senderId)
      this.#peers.set(message.senderId, {
        id: message.senderId,
        name: message.senderName,
        lastSeen: Date.now()
      })
      this.dispatchEvent(new Event('peers-changed'))
      if (!knownPeer) void this.announce()
      return
    }
    if ('recipientId' in message && message.recipientId !== this.id) return
    this.dispatchEvent(new CustomEvent(message.type, { detail: message }))
  }
}

export const peernetProjectShare = new PeernetProjectShare()
