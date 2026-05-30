export interface HistorySnapshotSchedulerOptions {
  takeSnapshot: (label: string) => void
}

/**
 * Coalesces multiple snapshot requests within the same animation frame into a
 * single capture. Keeps history-snapshot bookkeeping out of the host element.
 *
 * The actual snapshot logic (serializing the canvas, pushing onto the stack)
 * stays on `DrawField` because it needs direct canvas/JSON access. This class
 * only owns the scheduling + the small label-derivation helper.
 */
export class HistorySnapshotScheduler {
  #options: HistorySnapshotSchedulerOptions
  #scheduled = false
  #pendingLabel = 'Updated canvas'

  constructor(options: HistorySnapshotSchedulerOptions) {
    this.#options = options
  }

  /**
   * Request a snapshot at the next animation frame. Repeated calls before
   * the frame fires only retain the most recent label.
   */
  schedule(label = 'Updated canvas') {
    this.#pendingLabel = label
    if (this.#scheduled) return
    this.#scheduled = true

    requestAnimationFrame(() => {
      this.#scheduled = false
      this.#options.takeSnapshot(this.#pendingLabel)
    })
  }

  /**
   * Best-effort human label for a Fabric target, used to describe what
   * changed in the history entry.
   */
  describeTarget(target: any): string {
    if (typeof target?.symbolName === 'string' && target.symbolName) return target.symbolName
    if (typeof target?.type === 'string') return target.type.replace('Cadle', '')
    return 'object'
  }
}
