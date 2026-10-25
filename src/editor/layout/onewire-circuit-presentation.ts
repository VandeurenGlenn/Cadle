import type { CircuitGroup, CircuitSpecification } from '../circuit-analysis.js'
import { circuitDefaults, defaultHasProtectiveConductor } from '../circuit-defaults.js'
import {
  electricalMetadataFromCatalog,
  neutralPositionForManufacturer,
  rcdTypeLabel,
  shouldShowPhaseLabel,
  type ElectricalDeviceMetadata
} from '../model/electrical.js'
import type { Shape, SymbolShape } from '../model/types.js'
import type { ElectricalProjectProfile, ProjectCircuitSpecification } from '../../types.js'
import { normalizeOneWireFamilyKey } from './onewire-layout-plan.js'
import {
  oneWireCableInstallationLabel,
  oneWireCableInstallationPath,
  oneWireCableLabelText,
  oneWirePhaseLabelText
} from './onewire-helpers.js'
import { oneWireSymbolNodeInfo, oneWireSymbolScaleFor, oneWireSymbolStrokeWidthFor } from './onewire-symbol-nodes.js'

export type CircuitPropertyUpdate = Partial<{
  [Key in keyof ElectricalDeviceMetadata]: ElectricalDeviceMetadata[Key] | null
}>

export type CircuitSpecificationUpdateResult = {
  circuitKey: string
  circuitSpecifications: Record<string, ProjectCircuitSpecification>
}

export const updateCircuitSpecifications = (
  current: Record<string, ProjectCircuitSpecification> | undefined,
  bindingId: string,
  update: CircuitPropertyUpdate
): CircuitSpecificationUpdateResult | null => {
  const circuitKey = bindingId.trim().toUpperCase()
  if (!circuitKey) return null
  const circuitSpecifications = { ...(current ?? {}) }
  const specification = { ...(circuitSpecifications[circuitKey] ?? {}) } as Record<string, unknown>

  for (const [key, value] of Object.entries(update)) {
    if (key === 'role' || key === 'oneWireEligible' || key === 'ratedCurrentA') continue
    if (value === null || value === undefined) delete specification[key]
    else specification[key] = value
  }

  if (Object.keys(specification).length) {
    circuitSpecifications[circuitKey] = specification as ProjectCircuitSpecification
  } else {
    delete circuitSpecifications[circuitKey]
  }
  return { circuitKey, circuitSpecifications }
}

export const circuitKeyForShape = (shape: Shape): string | null => {
  if (shape.sourceLink?.kind === 'board' || shape.sourceLink?.kind === 'circuit') {
    const linked = shape.sourceLink.id.trim().toUpperCase()
    if (linked) return linked
  }
  const binding = shape.bindingId?.trim().toUpperCase()
  if (!binding) return null
  return normalizeOneWireFamilyKey(binding) ?? binding
}

export const effectiveStandaloneCircuitElectrical = (
  shape: SymbolShape,
  circuitSpecifications: Record<string, ProjectCircuitSpecification> = {},
  profile?: ElectricalProjectProfile
): ElectricalDeviceMetadata => {
  const base = shape.electrical ?? electricalMetadataFromCatalog(undefined, shape.name, shape.path)
  const circuitKey = circuitKeyForShape(shape)
  const stored = circuitKey ? (circuitSpecifications[circuitKey] ?? {}) : {}
  const defaults = circuitDefaults(stored.circuitType ?? base.circuitType)
  const cableConductors = stored.cableConductors ?? base.cableConductors ?? defaults.cableConductors
  return {
    ...defaults,
    ...base,
    ...stored,
    role: 'protection',
    oneWireEligible: true,
    cableConductors,
    hasProtectiveConductor:
      stored.hasProtectiveConductor ?? base.hasProtectiveConductor ?? defaultHasProtectiveConductor(cableConductors),
    showCableInstallation: stored.showCableInstallation ?? base.showCableInstallation ?? true,
    phaseConfiguration: stored.phaseConfiguration ?? profile?.phaseConfiguration ?? defaults.phaseConfiguration,
    manufacturer: stored.manufacturer ?? base.manufacturer ?? 'Schneider Electric',
    neutralPosition:
      stored.neutralPosition ??
      base.neutralPosition ??
      neutralPositionForManufacturer(stored.manufacturer ?? base.manufacturer ?? 'Schneider Electric') ??
      'right',
    showPhaseLabel: stored.showPhaseLabel ?? base.showPhaseLabel ?? true,
    poles: stored.poles ?? profile?.defaultPoles ?? defaults.poles
  }
}

