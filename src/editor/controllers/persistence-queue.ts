export type PersistenceOperation = () => Promise<unknown>

export class PersistenceQueue {
  #pending: Promise<void> = Promise.resolve()
  #error: unknown = null

  enqueue(operation: PersistenceOperation): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      try {
        await operation()
        this.#error = null
      } catch (error) {
        this.#error = error
      }
    })
    return this.#pending
  }

  async flush(): Promise<void> {
    await this.#pending
    if (this.#error) throw this.#error
  }
}
