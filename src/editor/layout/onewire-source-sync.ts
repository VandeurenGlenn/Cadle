import type { Shape, SymbolShape } from '../model/types.js'
import type { BuildKamrailCircuitBundleInput } from './onewire-helpers.js'

type Components = BuildKamrailCircuitBundleInput['familyComponents']
type SourcePage = { key: string; shapes: readonly Shape[] }

export const oneWireSourceSignature = (components: Components): string => JSON.stringify(
  [...components].sort((a, b) => a.bindingId.localeCompare(b.bindingId, undefined, { numeric: true }) ||
    (a.sourceShapeId ?? '').localeCompare(b.sourceShapeId ?? ''))
)

export const createOneWireSourceResolver = (
  families: ReadonlyMap<string, Components>,
  pages: readonly SourcePage[],
  pageKey: string
) => {
  const isLinked = (breaker: SymbolShape, shapes: readonly Shape[]) =>
    breaker.oneWireSourceSignature !== undefined || shapes.some((shape) =>
      shape.sourceLink?.kind === 'device' && shape.bindingId?.replace(/\d+$/, '') === breaker.sourceLink?.id &&
      (!shape.oneWireRailId || shape.oneWireRailId === breaker.oneWireRailId) &&
      families.get(breaker.sourceLink?.id ?? '')?.some((component) => component.sourceShapeId === shape.sourceLink?.id))
  const primaryOwners = new Map<string, string>()
  const bindingOwners = new Map<string, string>()
  for (const page of pages) {
    for (const breaker of page.shapes) {
      if (breaker.kind !== 'symbol' || breaker.sourceLink?.role !== 'breaker' || !breaker.generationKey ||
        !isLinked(breaker, page.shapes)) continue
      const family = breaker.sourceLink.id
      const owner = `${page.key}:${breaker.id}`
      if (!primaryOwners.has(family)) primaryOwners.set(family, owner)
      for (const shape of page.shapes) {
        if (!shape.generationKey || !shape.bindingId?.match(/\d+$/) ||
          shape.bindingId.replace(/\d+$/, '') !== family ||
          (shape.oneWireRailId && shape.oneWireRailId !== breaker.oneWireRailId)) continue
        if (!bindingOwners.has(shape.bindingId)) bindingOwners.set(shape.bindingId, owner)
      }
    }
  }
  return (breaker: SymbolShape) => {
    const family = breaker.sourceLink?.id
    if (!family) return undefined
    const source = families.get(family)
    if (!isLinked(breaker, pages.find((page) => page.key === pageKey)?.shapes ?? [])) return undefined
    const owner = `${pageKey}:${breaker.id}`
    const familyComponents = (source ?? []).filter((component) =>
      (bindingOwners.get(component.bindingId) ?? primaryOwners.get(family)) === owner)
    const signature = oneWireSourceSignature(familyComponents)
    return signature === breaker.oneWireSourceSignature ? undefined : { familyComponents, signature }
  }
}
