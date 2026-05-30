/**
 * Multi-user transport adapter.
 *
 * Cadle ships with a built-in `BroadcastChannel` transport in
 * `presence.ts` that syncs cursors across tabs of the same browser.
 * To go cross-machine you plug in a different transport implementing
 * the {@link MultiUserTransport} interface below.
 *
 * Candidates that fit this interface without changes:
 *   - `@leofcoin/peernet` — P2P over WebRTC, owned by Cadle authors.
 *     Map `addRequestHandler('cadle-presence', ...)` + `peernet.broadcast`
 *     to {@link onMessage} / {@link send}.
 *   - Y.js + WebSocket / WebRTC provider.
 *   - Liveblocks / Supabase Realtime (managed).
 *
 * The interface is intentionally minimal: every transport has SOME way
 * to "send a typed payload" and "subscribe to incoming payloads from
 * other peers". Authentication, encryption and identity management are
 * the transport's responsibility, not Cadle's.
 */

export type MultiUserMessage<T = unknown> = {
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

/**
 * Peernet-backed transport. Uses the public Leofcoin "peach" network
 * and signaling stars for cross-machine multi-user sync.
 *
 * Identity strategy (v1, intentionally simple):
 *   - Auto-generate a per-browser password and persist it in
 *     localStorage under `cadle-peernet-secret`. This means the
 *     identity survives reloads but is not transferable; the user is
 *     never prompted. Good enough for ephemeral cursor / presence sync.
 *   - For project-level auth or signed edits this should be replaced
 *     by a real password prompt + recoverable identity. Tracked in
 *     `/memories/repo/cadle-roadmap-next.md`.
 *
 * Wire format: tiny JSON payload, identical to BroadcastChannel
 * transport, so the shell never sees the underlying transport choice.
 */
export class PeernetTransport implements MultiUserTransport {
  readonly name = 'peernet'
  private node?: PeernetNodeLike
  private handlers = new Set<(message: MultiUserMessage) => void>()
  private senderId = crypto.randomUUID()
  private topic: string
  private subscribed = false

  constructor(topic = 'cadle-multi-user') {
    this.topic = topic
  }

  async connect(): Promise<void> {
    if (this.node) return
    const { default: Peernet } = (await import('@leofcoin/peernet')) as unknown as { default: PeernetCtor }
    const password = readOrCreatePassword()
    const node = await new Peernet(
      {
        network: 'leofcoin:peach',
        networkVersion: 'peach',
        stars: ['wss://peach.leofcoin.org']
      },
      password
    )
    if (typeof node.start === 'function') await node.start()
    this.node = node
    if (!this.subscribed) {
      await node.subscribe(this.topic, this.#onPubSub)
      this.subscribed = true
    }
  }

  async disconnect(): Promise<void> {
    this.handlers.clear()
    this.subscribed = false
    this.node = undefined
  }

  send(message: MultiUserMessage): void {
    if (!this.node) return
    const stamped: MultiUserMessage = { ...message, senderId: this.senderId }
    void this.node.publish(this.topic, JSON.stringify(stamped))
  }

  onMessage(handler: (message: MultiUserMessage) => void): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  #onPubSub = (data: unknown) => {
    let raw: string | undefined
    if (typeof data === 'string') raw = data
    else if (data instanceof Uint8Array) raw = new TextDecoder().decode(data)
    else if (data && typeof (data as { data?: unknown }).data === 'string') raw = (data as { data: string }).data
    if (!raw) return
    let parsed: MultiUserMessage
    try {
      parsed = JSON.parse(raw) as MultiUserMessage
    } catch {
      return
    }

    if (!parsed || parsed.senderId === this.senderId) return
    for (const h of this.handlers) h(parsed)
  }
}

interface PeernetNodeLike {
  start?: () => Promise<void>
  publish: (topic: string, data: unknown) => Promise<void>
  subscribe: (topic: string, cb: (data: unknown) => void) => Promise<void>
}

type PeernetCtor = new (config: PeernetConfig, password: string) => Promise<PeernetNodeLike>

interface PeernetConfig {
  network: string
  networkVersion?: string
  stars: string[]
}

function readOrCreatePassword(): string {
  const key = 'cadle-peernet-secret'
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const fresh = crypto.randomUUID() + crypto.randomUUID()
    localStorage.setItem(key, fresh)
    return fresh
  } catch {
    // Private mode / no localStorage — fall back to ephemeral secret.
    return crypto.randomUUID() + crypto.randomUUID()
  }
}