export const effectiveCircuitElectrical = (shape: Shape, group: CircuitGroup): ElectricalDeviceMetadata => {
  const component =
    shape.sourceLink?.kind === 'device'
      ? group.components.find((item) => item.shapeId === shape.sourceLink?.id)
      : undefined
  const base =
    shape.kind === 'symbol'
      ? (shape.electrical ?? electricalMetadataFromCatalog(undefined, shape.name, shape.path))
      : { role: component?.role ?? 'neutral', oneWireEligible: true }
  return {
    ...base,
    role: component?.role ?? (shape.sourceLink?.role === 'breaker' ? 'protection' : base.role),
    oneWireEligible: true,
    circuitType: group.specification.circuitType,
    breakerCurrentA: group.specification.breakerCurrentA,
    cableSectionMm2: group.specification.cableSectionMm2,
    cableConductors: group.specification.cableConductors,
    hasProtectiveConductor: group.specification.hasProtectiveConductor,
    cableType: group.specification.cableType,
    cableInstallation: group.specification.cableInstallation,
    showCableInstallation: group.specification.showCableInstallation,
    poles: group.specification.poles,
    phaseConfiguration: group.specification.phaseConfiguration,
    manufacturer: group.specification.manufacturer,
    productSeries: group.specification.productSeries,
    productReference: group.specification.productReference,
    neutralPosition: group.specification.neutralPosition,
    showPhaseLabel: group.specification.showPhaseLabel,
    breakerCurve: group.specification.breakerCurve ?? 'C',
    rcdSensitivityMa: group.specification.rcdSensitivityMa,
    rcdType: group.specification.rcdType,
    boardId: group.specification.boardId ?? 'main',
    railId: group.specification.railId ?? 'rail-1',
    notes: group.specification.notes
  }
}

export type OneWireCircuitPresentationOptions = {
  shapes: readonly Shape[]
  circuitKey: string
  stored?: ProjectCircuitSpecification
  groupSpecification?: CircuitSpecification
  profile?: ElectricalProjectProfile
}

export type OneWireCircuitPresentationResult = {
  shapes: Shape[]
  changed: boolean
}

