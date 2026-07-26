import type { Shape } from '../../editor/model/types.js'
import { DocumentHistory } from './document-history.js'

export class CanvasDocumentController {
  shapes: Shape[] = []
  selectedId: string | null = null
  selectedIds = new Set<string>()
  readonly history = new DocumentHistory()

  replaceShapes(shapes: readonly Shape[]): void {
    this.shapes = [...shapes]
    this.retainExistingSelection()
  }

  clearSelection(): void {
    this.selectedId = null
    this.selectedIds = new Set()
  }

  retainExistingSelection(): void {
    const ids = new Set(this.shapes.map((shape) => shape.id))
    this.selectedIds = new Set([...this.selectedIds].filter((id) => ids.has(id)))
    if (this.selectedId && !ids.has(this.selectedId)) this.selectedId = null
  }
}
