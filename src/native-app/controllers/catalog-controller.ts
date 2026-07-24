import type { Shape } from '../../native-draw/types.js'
import { buildCatalogSelectionDraft } from '../layout/catalog-selection.js'

export class CatalogController {
  selectionDraft(shapes: readonly Shape[], selectedShapeIds: Iterable<string>) {
    return buildCatalogSelectionDraft(shapes, selectedShapeIds)
  }
}
