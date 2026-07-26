import type { Shape } from '../editor/model/types.js'
import {
  inferCircuitType,
  inferElectricalRole,
  isDistributionBoardDevice,
  isEarthingDevice,
  type ElectricalCircuitType
} from '../editor/model/electrical.js'
import type { ElectricalProjectProfile, ProjectCircuitSpecification } from '../types.js'
import { circuitDefaults } from './circuit-defaults.js'

export type CircuitComponentRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'

export type CircuitSpecification = {
  circuitType: ElectricalCircuitType
  breakerCurrentA: number
  cableSectionMm2: number
  cableConductors: number
  cableType: 'VOB' | 'XVB' | 'XVB-Cca' | 'XGB' | 'XGB-Cca' | 'EXVB' | 'other'
  cableInstallation: 'conduit' | 'conduit-recessed' | 'without-conduit' | 'on-wall' | 'recessed' | 'underground'
  poles: number
  phaseConfiguration: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  breakerCurve?: 'B' | 'C' | 'D' | 'other'
  rcdSensitivityMa?: number
  rcdType?: 'AC' | 'A' | 'F' | 'B' | 'other'
  boardId?: string
  railId?: string
  notes?: string
  source: 'explicit' | 'suggested'
  sources: {
    breakerCurrentA: 'entered' | 'suggested'
    cableSectionMm2: 'entered' | 'suggested'
    poles: 'entered' | 'project' | 'suggested'
    phaseConfiguration: 'entered' | 'project' | 'suggested'
  }
}

export type CircuitComponent = {
  shapeId: string
  bindingId: string
  family: string
  number: number | null
  role: CircuitComponentRole
  name: string
  path?: string
  circuitType?: ElectricalCircuitType
}

export type CircuitGroup = {
  bindingId: string
  family: string
  number: number | null
  components: CircuitComponent[]
  switches: number
  loads: number
  protection: number
  junctions: number
  neutral: number
  ready: boolean
  specification: CircuitSpecification
}

export type CircuitIssue = {
  bindingId: string
  severity: 'error' | 'warn'
  message: string
}

export type CircuitAnalysis = {
  groups: CircuitGroup[]
  issues: CircuitIssue[]
  families: string[]
  totalGroups: number
  readyGroups: number
  errorCount: number
  warningCount: number
  valid: boolean
}

const bindingParts = (value: string): { bindingId: string; family: string; number: number | null } | null => {
  const bindingId = value.trim().toUpperCase()
  // Belgian plans commonly identify a circuit with a short letter code (A, O,
  // ALSB) while point-level bindings may append a number (A1, O3). Both carry
  // enough information to group and generate a one-wire circuit.
  const match = /^([A-Z]{1,4})(\d+)?$/.exec(bindingId)
  if (!match) return null
  return { bindingId, family: match[1], number: match[2] ? Number(match[2]) : null }
}

export const inferCircuitRole = (shape: Shape): CircuitComponentRole => {
  if (shape.kind === 'door' || shape.kind === 'gate') return 'switch'
  if (shape.kind === 'image') return 'load'
  if (shape.kind !== 'symbol') return 'neutral'
  if (isEarthingDevice(shape.name, shape.path)) return 'neutral'
  if (isDistributionBoardDevice(shape.name, shape.path)) return 'junction'
  if (/inverter|omvormer|photovolta|\bpv\b|solar/i.test(`${shape.name} ${shape.path}`)) return 'load'
  const inferredRole = inferElectricalRole(shape.name, shape.path)
  // Older/custom catalog entries can carry the legacy neutral/"Other" role.
  // Do not let that stale fallback hide an otherwise recognisable socket,
  // switch, load or protection device from one-wire generation.
  return shape.electrical?.role && shape.electrical.role !== 'neutral'
    ? shape.electrical.role
    : inferredRole
}

const suggestedSpecification = (
  components: CircuitComponent[],
  profile?: ElectricalProjectProfile,
  explicit: ProjectCircuitSpecification = {}
): CircuitSpecification => {
  const loadComponents = components.filter((component) => component.role === 'load')
  const typeSources = loadComponents.length > 0 ? loadComponents : components
  const types = new Set(typeSources.map((component) => component.circuitType).filter(Boolean))
  const inferredCircuitType: ElectricalCircuitType =
    types.size > 1 ? 'mixed' : (([...types][0] as ElectricalCircuitType | undefined) ?? 'other')
  const circuitType = explicit.circuitType ?? inferredCircuitType
  const defaults = circuitDefaults(circuitType)
  const phaseConfiguration = explicit.phaseConfiguration ?? profile?.phaseConfiguration ?? 'single-phase'
  return {
    circuitType,
    breakerCurrentA: explicit.breakerCurrentA ?? defaults.breakerCurrentA,
    cableSectionMm2: explicit.cableSectionMm2 ?? defaults.cableSectionMm2,
    cableConductors:
      explicit.cableConductors ??
      (phaseConfiguration === 'three-phase' || phaseConfiguration === 'L1+L2+L3+N'
        ? 5
        : defaults.cableConductors),
    cableType: explicit.cableType ?? defaults.cableType,
    cableInstallation: explicit.cableInstallation ?? defaults.cableInstallation,
    poles: explicit.poles ?? profile?.defaultPoles ?? (phaseConfiguration === 'three-phase' || phaseConfiguration === 'L1+L2+L3+N' ? 4 : 2),
    phaseConfiguration,
    breakerCurve: explicit.breakerCurve ?? defaults.breakerCurve,
    ...(explicit.rcdSensitivityMa ? { rcdSensitivityMa: explicit.rcdSensitivityMa } : {}),
    ...(explicit.rcdType ? { rcdType: explicit.rcdType } : {}),
    ...(explicit.boardId ? { boardId: explicit.boardId } : {}),
    ...(explicit.railId ? { railId: explicit.railId } : {}),
    ...(explicit.notes ? { notes: explicit.notes } : {}),
    source:
      explicit.breakerCurrentA !== undefined &&
      explicit.cableSectionMm2 !== undefined &&
      explicit.poles !== undefined &&
      explicit.phaseConfiguration !== undefined
        ? 'explicit'
        : 'suggested',
    sources: {
      breakerCurrentA: explicit.breakerCurrentA !== undefined ? 'entered' : 'suggested',
      cableSectionMm2: explicit.cableSectionMm2 !== undefined ? 'entered' : 'suggested',
      poles: explicit.poles !== undefined ? 'entered' : profile ? 'project' : 'suggested',
      phaseConfiguration: explicit.phaseConfiguration !== undefined ? 'entered' : profile ? 'project' : 'suggested'
    }
  }
}

