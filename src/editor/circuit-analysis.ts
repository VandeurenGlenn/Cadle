import type { Shape } from '../editor/model/types.js'
import {
  defaultManufacturerForDevice,
  electricalMetadataFromCatalog,
  inferCircuitType,
  inferElectricalRole,
  isDistributionBoardDevice,
  isEarthingDevice,
  neutralPositionForManufacturer,
  type ElectricalCircuitType
} from '../editor/model/electrical.js'
import type { ElectricalProjectProfile, ProjectCircuitSpecification } from '../types.js'
import { circuitDefaults, defaultHasProtectiveConductor } from './circuit-defaults.js'
import {
  matchVerifiedProducts,
  type ProductKind,
  type ProductMatch,
  type VerifiedProduct
} from './product-catalog.js'
import { namedRoomRegions, roomNameAtPoint, shapeAnchorPoint } from './room-regions.js'

export type CircuitComponentRole = 'switch' | 'load' | 'protection' | 'junction' | 'neutral'

export type CircuitSpecification = {
  circuitType: ElectricalCircuitType
  breakerCurrentA: number
  cableSectionMm2: number
  cableConductors: number
  hasProtectiveConductor: boolean
  cableType: 'none' | 'VOB' | 'XVB' | 'XVB-Cca' | 'XGB' | 'XGB-Cca' | 'EXVB' | 'other'
  cableInstallation: 'conduit' | 'conduit-recessed' | 'without-conduit' | 'on-wall' | 'recessed' | 'underground'
  showCableInstallation: boolean
  poles: number
  phaseConfiguration: 'single-phase' | 'three-phase' | 'L1+N' | 'L2+N' | 'L3+N' | 'L1+L2+L3+N'
  manufacturer: string
  productSeries?: string
  productReference?: string
  neutralPosition: 'left' | 'right'
  showPhaseLabel: boolean
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
  manufacturer?: string
  productSeries?: string
  productReference?: string
  ratedCurrentA?: number
  poles?: number
  breakerCurve?: 'B' | 'C' | 'D' | 'other'
  rcdSensitivityMa?: number
  rcdType?: 'AC' | 'A' | 'F' | 'B' | 'other'
  roomName?: string
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
  const manufacturer = explicit.manufacturer?.trim() || 'Schneider Electric'
  const neutralPosition =
    explicit.neutralPosition
    ?? neutralPositionForManufacturer(manufacturer)
    ?? 'right'
  const cableConductors =
    explicit.cableConductors ??
    (phaseConfiguration === 'three-phase' || phaseConfiguration === 'L1+L2+L3+N'
      ? 5
      : defaults.cableConductors)
  return {
    circuitType,
    breakerCurrentA: explicit.breakerCurrentA ?? defaults.breakerCurrentA,
    cableSectionMm2: explicit.cableSectionMm2 ?? defaults.cableSectionMm2,
    cableConductors,
    hasProtectiveConductor:
      explicit.hasProtectiveConductor ?? defaultHasProtectiveConductor(cableConductors),
    cableType: explicit.cableType ?? defaults.cableType,
    cableInstallation: explicit.cableInstallation ?? defaults.cableInstallation,
    showCableInstallation: explicit.showCableInstallation ?? true,
    poles: explicit.poles ?? profile?.defaultPoles ?? (phaseConfiguration === 'three-phase' || phaseConfiguration === 'L1+L2+L3+N' ? 4 : 2),
    phaseConfiguration,
    manufacturer,
    ...(explicit.productSeries ? { productSeries: explicit.productSeries } : {}),
    ...(explicit.productReference ? { productReference: explicit.productReference } : {}),
    neutralPosition,
    showPhaseLabel: explicit.showPhaseLabel ?? true,
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
  const roomRegions = namedRoomRegions(shapes)

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
    if (shape.kind === 'symbol') {
      const metadata = shape.electrical ?? electricalMetadataFromCatalog(undefined, shape.name, shape.path)
      component.manufacturer =
        metadata.manufacturer
        ?? defaultManufacturerForDevice(metadata.role, metadata.circuitType, shape.name, shape.path)
      component.productSeries = metadata.productSeries
      component.productReference = metadata.productReference
      component.ratedCurrentA = metadata.ratedCurrentA ?? metadata.breakerCurrentA
      component.poles = metadata.poles
      component.breakerCurve = metadata.breakerCurve
      component.rcdSensitivityMa = metadata.rcdSensitivityMa
      component.rcdType = metadata.rcdType
    }
    const anchor = shapeAnchorPoint(shape)
    const roomName = anchor ? roomNameAtPoint(roomRegions, anchor) : undefined
    if (roomName) component.roomName = roomName
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
  sockets: number
  lightingPoints: number
  appliances: number
  protections: number
  junctions: number
  componentCounts: Record<string, number>
  productSelections: BomProductSelection[]
}

export type BomProductSelection = {
  material: string
  quantity: number
  status: 'exact' | 'candidates' | 'unmatched'
  references: string[]
  products: string[]
  officialSources: string[]
  missing: string[]
}

const isSocketComponent = (component: CircuitComponent): boolean =>
  component.circuitType === 'sockets'
  || /\b(?:socket|outlet|stopcontact)\b/iu.test(`${component.name} ${component.path ?? ''}`)

const isLightingComponent = (component: CircuitComponent): boolean =>
  component.circuitType === 'lighting'
  || /\b(?:lighting|lamp|light|spot|lichtpunt|verlichting)\b/iu.test(`${component.name} ${component.path ?? ''}`)

const productKindForComponent = (component: CircuitComponent): ProductKind | undefined => {
  if (component.role === 'switch') return 'switch'
  if (isSocketComponent(component)) return 'socket'
  if (component.role === 'protection') {
    return component.rcdSensitivityMa ? 'rcbo' : 'breaker'
  }
  return undefined
}

const poleDescription = (
  poles: number | undefined,
  phaseConfiguration?: CircuitSpecification['phaseConfiguration']
): VerifiedProduct['poles'] | undefined => {
  if (poles === 2) return phaseConfiguration?.includes('+N') ? '1P+N' : '2P'
  if (poles === 4) return phaseConfiguration === 'L1+L2+L3+N' ? '3P+N' : '4P'
  return undefined
}

const selectionFromMatch = (
  material: string,
  quantity: number,
  match: ProductMatch
): BomProductSelection => ({
  material,
  quantity,
  status: match.status === 'none' ? 'unmatched' : match.status,
  references: match.products.map((product) => product.reference),
  products: match.products.map((product) => product.name),
  officialSources: match.products.map((product) => product.sourceUrl),
  missing: match.missing
})

const addProductSelection = (
  selections: BomProductSelection[],
  next: BomProductSelection
): void => {
  const key = `${next.material}\u0000${next.status}\u0000${next.references.join('|')}\u0000${next.missing.join('|')}`
  const existing = selections.find((selection) =>
    `${selection.material}\u0000${selection.status}\u0000${selection.references.join('|')}\u0000${selection.missing.join('|')}` === key
  )
  if (existing) existing.quantity += next.quantity
  else selections.push(next)
}

export const circuitBomRows = (analysis: CircuitAnalysis): BomRow[] =>
  analysis.groups.map((group) => {
    const sockets = group.components.filter((component) => component.role === 'load' && isSocketComponent(component)).length
    const lightingPoints = group.components.filter((component) => component.role === 'load' && isLightingComponent(component)).length
    const appliances = Math.max(0, group.loads - sockets - lightingPoints)
    const hasDistributionBoard = group.components.some(
      (component) => component.path && isDistributionBoardDevice(component.name, component.path)
    )
    const protections = hasDistributionBoard ? group.protection : Math.max(1, group.protection)
    const junctions = group.junctions
    const componentCounts: Record<string, number> = {}
    const productSelections: BomProductSelection[] = []
    for (const component of group.components) {
      const material = `${component.manufacturer ? `${component.manufacturer} · ` : ''}${component.name}`
      const kind = productKindForComponent(component)
      const match = kind
        ? matchVerifiedProducts({
            kind,
            manufacturer: component.manufacturer,
            series: component.productSeries,
            reference: component.productReference,
            ratedCurrentA: component.ratedCurrentA,
            poles: poleDescription(component.poles),
            curve: component.breakerCurve === 'other' ? undefined : component.breakerCurve,
            rcdSensitivityMa: component.rcdSensitivityMa,
            rcdType: component.rcdType === 'other' ? undefined : component.rcdType
          })
        : undefined
      if (match) addProductSelection(productSelections, selectionFromMatch(material, 1, match))
      const suffix = match?.status === 'exact'
        ? ` · ref. ${match.products[0].reference}`
        : component.productReference
          ? ` · ref. ${component.productReference} (niet geverifieerd)`
          : ''
      const key = `${material}${suffix}`
      componentCounts[key] = (componentCounts[key] ?? 0) + 1
    }
    if (!hasDistributionBoard && group.protection === 0) {
      const curve = group.specification.breakerCurve && group.specification.breakerCurve !== 'other'
        ? group.specification.breakerCurve
        : ''
      const material = `${group.specification.manufacturer} · Automaat ${curve}${group.specification.breakerCurrentA}A ${group.specification.poles}P`
      const match = matchVerifiedProducts({
        kind: 'breaker',
        manufacturer: group.specification.manufacturer,
        series: group.specification.productSeries,
        reference: group.specification.productReference,
        ratedCurrentA: group.specification.breakerCurrentA,
        poles: poleDescription(group.specification.poles, group.specification.phaseConfiguration),
        curve: group.specification.breakerCurve === 'other' ? undefined : group.specification.breakerCurve
      })
      addProductSelection(productSelections, selectionFromMatch(material, 1, match))
      const key = match.status === 'exact'
        ? `${material} · ref. ${match.products[0].reference}`
        : group.specification.productReference
          ? `${material} · ref. ${group.specification.productReference} (niet geverifieerd)`
          : material
      componentCounts[key] = (componentCounts[key] ?? 0) + 1
    }
    const other = group.neutral
    const total = group.switches + sockets + lightingPoints + appliances + protections + junctions + other
    return {
      bindingId: group.bindingId,
      family: group.family,
      switches: group.switches,
      loads: group.loads,
      other,
      total,
      components: Object.entries(componentCounts)
        .map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
        .join('; '),
      sockets,
      lightingPoints,
      appliances,
      protections,
      junctions,
      componentCounts,
      productSelections
    }
  })

export const bomRowsToCsv = (rows: readonly BomRow[]): string => {
  const escape = (value: string | number): string => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const header = [
    'Binding ID', 'Family', 'Switches', 'Loads', 'Other', 'Total', 'Components',
    'Sockets', 'Lighting points', 'Appliances', 'Protection devices', 'Junctions/boards'
  ]
  const totals = rows.reduce((sum, row) => ({
    switches: sum.switches + row.switches,
    sockets: sum.sockets + row.sockets,
    lightingPoints: sum.lightingPoints + row.lightingPoints,
    appliances: sum.appliances + row.appliances,
    protections: sum.protections + row.protections,
    junctions: sum.junctions + row.junctions,
    other: sum.other + row.other,
    total: sum.total + row.total
  }), {
    switches: 0, sockets: 0, lightingPoints: 0, appliances: 0,
    protections: 0, junctions: 0, other: 0, total: 0
  })
  const materialTotals = new Map<string, number>()
  const productSelections: BomProductSelection[] = []
  for (const row of rows) {
    for (const [name, count] of Object.entries(row.componentCounts)) {
      materialTotals.set(name, (materialTotals.get(name) ?? 0) + count)
    }
    for (const selection of row.productSelections) addProductSelection(productSelections, { ...selection })
  }
  const summaryRows: Array<[string, number]> = [
    ['Schakelaars', totals.switches],
    ['Stopcontacten', totals.sockets],
    ['Lichtpunten', totals.lightingPoints],
    ['Andere verbruikers', totals.appliances],
    ['Beveiligingen', totals.protections],
    ['Verdeelborden / verbindingen', totals.junctions],
    ['Overige', totals.other],
    ['ALGEMEEN TOTAAL', totals.total]
  ]
  return [
    header.join(','),
    ...rows.map((row) =>
      [
        row.bindingId, row.family, row.switches, row.loads, row.other, row.total, row.components,
        row.sockets, row.lightingPoints, row.appliances, row.protections, row.junctions
      ]
        .map(escape)
        .join(',')
    ),
    '',
    'CATEGORY TOTALS,Quantity',
    ...summaryRows.map(([label, count]) => `${escape(label)},${count}`),
    '',
    'MATERIAL TOTALS,Quantity',
    ...[...materialTotals.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'nl-BE'))
      .map(([label, count]) => `${escape(label)},${count}`),
    '',
    'PRODUCT SELECTIONS,Required quantity,Status,References,Products,Missing specifications,Official sources',
    ...productSelections
      .sort((left, right) => left.material.localeCompare(right.material, 'nl-BE'))
      .map((selection) => [
        selection.material,
        selection.quantity,
        selection.status,
        selection.references.join(' / '),
        selection.products.join(' / '),
        selection.missing.join(' / '),
        selection.officialSources.join(' / ')
      ].map(escape).join(','))
  ].join('\n')
}