export const applyOneWireCircuitPresentation = ({
  shapes,
  circuitKey,
  stored = {},
  groupSpecification,
  profile
}: OneWireCircuitPresentationOptions): OneWireCircuitPresentationResult => {
  const defaults = circuitDefaults(stored.circuitType ?? groupSpecification?.circuitType)
  const cableConductors = stored.cableConductors ?? groupSpecification?.cableConductors ?? defaults.cableConductors
  const specification = {
    breakerCurrentA: stored.breakerCurrentA ?? groupSpecification?.breakerCurrentA ?? defaults.breakerCurrentA,
    cableSectionMm2: stored.cableSectionMm2 ?? groupSpecification?.cableSectionMm2 ?? defaults.cableSectionMm2,
    cableConductors,
    hasProtectiveConductor:
      stored.hasProtectiveConductor ??
      groupSpecification?.hasProtectiveConductor ??
      defaultHasProtectiveConductor(cableConductors),
    cableType: stored.cableType ?? groupSpecification?.cableType ?? defaults.cableType,
    cableInstallation: stored.cableInstallation ?? groupSpecification?.cableInstallation ?? defaults.cableInstallation,
    showCableInstallation: stored.showCableInstallation ?? groupSpecification?.showCableInstallation ?? true,
    poles: stored.poles ?? groupSpecification?.poles ?? profile?.defaultPoles ?? defaults.poles,
    phaseConfiguration:
      stored.phaseConfiguration ??
      groupSpecification?.phaseConfiguration ??
      profile?.phaseConfiguration ??
      defaults.phaseConfiguration,
    manufacturer: stored.manufacturer ?? groupSpecification?.manufacturer ?? 'Schneider Electric',
    neutralPosition:
      stored.neutralPosition ??
      groupSpecification?.neutralPosition ??
      neutralPositionForManufacturer(stored.manufacturer ?? groupSpecification?.manufacturer ?? 'Schneider Electric') ??
      'right',
    showPhaseLabel: stored.showPhaseLabel ?? groupSpecification?.showPhaseLabel ?? true,
    breakerCurve: stored.breakerCurve ?? groupSpecification?.breakerCurve ?? defaults.breakerCurve,
    rcdSensitivityMa: stored.rcdSensitivityMa ?? groupSpecification?.rcdSensitivityMa,
    rcdType: stored.rcdType ?? groupSpecification?.rcdType
  }
  const cableInstallation = specification.cableInstallation ?? 'conduit-recessed'
  const labels: Record<string, string> = {
    'breaker-poles': `${specification.poles}P`,
    'breaker-current': `${specification.breakerCurve ?? 'C'}${specification.breakerCurrentA}A`,
    'breaker-phase': shouldShowPhaseLabel(specification.poles, specification.showPhaseLabel)
      ? oneWirePhaseLabelText(specification.phaseConfiguration, specification.neutralPosition)
      : '',
    'cable-section': oneWireCableLabelText({
      conductors: specification.cableConductors,
      sectionMm2: specification.cableSectionMm2,
      hasProtectiveConductor: specification.hasProtectiveConductor,
      cableType: specification.cableType
    }),
    'cable-installation-label': oneWireCableInstallationLabel(cableInstallation)
  }
  let changed = false
  const nextShapes = shapes.map((shape) => {
    const link = shape.sourceLink
    const linkedBoardShape = link?.kind === 'board' && link.id === circuitKey

    if (
      shape.kind === 'symbol' &&
      circuitKeyForShape(shape) === circuitKey &&
      link?.role !== 'breaker' &&
      /automaat|breaker|protection devices/i.test(`${shape.name} ${shape.path}`)
    ) {
      const isResidualBreaker = /residual-current|differential|differentieel|\brcd\b/i.test(
        `${shape.name} ${shape.path}`
      )
      changed = true
      return {
        ...shape,
        electrical: {
          ...(shape.electrical ?? { role: 'protection', oneWireEligible: true }),
          manufacturer: specification.manufacturer,
          neutralPosition: specification.neutralPosition
        },
        symbolTextOverrides: {
          ...(shape.symbolTextOverrides ?? {}),
          poles: `${specification.poles}P`,
          phase: shouldShowPhaseLabel(specification.poles, specification.showPhaseLabel)
            ? oneWirePhaseLabelText(specification.phaseConfiguration, specification.neutralPosition)
            : '',
          'rated-current': `${specification.breakerCurrentA}A`,
          ...(isResidualBreaker
            ? {
                'residual-current': specification.rcdSensitivityMa ? `${specification.rcdSensitivityMa}mA` : '',
                'rcd-type': rcdTypeLabel(specification.rcdType)
              }
            : {})
        }
      }
    }

    if (!linkedBoardShape) return shape
    if (shape.kind === 'text' && link.role && labels[link.role] !== undefined) {
      const text = labels[link.role]
      const hidden = link.role === 'cable-installation-label'
      if (shape.text === text && Boolean(shape.hidden) === hidden) return shape
      changed = true
      return { ...shape, text, ...(link.role === 'cable-installation-label' ? { hidden } : {}) }
    }
    if (shape.kind === 'symbol' && link.role === 'cable-installation') {
      const path = oneWireCableInstallationPath(cableInstallation)
      const name = `Cable ${cableInstallation}`
      const hidden = !specification.showCableInstallation
      const scale = oneWireSymbolScaleFor(path) ?? 1.35
      const strokeWidth = oneWireSymbolStrokeWidthFor(path, scale)
      if (
        shape.path === path &&
        shape.name === name &&
        shape.scale === scale &&
        shape.strokeWidth === strokeWidth &&
        Boolean(shape.hidden) === hidden
      )
        return shape
      changed = true
      const previousNode = oneWireSymbolNodeInfo(shape.path, shape.scale)?.offset
      const nextNode = oneWireSymbolNodeInfo(path, scale)?.offset
      const position =
        previousNode && nextNode
          ? { x: shape.position.x + previousNode.x - nextNode.x, y: shape.position.y + previousNode.y - nextNode.y }
          : shape.position
      return { ...shape, path, name, scale, strokeWidth, hidden, position }
    }
    return shape
  })

  return { shapes: nextShapes, changed }
}
