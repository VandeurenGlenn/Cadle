import type { Shape } from '../../native-draw/types.js'

const preserveManualGeometry = (fresh: Shape, previous: Shape): Shape => {
  if (fresh.kind !== previous.kind) return fresh
  if ('position' in fresh && 'position' in previous) {
    const preserved = { ...fresh, id: previous.id, position: { ...previous.position }, rotation: previous.rotation } as Shape
    if ('scale' in preserved && 'scale' in previous) preserved.scale = previous.scale
    return preserved
  }
  if ('start' in fresh && 'start' in previous && 'end' in fresh && 'end' in previous) {
    return { ...fresh, id: previous.id, start: { ...previous.start }, end: { ...previous.end } } as Shape
  }
  return fresh
}

export type OneWireRegenerationResult = {
  shapes: Shape[]
  preserved: number
  added: number
  removed: number
}

export const reconcileGeneratedOneWire = (
  previous: readonly Shape[],
  fresh: readonly Shape[]
): OneWireRegenerationResult => {
  const previousByKey = new Map(
    previous.filter((shape) => shape.generationKey).map((shape) => [shape.generationKey as string, shape])
  )
  let preserved = 0
  const shapes = fresh.map((shape) => {
    if (!shape.generationKey) return shape
    const matching = previousByKey.get(shape.generationKey)
    if (!matching) return shape
    preserved += 1
    return preserveManualGeometry(shape, matching)
  })
  const freshKeys = new Set(fresh.map((shape) => shape.generationKey).filter(Boolean))
  return {
    shapes,
    preserved,
    added: fresh.filter((shape) => !shape.generationKey || !previousByKey.has(shape.generationKey)).length,
    removed: previous.filter((shape) => shape.generationKey && !freshKeys.has(shape.generationKey)).length
  }
}
