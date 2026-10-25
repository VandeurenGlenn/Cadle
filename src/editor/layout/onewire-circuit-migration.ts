import type { LineShape, Shape, SymbolShape } from '../model/types.js'
import { buildKamrailCircuitBundle, type BuildKamrailCircuitBundleInput } from './onewire-helpers.js'
import { isOneWireRailShape, reconcileGeneratedOneWire } from './onewire-regeneration.js'
import {
  oneWireSymbolNodeInfo,
  oneWireSymbolScaleFor,
  oneWireSymbolStrokeWidthFor,
  oneWireSymbolTerminalInfo
} from './onewire-symbol-nodes.js'

type MigrationDependencies = Pick<
  BuildKamrailCircuitBundleInput,
  | 'nextShapeId'
  | 'oneWireComponentSymbol'
  | 'oneWireSymbolScale'
  | 'symbolContentBounds'
  | 'branchStroke'
  | 'minimumRowY'
>

export const migrateOneWireCircuitGeometry = (shapes: readonly Shape[], deps: MigrationDependencies): Shape[] => {
  const rails = shapes.filter((shape): shape is LineShape => shape.kind === 'line' && isOneWireRailShape(shape))
  const breakers = shapes.filter(
    (shape): shape is SymbolShape =>
      shape.kind === 'symbol' && shape.sourceLink?.role === 'breaker' && Boolean(shape.generationKey)
  )
  if (!rails.length || !breakers.length) return [...shapes]
  const replacements = new Map<string, Shape[]>()
  const removed = new Set<string>()
  for (const breaker of breakers) {
    const family = breaker.sourceLink!.id
    const bottom = oneWireSymbolTerminalInfo(breaker.path, breaker.scale)?.bottom
    if (!bottom) continue
    const anchorX = breaker.position.x + bottom.x
    const rail = breaker.oneWireRailId
      ? rails.find((candidate) => candidate.id === breaker.oneWireRailId)
      : rails.reduce((nearest, candidate) =>
          Math.abs(candidate.start.y - breaker.position.y - bottom.y) <
          Math.abs(nearest.start.y - breaker.position.y - bottom.y)
            ? candidate
            : nearest
        )
    if (!rail) continue
    if (
      breakers.some(
        (candidate) =>
          candidate.id !== breaker.id &&
          candidate.sourceLink?.id === family &&
          (!candidate.oneWireRailId || candidate.oneWireRailId === rail.id)
      )
    )
      continue
    const previous = shapes.filter(
      (shape) =>
        Boolean(shape.generationKey) &&
        (!shape.oneWireRailId || shape.oneWireRailId === rail.id) &&
        (shape.sourceLink?.kind === 'board'
          ? shape.sourceLink.id === family && shape.sourceLink.role !== 'description'
          : shape.bindingId?.replace(/\d+$/, '') === family)
    )
    const devices = previous.filter(
      (shape): shape is SymbolShape =>
        shape.kind === 'symbol' && (shape.sourceLink?.role === 'switch' || shape.sourceLink?.role === 'load')
    )
    const familyComponents: BuildKamrailCircuitBundleInput['familyComponents'] = devices.flatMap((shape) => {
      const symbolIndex = devices
        .filter((candidate) => candidate.groupId === shape.groupId && candidate.bindingId === shape.bindingId)
        .indexOf(shape)
      const count = previous.find(
        (candidate) =>
          candidate.kind === 'text' &&
          candidate.sourceLink?.role === 'count-label' &&
          candidate.bindingId === shape.bindingId &&
          candidate.groupId === shape.groupId &&
          candidate.generationKey?.endsWith(`:count:${symbolIndex}`)
      )
      const repeats =
        shape.sourceLink?.role === 'load' &&
        /lighting|lamp|fluorescent|spot|wall light/i.test(shape.path) &&
        count?.kind === 'text'
          ? Math.max(1, Math.min(1000, Number(/^x(\d+)$/.exec(count.text)?.[1] ?? 1)))
          : 1
      return Array.from({ length: repeats }, () => ({
        bindingId: shape.bindingId ?? `${family}1`,
        kind: shape.sourceLink?.role === 'switch' ? ('switch' as const) : ('load' as const),
        sourceShapeId: shape.sourceLink?.kind === 'device' ? shape.sourceLink.id : undefined,
        sourcePath: shape.path,
        sourceName: shape.name
      }))
    })
    if (!familyComponents.length) familyComponents.push({ bindingId: `${family}1`, kind: 'empty' })
    const metadata = breaker.electrical
    const generated = buildKamrailCircuitBundle({
      ...deps,
      rail,
      anchorX,
      familyComponents,
      options: {
        ...metadata,
        amps: metadata?.breakerCurrentA ?? 20,
        family,
        autoIncludeFamily: true,
        hideFamilyLabel: !previous.some((shape) => shape.sourceLink?.role === 'label')
      }
    })
    if (!generated) continue
    const previousByKey = new Map(previous.map((shape) => [shape.generationKey, shape]))
    const fresh = generated.shapes.map((shape): Shape => {
      const old = previousByKey.get(shape.generationKey)
      if (shape.kind === 'text' && old?.kind === 'text') {
        return {
          ...shape,
          oneWireRailId: rail.id,
          text: old.sourceLink?.role === 'cable-section' ? old.text.split(' · ')[0] : old.text
        }
      }
      if (shape.kind === 'symbol' && old?.kind === 'symbol') {
        if (shape.sourceLink?.role === 'cable-installation') {
          const scale = oneWireSymbolScaleFor(old.path) ?? shape.scale
          const previousNode = oneWireSymbolNodeInfo(shape.path, shape.scale)?.offset
          const nextNode = oneWireSymbolNodeInfo(old.path, scale)?.offset
          const position =
            previousNode && nextNode
              ? { x: shape.position.x + previousNode.x - nextNode.x, y: shape.position.y + previousNode.y - nextNode.y }
              : shape.position
          return {
            ...shape,
            oneWireRailId: rail.id,
            electrical: old.electrical,
            path: old.path,
            name: old.name,
            scale,
            position,
            strokeWidth: oneWireSymbolStrokeWidthFor(old.path, scale),
            hidden: metadata?.showCableInstallation === false
          }
        }
        return {
          ...shape,
          oneWireRailId: rail.id,
          electrical: old.electrical,
          symbolTextOverrides: old.symbolTextOverrides ?? shape.symbolTextOverrides
        }
      }
      return { ...shape, oneWireRailId: rail.id }
    })
    replacements.set(breaker.id, reconcileGeneratedOneWire(previous, fresh).shapes)
    previous.forEach((shape) => removed.add(shape.id))
  }
  return shapes.flatMap((shape) => replacements.get(shape.id) ?? (removed.has(shape.id) ? [] : [shape]))
}
