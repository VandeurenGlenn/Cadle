/**
 * Multi-user presence sync.
 *
 * Transport-agnostic: wraps a {@link MultiUserTransport} so the same
 * controller works for cross-tab sync (BroadcastChannel) or a future
 * authenticated cross-machine transport. Default = BroadcastChannel;
 * pass a maintained transport to {@link PresenceController.connect}.
 *
 * Owns the remote-cursor map and the periodic stale-cursor sweep.
 * The shell wires this controller to its own `field.remoteCursors`
 * via the `onSync` callback.
 */

import { BroadcastChannelTransport, type MultiUserMessage, type MultiUserTransport } from './multi-user-transport.js'

export type PresenceCursor = {
  id: string
  name: string
  color: string
  x: number
  y: number
  projectKey: string
  pageKey: string
  updatedAt: number
}

const STALE_MS = 10000
const SWEEP_INTERVAL_MS = 2000

type PresencePayload = {
  name: string
  color: string
  x: number
  y: number
  hidden: boolean
}

export class PresenceController {
  readonly id: string = crypto.randomUUID()
  readonly name: string
  readonly color: string

  private transport?: MultiUserTransport
  private unsubscribe?: () => void
  private timer?: number
  private remote = new Map<string, PresenceCursor>()
  private onSync: () => void

  constructor(name: string, color: string, onSync: () => void) {
    this.name = name
    this.color = color
    this.onSync = onSync
  }

  /**
   * Connect using the supplied transport. Defaults to
   * {@link BroadcastChannelTransport} for backwards compatibility.
   */
  connect(transport: MultiUserTransport = new BroadcastChannelTransport('cadle-presence')): void {
    if (this.transport) return
    this.transport = transport
    void transport.connect()
      .then(() => {
        if (this.transport !== transport) {
          void transport.disconnect()
          return
        }
        this.unsubscribe = transport.onMessage(this.#handleMessage)
      })
      .catch(() => {
        if (this.transport !== transport) return
        this.transport = undefined
        if (this.timer) {
          clearInterval(this.timer)
          this.timer = undefined
        }
      })
    this.timer = window.setInterval(this.#sweepStaleCursors, SWEEP_INTERVAL_MS)
  }

  disconnect(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    void this.transport?.disconnect()
    this.transport = undefined

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  broadcast(projectKey: string, pageKey: string, position?: { x: number; y: number }, hidden = false): void {
    if (!this.transport || !projectKey || !pageKey) return

    const payload: PresencePayload = {
      name: this.name,
      color: this.color,
      x: position?.x ?? 0,
      y: position?.y ?? 0,
      hidden
    }
    this.transport.send({
      type: 'presence',
      senderId: this.id,
      projectKey,
      pageKey,
      payload,
      timestamp: Date.now()
    })
  }

  /**
   * Active remote cursors for the given project + page that are not stale.
   */
  activeCursors(projectKey: string, pageKey: string): PresenceCursor[] {
    const now = Date.now()
    return [...this.remote.values()].filter(
      (cursor) => cursor.projectKey === projectKey && cursor.pageKey === pageKey && now - cursor.updatedAt < STALE_MS
    )
  }

  #sweepStaleCursors = () => {
    if (this.remote.size === 0) return
    const cutoff = Date.now() - STALE_MS
    let changed = false
    for (const [id, cursor] of this.remote) {
      if (cursor.updatedAt >= cutoff) continue
      this.remote.delete(id)
      changed = true
    }
    if (changed) this.onSync()
  }

  #handleMessage = (message: MultiUserMessage) => {
    if (message.type !== 'presence' || message.senderId === this.id) return

    const payload = message.payload as Partial<PresencePayload> | undefined
    const key = message.senderId
    if (!payload || payload.hidden) {
      this.remote.delete(key)
      this.onSync()
      return
    }

    this.remote.set(key, {
      id: key,
      name: String(payload.name ?? 'Remote user'),
      color: String(payload.color ?? '#a85427'),
      x: Number(payload.x ?? 0),
      y: Number(payload.y ?? 0),
      projectKey: String(message.projectKey ?? ''),
      pageKey: String(message.pageKey ?? ''),
      updatedAt: Number(message.timestamp ?? Date.now())
    })
    this.onSync()
  }
}
