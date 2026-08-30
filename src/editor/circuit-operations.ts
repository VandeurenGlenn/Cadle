import type { Shape } from './model/types.js'

export type CircuitOperationKind = 'replace' | 'combine' | 'split'

export type CircuitOperationResult = {
  shapes: Shape[]
  changedShapeCount: number
  bindingChanges: Map<string, string>
  sourceFamilies: string[]
  targetFamily: string
  error?: string
}

type Binding = {
  id: string
  family: string
}

const parseBinding = (value: string | undefined): Binding | null => {
  const id = value?.trim().toUpperCase() ?? ''
  const match = /^([A-Z]{1,4})(?:\d+)?$/.exec(id)
  return match ? { id, family: match[1] } : null
}

const normalizedFamily = (value: string): string | null => {
  const family = value.trim().toUpperCase()
  return /^[A-Z]{1,4}$/.test(family) ? family : null
}

const renumberBindings = (
  shapes: readonly Shape[],
  affectedBindingIds: Set<string>,
  targetFamily: string
): { shapes: Shape[]; changedShapeCount: number; bindingChanges: Map<string, string> } => {
  const bindingMap = new Map<string, string>()
  for (const shape of shapes) {
    const binding = parseBinding(shape.bindingId)
    if (!binding || !affectedBindingIds.has(binding.id) || bindingMap.has(binding.id)) continue
    bindingMap.set(binding.id, `${targetFamily}${bindingMap.size + 1}`)
  }

  let changedShapeCount = 0
  const nextShapes = shapes.map((shape) => {
    const binding = parseBinding(shape.bindingId)
    const bindingId = binding ? bindingMap.get(binding.id) : undefined
    if (!bindingId || bindingId === binding?.id) return shape
    changedShapeCount += 1
    return { ...shape, bindingId }
  })
  return { shapes: nextShapes, changedShapeCount, bindingChanges: bindingMap }
}

const failure = (shapes: readonly Shape[], targetFamily: string, error: string): CircuitOperationResult => ({
  shapes: [...shapes],
  changedShapeCount: 0,
  bindingChanges: new Map(),
  sourceFamilies: [],
  targetFamily,
  error
})

export const applyCircuitOperation = (
  shapes: readonly Shape[],
  selectedShapeIds: ReadonlySet<string>,
  kind: CircuitOperationKind,
  requestedTargetFamily: string
): CircuitOperationResult => {
  const targetFamily = normalizedFamily(requestedTargetFamily)
  if (!targetFamily) return failure(shapes, '', 'Use a circuit name of one to four letters, for example A or ALSB.')

  const selectedBindings = shapes.flatMap((shape) => {
    if (!selectedShapeIds.has(shape.id)) return []
    const binding = parseBinding(shape.bindingId)
    return binding ? [binding] : []
  })
  const sourceFamilies = [...new Set(selectedBindings.map((binding) => binding.family))]
  if (!sourceFamilies.length) return failure(shapes, targetFamily, 'Select at least one labeled electrical object.')

  const allBindings = shapes.flatMap((shape) => {
    const binding = parseBinding(shape.bindingId)
    return binding ? [binding] : []
  })
  const targetExistsOutsideSources = allBindings.some(
    (binding) => binding.family === targetFamily && !sourceFamilies.includes(binding.family)
  )

  if (kind === 'replace') {
    if (sourceFamilies.length !== 1) {
      return failure(shapes, targetFamily, 'Select objects from one circuit to replace it.')
    }
    if (sourceFamilies[0] === targetFamily) return failure(shapes, targetFamily, 'Choose a different circuit name.')
    if (targetExistsOutsideSources) {
      return failure(shapes, targetFamily, `Circuit ${targetFamily} already exists. Use Combine instead.`)
    }
    const affected = new Set(
      allBindings.filter((binding) => binding.family === sourceFamilies[0]).map((binding) => binding.id)
    )
    return { ...renumberBindings(shapes, affected, targetFamily), sourceFamilies, targetFamily }
  }

  if (kind === 'combine') {
    if (sourceFamilies.length < 2) {
      return failure(shapes, targetFamily, 'Select objects from at least two circuits to combine them.')
    }
    if (targetExistsOutsideSources) {
      return failure(shapes, targetFamily, `Circuit ${targetFamily} exists outside the selected circuits.`)
    }
    const affected = new Set(
      allBindings.filter((binding) => sourceFamilies.includes(binding.family)).map((binding) => binding.id)
    )
    return { ...renumberBindings(shapes, affected, targetFamily), sourceFamilies, targetFamily }
  }

  if (sourceFamilies.length !== 1) {
    return failure(shapes, targetFamily, 'Select points from one circuit to split them.')
  }
  if (sourceFamilies[0] === targetFamily) return failure(shapes, targetFamily, 'Choose a different circuit name.')
  if (targetExistsOutsideSources) {
    return failure(shapes, targetFamily, `Circuit ${targetFamily} already exists. Use Combine instead.`)
  }
  const selectedPointIds = new Set(selectedBindings.map((binding) => binding.id))
  const sourcePointIds = new Set(
    allBindings.filter((binding) => binding.family === sourceFamilies[0]).map((binding) => binding.id)
  )
  if (selectedPointIds.size >= sourcePointIds.size) {
    return failure(shapes, targetFamily, 'Leave at least one point in the original circuit when splitting.')
  }
  return {
    ...renumberBindings(shapes, selectedPointIds, targetFamily),
    sourceFamilies,
    targetFamily
  }
}
