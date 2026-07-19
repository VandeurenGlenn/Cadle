import type { Shape, SymbolShape } from '../native-draw/types.js'
import { inferCircuitType, inferElectricalRole, type ElectricalCircuitType } from '../native-draw/electrical.js'

export type CircuitComponentRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'

export type CircuitSpecification = {
  circuitType: ElectricalCircuitType
  breakerCurrentA: number
  cableSectionMm2: number
  poles: number
  phaseConfiguration: 'single-phase' | 'three-phase'
  source: 'explicit' | 'suggested'
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
  const match = /^([A-Z]+)(\d+)$/.exec(bindingId)
  if (!match) return null
  return { bindingId, family: match[1], number: Number(match[2]) }
}

export const inferCircuitRole = (shape: Shape): CircuitComponentRole => {
  if (shape.kind === 'door' || shape.kind === 'gate') return 'switch'
  if (shape.kind === 'image') return 'load'
  if (shape.kind !== 'symbol') return 'neutral'
  return shape.electrical?.role ?? inferElectricalRole(shape.name, shape.path)
}

const suggestedSpecification = (components: CircuitComponent[], symbols: SymbolShape[]): CircuitSpecification => {
  const explicitCurrent = symbols.map((shape) => shape.electrical?.breakerCurrentA).find((value) => value !== undefined)
  const explicitSection = symbols.map((shape) => shape.electrical?.cableSectionMm2).find((value) => value !== undefined)
  const explicitPoles = symbols.map((shape) => shape.electrical?.poles).find((value) => value !== undefined)
  const explicitPhase = symbols.map((shape) => shape.electrical?.phaseConfiguration).find((value) => value !== undefined)
  const types = new Set(components.map((component) => component.circuitType).filter(Boolean))
  const circuitType: ElectricalCircuitType =
    types.size > 1 ? 'mixed' : (([...types][0] as ElectricalCircuitType | undefined) ?? 'other')
  const socketOrMotor = circuitType === 'sockets' || circuitType === 'motor' || circuitType === 'mixed'
  return {
    circuitType,
    breakerCurrentA: explicitCurrent ?? (socketOrMotor ? 20 : 16),
    cableSectionMm2: explicitSection ?? (socketOrMotor ? 2.5 : 1.5),
    poles: explicitPoles ?? (explicitPhase === 'three-phase' ? 4 : 2),
    phaseConfiguration: explicitPhase ?? 'single-phase',
    source:
      explicitCurrent !== undefined || explicitSection !== undefined || explicitPoles !== undefined || explicitPhase !== undefined
        ? 'explicit'
        : 'suggested'
  }
}

const componentName = (shape: Shape): string => {
  if (shape.kind === 'symbol' || shape.kind === 'image') return shape.name
  return shape.kind
}

export const analyzeCircuits = (shapes: readonly Shape[]): CircuitAnalysis => {
  const grouped = new Map<string, CircuitComponent[]>()
  const issues: CircuitIssue[] = []

  for (const shape of shapes) {
    if (shape.groupId?.startsWith('onewire-')) continue
    if (!shape.bindingId) continue
    if (shape.kind !== 'symbol' && shape.kind !== 'image' && shape.kind !== 'door' && shape.kind !== 'gate') continue
    if (shape.kind === 'symbol' && shape.electrical?.oneWireEligible === false) continue
    const binding = bindingParts(shape.bindingId)
    if (!binding) {
      issues.push({
        bindingId: shape.bindingId.trim().toUpperCase(),
        severity: 'error',
        message: 'Binding ID must contain letters followed by a circuit number, for example A1.'
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
          : undefined
    }
    if (shape.kind === 'symbol') component.path = (shape as SymbolShape).path
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
      const symbols = shapes.filter(
        (shape): shape is SymbolShape =>
          shape.kind === 'symbol' && components.some((component) => component.shapeId === shape.id)
      )
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
        ready: loads > 0,
        specification: suggestedSpecification(components, symbols)
      }
    })
    .sort((left, right) => left.family.localeCompare(right.family) || (left.number ?? 0) - (right.number ?? 0))

  for (const group of groups) {
    if (group.loads === 0) {
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
