import { cloneShape } from '../../editor/model/model.js'
import type { DragState, Point, Shape } from '../../editor/model/types.js'

export type ResolveSelectPointerDownInput = {
  shapeId: string | null
  rawPoint: Point
  selectedIds: Set<string>
  selectedId: string | null
  shapes: Shape[]
}

export type ResolveSelectPointerDownResult = {
  selectedIds: Set<string>
  selectedId: string | null
  drag: DragState | null
  bandStart: Point | null
  bandEnd: Point | null
}

const shapeById = (shapes: Shape[], id: string | null): Shape | null => {
  if (!id) return null
  return shapes.find((shape) => shape.id === id) ?? null
}

export const dragIdsForSelectedShape = (
  shapes: Shape[],
  shapeId: string,
  selectedIds: ReadonlySet<string>
): string[] => {
  const shape = shapeById(shapes, shapeId)
  const isOneWireBreaker =
    shape?.kind === 'symbol' &&
    shape.groupId?.startsWith('onewire-') &&
    (shape.sourceLink?.role === 'breaker' || /automaat|breaker/i.test(`${shape.name} ${shape.path}`))
  if (!isOneWireBreaker || !shape.groupId) return [...selectedIds]

  const ids = new Set(selectedIds)
  for (const candidate of shapes) {
    if (candidate.groupId === shape.groupId) ids.add(candidate.id)
  }
  return [...ids]
}

export const shouldSelectExistingOneWireShape = (
  shape: Shape | null,
  isKamrail: boolean
): boolean => shape !== null && !isKamrail

export const resolveSelectPointerDown = (
  input: ResolveSelectPointerDownInput
): ResolveSelectPointerDownResult => {
  if (input.shapeId) {
    const nextSelectedIds = input.selectedIds.has(input.shapeId) ? new Set(input.selectedIds) : new Set([input.shapeId])
    const nextSelectedId = input.shapeId
    const shape = shapeById(input.shapes, input.shapeId)

    if (!shape) {
      return {
        selectedIds: nextSelectedIds,
        selectedId: nextSelectedId,
        drag: null,
        bandStart: null,
        bandEnd: null
      }
    }

    const ids = nextSelectedIds.has(input.shapeId) && nextSelectedIds.size > 0 ? [...nextSelectedIds] : [input.shapeId]
    const initial = ids
      .map((id) => shapeById(input.shapes, id))
      .filter((item): item is Shape => Boolean(item))
      .map((item) => cloneShape(item))

    return {
      selectedIds: nextSelectedIds,
      selectedId: nextSelectedId,
      drag: {
        ids,
        pointerStart: input.rawPoint,
        initial
      },
      bandStart: null,
      bandEnd: null
    }
  }

  return {
    selectedIds: new Set<string>(),
    selectedId: null,
    drag: null,
    bandStart: input.rawPoint,
    bandEnd: input.rawPoint
  }
}
