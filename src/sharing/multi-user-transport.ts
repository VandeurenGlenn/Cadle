/**
 * Multi-user transport adapter.
 *
 * Cadle ships with a built-in `BroadcastChannel` transport in
 * `presence.ts` that syncs cursors across tabs of the same browser.
 * To go cross-machine you plug in a different transport implementing
 * the {@link MultiUserTransport} interface below.
 *
 * Candidates that fit this interface without changes:
 *   - Y.js + WebSocket / WebRTC provider.
 *   - Liveblocks / Supabase Realtime (managed).
 *
 * The interface is intentionally minimal: every transport has SOME way
 * to "send a typed payload" and "subscribe to incoming payloads from
 * other peers". Authentication, encryption and identity management are
 * the transport's responsibility, not Cadle's.
 */

import type { JsonValue } from '../types.js'

export type MultiUserMessage<T = JsonValue> = {
  type: string
  /** Stable per-session sender id; opaque to the transport. */
  senderId: string
  /** Project + page scope so receivers can filter. */
  projectKey: string
  pageKey: string
  payload: T
  /** Wall-clock timestamp; used for staleness sweeps. */
  timestamp: number
}

export interface MultiUserTransport {
  readonly name: string
  /** Connect / authenticate. Idempotent; safe to call repeatedly. */
  connect(): Promise<void>
  /** Disconnect and release resources. */
  disconnect(): Promise<void>
  /** Send a message to all other peers. Best-effort, no delivery guarantee. */
  send(message: MultiUserMessage): void
  /**
   * Subscribe to incoming messages. Returns an unsubscribe function.
   * Implementations MUST NOT echo the sender's own messages back.
   */
  onMessage(handler: (message: MultiUserMessage) => void): () => void
}

/**
 * Reference implementation: same-browser-only multi-tab transport.
 * Identical wire-format to a future cross-machine transport so the
 * shell can hot-swap implementations.
 */
export class BroadcastChannelTransport implements MultiUserTransport {
  readonly name = 'broadcast-channel'
  private channel?: BroadcastChannel
  private handlers = new Set<(message: MultiUserMessage) => void>()
  private senderId = crypto.randomUUID()
  private channelName: string

  constructor(channelName = 'cadle-multi-user') {
    this.channelName = channelName
  }

  async connect(): Promise<void> {
    if (this.channel || !('BroadcastChannel' in globalThis)) return
    this.channel = new BroadcastChannel(this.channelName)
    this.channel.addEventListener('message', this.#receive)
  }

  async disconnect(): Promise<void> {
    this.channel?.removeEventListener('message', this.#receive)
    this.channel?.close()
    this.channel = undefined
  }

  send(message: MultiUserMessage): void {
    if (!this.channel) return
    this.channel.postMessage({ ...message, senderId: this.senderId })
  }

  onMessage(handler: (message: MultiUserMessage) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  #receive = (event: MessageEvent<MultiUserMessage>) => {
    const m = event.data
    if (!m || typeof m !== 'object' || m.senderId === this.senderId) return
    for (const h of this.handlers) h(m)
  }
}