const componentName = (shape: Shape): string => {
  if (shape.kind === 'symbol' || shape.kind === 'image') return shape.name
  return shape.kind
}

export const analyzeCircuits = (
  shapes: readonly Shape[],
  profile?: ElectricalProjectProfile,
  circuitSpecifications: Record<string, ProjectCircuitSpecification> = {}
): CircuitAnalysis => {
  const grouped = new Map<string, CircuitComponent[]>()
  const issues: CircuitIssue[] = []

  for (const shape of shapes) {
    if (shape.groupId?.startsWith('onewire-')) continue
    if (!shape.bindingId) continue
    if (shape.kind !== 'symbol' && shape.kind !== 'image' && shape.kind !== 'door' && shape.kind !== 'gate') continue
    if (shape.kind === 'symbol' && shape.electrical?.oneWireEligible === false) continue
    if (shape.kind === 'symbol' && isEarthingDevice(shape.name, shape.path)) continue
    const binding = bindingParts(shape.bindingId)
    if (!binding) {
      issues.push({
        bindingId: shape.bindingId.trim().toUpperCase(),
        severity: 'error',
        message: 'Binding ID must be a short circuit code, optionally followed by a point number, for example A, ALSB or A1.'
      })
      continue
    }
    const component: CircuitComponent = {
      shapeId: shape.id,
      ...binding,
      role: inferCircuitRole(shape),
      name: componentName(shape),
      circuitType:
        shape.kind === 'symbol'
          ? (shape.electrical?.circuitType ?? inferCircuitType(shape.name, shape.path))
          : shape.kind === 'image'
            ? inferCircuitType(shape.name, shape.path)
            : undefined
    }
    if (shape.kind === 'symbol' || shape.kind === 'image') component.path = shape.path
    const entries = grouped.get(binding.bindingId)
    if (entries) entries.push(component)
    else grouped.set(binding.bindingId, [component])
  }

  const groups = [...grouped.entries()]
    .map(([bindingId, components]): CircuitGroup => {
      const first = components[0]
      const switches = components.filter((entry) => entry.role === 'switch').length
      const loads = components.filter((entry) => entry.role === 'load').length
      const protection = components.filter((entry) => entry.role === 'protection').length
      const junctions = components.filter((entry) => entry.role === 'junction').length
      const neutral = components.filter((entry) => entry.role === 'neutral').length
      const hasDistributionBoard = components.some(
        (component) => component.path && isDistributionBoardDevice(component.name, component.path)
      )
      const explicitSpecification =
        circuitSpecifications[first.family] ?? circuitSpecifications[bindingId] ?? {}
      return {
        bindingId,
        family: first.family,
        number: first.number,
        components,
        switches,
        loads,
        protection,
        junctions,
        neutral,
        ready: loads > 0 || protection > 0 || hasDistributionBoard,
        specification: suggestedSpecification(components, profile, explicitSpecification)
      }
    })
    .sort((left, right) => left.family.localeCompare(right.family) || (left.number ?? 0) - (right.number ?? 0))

  for (const group of groups) {
    const hasDistributionBoard = group.components.some(
      (component) => component.path && isDistributionBoardDevice(component.name, component.path)
    )
    if (group.loads === 0 && group.protection === 0 && !hasDistributionBoard) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'error',
        message: 'Circuit has no recognised load or socket.'
      })
    }
    if (group.neutral > 0) {
      issues.push({
        bindingId: group.bindingId,
        severity: 'warn',
        message: `${group.neutral} symbol${group.neutral === 1 ? '' : 's'} could not be classified as a switch or load.`
      })
    }
  }

  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount
  return {
    groups,
    issues,
    families: [...new Set(groups.map((group) => group.family))],
    totalGroups: groups.length,
    readyGroups: groups.filter((group) => group.ready).length,
    errorCount,
    warningCount,
    valid: groups.length > 0 && errorCount === 0
  }
}

export type BomRow = {
  bindingId: string
  family: string
  switches: number
  loads: number
  other: number
  total: number
  components: string
}

export const circuitBomRows = (analysis: CircuitAnalysis): BomRow[] =>
  analysis.groups.map((group) => ({
    bindingId: group.bindingId,
    family: group.family,
    switches: group.switches,
    loads: group.loads,
    other: group.protection + group.junctions + group.neutral,
    total: group.components.length,
    components: [...new Set(group.components.map((component) => component.name))].join('; ')
  }))

export const bomRowsToCsv = (rows: readonly BomRow[]): string => {
  const escape = (value: string | number): string => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const header = ['Binding ID', 'Family', 'Switches', 'Loads', 'Other', 'Total', 'Components']
  return [
    header.join(','),
    ...rows.map((row) =>
      [row.bindingId, row.family, row.switches, row.loads, row.other, row.total, row.components]
        .map(escape)
        .join(',')
    )
  ].join('\n')
}
