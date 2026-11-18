export type PersistenceOperation = () => Promise<unknown>
export type PersistenceState =
  | { status: 'idle' | 'saving' | 'saved' }
  | { status: 'error'; error: unknown }

export class PersistenceQueue {
  #pending: Promise<void> = Promise.resolve()
  #error: unknown = null
  #failed = false
  #operations: PersistenceOperation[] = []
  #running = false
  #state: PersistenceState = { status: 'idle' }

  constructor(private readonly onStateChange?: (state: PersistenceState) => void) {}

  get state(): PersistenceState { return this.#state }

  #setState(state: PersistenceState): void {
    this.#state = state
    this.onStateChange?.(state)
  }

  enqueue(operation: PersistenceOperation): Promise<void> {
    this.#operations.push(operation)
    this.#start()
    return this.#pending
  }

  #start(): void {
    if (this.#running || this.#failed || !this.#operations.length) return
    this.#running = true
    this.#setState({ status: 'saving' })
    this.#pending = this.#pending.then(async () => {
      try {
        while (this.#operations.length) {
          await this.#operations[0]()
          this.#operations.shift()
        }
        this.#setState({ status: 'saved' })
      } catch (error) {
        // Keep the failed write and its successors in order until an explicit retry.
        this.#failed = true
        this.#error = error
        this.#setState({ status: 'error', error })
      } finally {
        this.#running = false
      }
    })
  }

  async retry(): Promise<void> {
    await this.#pending
    this.#failed = false
    this.#error = null
    this.#start()
    await this.flush()
  }

  async flush(): Promise<void> {
    await this.#pending
    if (this.#failed) throw this.#error
  }
}
