import { cloneShapes } from '../../editor/model/model.js'
import type { Snapshot } from '../../editor/model/types.js'

const cloneSnapshot = (snapshot: Snapshot): Snapshot => ({
  ...snapshot,
  shapes: cloneShapes(snapshot.shapes)
})

/**
 * Owns the editor's undo/redo timeline without knowing about rendering,
 * persistence, or the custom element lifecycle.
 */
export class DocumentHistory {
  #entries: Snapshot[] = []
  #index = -1

  reset(): void {
    this.#entries = []
    this.#index = -1
  }

  push(snapshot: Snapshot, replaceCurrent = false): void {
    const next = cloneSnapshot(snapshot)
    if (replaceCurrent && this.#index >= 0) {
      this.#entries[this.#index] = next
      return
    }

    this.#entries = this.#entries.slice(0, this.#index + 1)
    this.#entries.push(next)
    this.#index = this.#entries.length - 1
  }

  undo(): Snapshot | null {
    if (this.#index <= 0) return null
    this.#index -= 1
    return cloneSnapshot(this.#entries[this.#index])
  }

  redo(): Snapshot | null {
    if (this.#index >= this.#entries.length - 1) return null
    this.#index += 1
    return cloneSnapshot(this.#entries[this.#index])
  }
}
