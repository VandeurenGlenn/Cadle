import type { Shape } from '../../editor/model/types.js'

const preserveGeneratedIdentity = (fresh: Shape, previous: Shape): Shape => {
  if (fresh.kind !== previous.kind) return fresh
  return { ...fresh, id: previous.id } as Shape
}

export type OneWireRegenerationResult = {
  shapes: Shape[]
  preserved: number
  added: number
  removed: number
}

export const isOneWireRailShape = (shape: Shape | null): boolean =>
  Boolean(
    shape &&
    shape.kind === 'line' &&
    (shape.groupId?.startsWith('onewire-kamrail-') ||
      /^board:[^:]+:rail:/.test(shape.generationKey ?? '') ||
      (shape.sourceLink?.kind === 'board' && shape.sourceLink.role.startsWith('rail:')))
  )

export const partitionOneWireRegenerationShapes = (
  shapes: readonly Shape[]
): { generated: Shape[]; retained: Shape[] } => ({
  generated: shapes.filter((shape) => Boolean(shape.generationKey)),
  retained: shapes.filter((shape) => !shape.generationKey)
})

export const reconcileGeneratedOneWire = (
  previous: readonly Shape[],
  fresh: readonly Shape[]
): OneWireRegenerationResult => {
  const previousByKey = new Map(
    previous.filter((shape) => shape.generationKey).map((shape) => [shape.generationKey as string, shape])
  )
  let preserved = 0
  const reconciledIds = new Map<string, string>()
  const reconciledShapes = fresh.map((shape) => {
    if (!shape.generationKey) return shape
    const matching = previousByKey.get(shape.generationKey)
    if (!matching) return shape
    preserved += 1
    const reconciled = preserveGeneratedIdentity(shape, matching)
    reconciledIds.set(shape.id, reconciled.id)
    return reconciled
  })
  const shapes = reconciledShapes.map((shape) => {
    if (!shape.oneWireRailId) return shape
    const reconciledRailId = reconciledIds.get(shape.oneWireRailId)
    if (!reconciledRailId || reconciledRailId === shape.oneWireRailId) return shape
    return { ...shape, oneWireRailId: reconciledRailId } as Shape
  })
  const freshKeys = new Set(fresh.map((shape) => shape.generationKey).filter(Boolean))
  return {
    shapes,
    preserved,
    added: fresh.filter((shape) => !shape.generationKey || !previousByKey.has(shape.generationKey)).length,
    removed: previous.filter((shape) => shape.generationKey && !freshKeys.has(shape.generationKey)).length
  }
}
