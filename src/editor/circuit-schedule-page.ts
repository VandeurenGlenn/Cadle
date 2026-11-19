import { cableLabelText } from './model/cable-designation.js'
import type { CircuitScheduleLayout, ElectricalProjectProfile, Project, ProjectCircuitSpecification } from '../types.js'
import { analyzeCircuits, bindingParts, inferCircuitRole, type CircuitAnalysis, type CircuitGroup } from './circuit-analysis.js'
import type { Shape } from './model/types.js'
import { sanitizeConnection } from './model/electrical-connection.js'
import { nativeStateForProjectPage } from './model/document-state.js'
import { connectedOneWireRails, isOneWireDistributionProtection } from './interaction/connected-conductors.js'
import { oneWireSymbolConnectionAnchors } from './layout/onewire-connections.js'
import { orderedOneWireDifferentials } from './layout/onewire-topology.js'

/** Floor-plan devices stay authoritative; schematic-only families fill the gaps. */
export const analyzeCircuitSchedule = (
  floorPlanShapes: readonly Shape[],
  oneWireShapes: readonly Shape[],
  profile?: ElectricalProjectProfile,
  circuitSpecifications: Record<string, ProjectCircuitSpecification> = {}
): CircuitAnalysis => {
  const floorPlan = analyzeCircuits(floorPlanShapes, profile, circuitSpecifications)
  const knownFamilies = new Set(floorPlan.families)
  const inferred: Record<string, ProjectCircuitSpecification> = {}
  const additional: Shape[] = []
  const seen = new Set<string>()
  for (const shape of oneWireShapes) {
    if (shape.hidden || !shape.bindingId) continue
    const binding = bindingParts(shape.bindingId)
    if (!binding || knownFamilies.has(binding.family)) continue
    const key = `${binding.bindingId}:${shape.generationKey ??
      (shape.sourceLink?.kind === 'device' ? shape.sourceLink.id : shape.id)}`
    if (seen.has(key)) continue
    seen.add(key)
    const previous = inferred[binding.family] ?? {}
    if (shape.kind === 'text' && shape.sourceLink?.role === 'cable-section') {
      // Older empty circuits have a cable caption but no cable conductor object.
      const match = /^(\d+)([GX])(\d+(?:[.,]\d+)?)\s*mm(?:²|2)(?:\s+(VOB|XVB|XGB|EXVB|other)(?:[\s-]+(.+))?)?$/i
        .exec(shape.text.split(' · ')[0].trim())
      if (match) {
        const cable = sanitizeConnection({ kind: 'cable', conductors: Number(match[1]),
          sectionMm2: Number(match[3].replace(',', '.')), hasProtectiveConductor: match[2].toUpperCase() === 'G',
          cableType: match[4] ?? 'none', fireClass: match[5] })
        if (cable?.conductors && cable.sectionMm2) inferred[binding.family] = {
          cableConductors: cable.conductors, cableSectionMm2: cable.sectionMm2,
          hasProtectiveConductor: cable.hasProtectiveConductor, cableType: cable.cableType,
          cableFireClass: cable.fireClass, ...previous
        }
      }
    }
    if (shape.kind === 'line' && shape.connection?.kind === 'cable') {
      const cable = shape.connection
      inferred[binding.family] = {
        ...previous,
        cableConductors: cable.conductors ?? previous.cableConductors,
        cableSectionMm2: cable.sectionMm2 ?? previous.cableSectionMm2,
        cableType: cable.cableType ?? previous.cableType,
        cableFireClass: cable.fireClass ?? previous.cableFireClass,
        hasProtectiveConductor: cable.hasProtectiveConductor ?? previous.hasProtectiveConductor
      }
    }
    if (shape.kind !== 'symbol' && shape.kind !== 'image') continue
    if (shape.kind === 'symbol' && shape.electrical?.oneWireEligible === false) continue
    const role = inferCircuitRole(shape)
    if (role === 'neutral' || role === 'junction') continue
    if (shape.kind === 'symbol' && role === 'protection' && shape.electrical) {
      const { role: _role, oneWireEligible: _eligible, ratedCurrentA, circuitType, ...electrical } = shape.electrical
      inferred[binding.family] = {
        ...previous,
        ...Object.fromEntries(Object.entries(electrical).filter(([, value]) => value !== undefined)),
        breakerCurrentA: electrical.breakerCurrentA ?? ratedCurrentA ?? previous.breakerCurrentA,
        ...(circuitType && circuitType !== 'other' ? { circuitType } : {})
      }
    }
    // Generated group IDs describe rows, not logical devices on a floor plan.
    additional.push({ ...shape, groupId: shape.groupId?.startsWith('onewire-') ? undefined : shape.groupId })
  }
  if (!additional.length) return floorPlan
  for (const family of Object.keys(inferred)) {
    inferred[family] = { ...inferred[family], ...circuitSpecifications[family] }
  }
  return analyzeCircuits([...floorPlanShapes, ...additional], profile, { ...circuitSpecifications, ...inferred })
}

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const text = (
  x: number,
  y: number,
  value: string,
  options: { size?: number; weight?: number; anchor?: 'start' | 'middle' | 'end'; fill?: string } = {}
): string =>
  `<text x="${x}" y="${y}" font-family="Segoe UI,Arial,sans-serif" font-size="${options.size ?? 3}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? 'start'}" fill="${options.fill ?? '#201a17'}">${escapeXml(value)}</text>`

const cleanName = (value: string): string =>
  value
    .replace(/\.svg$/i, '')
    .replaceAll(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const wrap = (value: string, max = 24, lines = 3): string[] => {
  const words = value.split(/\s+/).filter(Boolean)
  const result: string[] = []
  for (const word of words) {
    const current = result.at(-1)
    if (!current || `${current} ${word}`.length > max) result.push(word)
    else result[result.length - 1] = `${current} ${word}`
  }
  if (result.length <= lines) return result
  const clipped = result.slice(0, lines)
  clipped[lines - 1] = `${clipped[lines - 1].slice(0, Math.max(1, max - 1))}…`
  return clipped
}

export type ScheduleCircuit = {
  id: string
  boardId: string
  protection: string
  poles: string
  cable: string
  consumers: string[]
  note?: string
  rooms: string[]
  category: string
  modules: number
  railId?: string
  mainDifferential?: boolean
  suppliedCircuitIds?: string[]
  protectionId?: string
  topologyIndex?: number
  topologyMain?: boolean
  sourceShapes?: Array<{ pageKey: string; shapeId: string }>
}

export type CircuitScheduleEditorItem = {
  id: string
  boardId: string
  title: string
  subtitle: string
  kind: 'differential' | 'circuit'
  modules: number
  cable?: string
  railId?: string
  differentialIds?: string[]
  circuits?: string[]
  assignmentWarning?: string
  mainDifferential?: boolean
  suppliedCircuitIds?: string[]
  protectionId?: string
  topologyIndex?: number
  topologyMain?: boolean
  sourceShapes?: Array<{ pageKey: string; shapeId: string }>
}

const circuitCategory = (type: CircuitGroup['specification']['circuitType']): string => {
  switch (type) {
    case 'lighting':
      return 'Verlichting'
    case 'sockets':
      return 'Stopcontacten'
    case 'motor':
      return 'Motor'
    case 'mixed':
      return 'Gemengde kring'
    default:
      return ''
  }
}

const countedNames = (groups: readonly CircuitGroup[]): string[] => {
  const counts = new Map<string, number>()
  for (const group of groups) {
    const loads = group.components.filter((component) => component.role === 'load' || component.role === 'junction')
    const components = loads.length ? loads : group.components.filter((component) =>
      component.role !== 'switch' && component.role !== 'protection')
    for (const component of components) {
      const name = cleanName(component.name)
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
}

export const circuitScheduleRows = (analysis: CircuitAnalysis): ScheduleCircuit[] => {
  const families = new Map<string, CircuitGroup[]>()
  for (const group of analysis.groups) {
    const entries = families.get(group.family)
    if (entries) entries.push(group)
    else families.set(group.family, [group])
  }
  return [...families.entries()].map(([id, groups]) => {
    const specification = groups[0].specification
    const curve = specification.breakerCurve && specification.breakerCurve !== 'other' ? specification.breakerCurve : ''
    return {
      id,
      boardId: specification.boardId ?? 'main',
      railId: specification.railId ?? 'rail-1',
      protection: `${curve}${specification.breakerCurrentA}A`,
      poles: `${specification.poles}P`,
      cable: cableLabelText({ conductors: specification.cableConductors, sectionMm2: specification.cableSectionMm2,
        cableType: specification.cableType, fireClass: specification.cableFireClass, hasProtectiveConductor: specification.hasProtectiveConductor },
        specification.hasProtectiveConductor ? undefined : 'x'),
      consumers: countedNames(groups),
      rooms: [
        ...new Set(
          groups.flatMap((group) =>
            group.components.map((component) => component.roomName).filter((name): name is string => Boolean(name))
          )
        )
      ],
      category: circuitCategory(specification.circuitType),
      modules: Math.max(1, specification.poles),
      ...(specification.notes ? { note: specification.notes } : {})
    }
  })
}

const PAGE_X = 8
const PAGE_Y = 28
const PAGE_W = 194

const differentialRows = (project: Project | null): ScheduleCircuit[] => {
  const boards = project?.electricalProfile?.boards ?? []
  return boards.flatMap((board) => {
    const protections = [
      ...(board.mainDifferential ? [{ ...board.mainDifferential, main: true }] : []),
      ...(board.additionalDifferentials ?? []).map((item) => ({ ...item, main: false }))
    ]
    return protections.map((protection, index) => ({
      id: protection.main ? `DIFF:${board.id}:MAIN` : `DIFF:${board.id}:${protection.id || index}`,
      boardId: board.id,
      protectionId: protection.id,
      railId: protection.railId,
      mainDifferential: protection.main,
      protection: `${protection.ratedCurrentA}A / ${protection.sensitivityMa}mA`,
      poles: `${protection.poles}P`,
      cable: protection.type ? `TYPE ${protection.type}` : '',
      consumers: [],
      rooms: [],
      category: protection.main ? 'Hoofddifferentieel' : 'Differentieel',
      modules: Math.max(1, protection.poles)
    }))
  })
}

const scheduleProtections = (project: Project | null, circuits: Pick<ScheduleCircuit, 'id' | 'boardId' | 'railId'>[]): ScheduleCircuit[] => {
  const rows = differentialRows(project)
  if (!project) return rows
  const plan = project.oneWireTopology
  // Newly planned devices must not absorb an existing device with identical ratings.
  const separateIds = new Set(project.electricalProfile?.boards?.flatMap((board) =>
    board.additionalDifferentials?.filter((item) => item.matchExistingSources === false)
      .map((item) => `DIFF:${board.id}:${item.id}`) ?? []))
  const mainBoardId = project.electricalProfile?.boards?.[0]?.id ?? 'main'
  if (plan?.mainDifferential && !rows.some((row) => row.boardId === mainBoardId && row.mainDifferential)) {
    rows.push({ id: `DIFF:${mainBoardId}:MAIN`, boardId: mainBoardId, mainDifferential: true,
      protection: `${plan.mainDifferential.ratedCurrentA}A / ${plan.mainDifferential.sensitivityMa}mA`,
      poles: `${plan.mainDifferentialPoles ?? project.electricalProfile?.defaultPoles ?? 2}P`,
      cable: `TYPE ${plan.mainDifferential.rcdType ?? 'A'}`, consumers: [], rooms: [],
      category: 'Hoofddifferentieel', modules: plan.mainDifferentialPoles ?? project.electricalProfile?.defaultPoles ?? 2 })
  }
  const topologyMain = plan?.mainDifferential && rows.find((row) => row.boardId === mainBoardId && row.mainDifferential)
  if (topologyMain) topologyMain.topologyMain = true
  const ordered = plan ? orderedOneWireDifferentials(plan) : []
  const roles = new Map<string, ScheduleCircuit>()
  const matched = new Set<string>()
  for (const [index, item] of ordered.entries()) {
    const boardId = item.boardId ?? mainBoardId
    const role = `additional-differential-${item.purpose}-${index + 1}`
    const current = item.ratedCurrentA ?? plan?.mainDifferential?.ratedCurrentA
    const protection = `${current ? `${current}A` : '? A'} / ${item.sensitivityMa}mA`
    let row = rows.find((row) => !row.mainDifferential && !matched.has(row.id) && !separateIds.has(row.id) &&
      row.boardId === boardId && row.railId === item.railId &&
      row.protection === protection)
    if (!row) {
      row = { id: `DIFF:${boardId}:${role}`, boardId, railId: item.railId,
        protection,
        poles: `${item.poles ?? project.electricalProfile?.defaultPoles ?? 2}P`, cable: `TYPE ${item.rcdType ?? 'A'}`,
        consumers: [], rooms: [], category: item.purpose === 'ev' ? 'Differentieel EV' : 'Differentieel',
        modules: item.poles ?? project.electricalProfile?.defaultPoles ?? 2 }
      rows.push(row)
    }
    matched.add(row.id)
    row.topologyIndex = index
    roles.set(role, row)
  }
  const seen = new Set<string>()
  const rowsByIdentity = new Map<string, ScheduleCircuit>()
  const configuredIds = new Set(rows.filter((row) => !separateIds.has(row.id)).map((row) => row.id))
  const represented = new Set<string>()
  for (const [pageKey, page] of Object.entries(project.pages ?? {})) {
    if (page.pageType !== 'onewire') continue
    const shapes = nativeStateForProjectPage(project, pageKey)?.shapes ?? []
    for (const shape of shapes) {
      if (shape.kind !== 'symbol' || shape.hidden || !isOneWireDistributionProtection(shape)) continue
      const identity = shape.generationKey ?? `${pageKey}:${shape.id}`
      if (seen.has(identity)) {
        rowsByIdentity.get(identity)?.sourceShapes?.push({ pageKey, shapeId: shape.id })
        continue
      }
      seen.add(identity)
      const top = oneWireSymbolConnectionAnchors(shape).find((anchor) => anchor.side === 'top')
      const rails = top ? connectedOneWireRails(shapes, top.point) : []
      const supplied = rails.flatMap((rail) => shapes.filter((item) => item.kind === 'symbol' && item.oneWireRailId === rail.id &&
        inferCircuitRole(item) === 'protection' && !isOneWireDistributionProtection(item))
        .flatMap((item) => {
          const family = bindingParts(item.bindingId ?? item.sourceLink?.id ?? '')?.family
          return family ? circuits.filter((circuit) => circuit.id === family) : []
        }))
      const destinations = rails.flatMap<Pick<ScheduleCircuit, 'boardId' | 'railId'>>((rail) => {
        const role = /^rail:(.+)$/.exec(rail.sourceLink?.role ?? '')
        if (role && rail.sourceLink?.kind === 'board') {
          const prefix = `${rail.sourceLink.id}:`
          return [{ boardId: rail.sourceLink.id, railId: role[1].startsWith(prefix) ? role[1].slice(prefix.length) : role[1] }]
        }
        return supplied
      })
      const boardIds = new Set(destinations.map((item) => item.boardId))
      const railIds = new Set(destinations.map((item) => item.railId))
      const role = shape.sourceLink?.role
      const boardId = shape.electrical?.boardId ?? (boardIds.size === 1 ? [...boardIds][0] : undefined) ??
        (role === 'main-differential' && shape.sourceLink?.kind === 'board' ? shape.sourceLink.id : undefined)
      const railId = shape.electrical?.railId ?? (railIds.size === 1 ? [...railIds][0] : undefined)
      let row = role === 'main-differential' ? rows.find((item) => item.mainDifferential && item.boardId === (boardId ?? mainBoardId))
        : role ? roles.get(role) : undefined
      const values = shape.symbolTextOverrides ?? {}
      const current = shape.electrical?.breakerCurrentA ?? shape.electrical?.ratedCurrentA ?? Number.parseFloat(values['rated-current'] ?? values['desc:40A'] ?? '')
      const residual = shape.electrical?.rcdSensitivityMa ?? Number.parseFloat(values['residual-current'] ?? values['desc:300mA'] ?? '')
      const poles = shape.electrical?.poles ?? Number.parseInt(values.poles ?? values['desc:nP'] ?? '', 10)
      if (!row && boardId) {
        const matches = rows.filter((item) => configuredIds.has(item.id) && !represented.has(item.id) &&
          item.boardId === boardId && (item.mainDifferential || (railId && item.railId === railId)) &&
          item.protection === `${current}A / ${residual}mA`)
        if (matches.length === 1) row = matches[0]
      }
      if (!row) {
        row = { id: `DIFF:${boardId ?? 'unassigned'}:${identity}`, boardId: boardId ?? 'unassigned', railId,
          mainDifferential: role === 'main-differential', protection: `${Number.isFinite(current) ? `${current}A` : '? A'} / ${Number.isFinite(residual) ? `${residual}mA` : '? mA'}`,
          poles: Number.isFinite(poles) ? `${poles}P` : '? P', cable: shape.electrical?.rcdType ?? values['rcd-type'] ?? '',
          consumers: [], rooms: [], category: 'Differentieel (eendraads)', modules: Number.isFinite(poles) ? poles : 2 }
        rows.push(row)
      }
      represented.add(row.id)
      row.sourceShapes ??= []
      row.sourceShapes.push({ pageKey, shapeId: shape.id })
      rowsByIdentity.set(identity, row)
      if (!row.mainDifferential && supplied.length) row.suppliedCircuitIds = [...new Set(supplied.map((circuit) => circuit.id))]
      if (Number.isFinite(current) && Number.isFinite(residual)) row.protection = `${current}A / ${residual}mA`
      if (Number.isFinite(poles) && poles > 0) { row.poles = `${poles}P`; row.modules = poles }
      if (shape.electrical?.rcdType || values['rcd-type']) row.cable = shape.electrical?.rcdType ?? values['rcd-type']
      if (values.description?.trim()) row.category = values.description.trim()
    }
  }
  return rows
}

const configuredRows = (
  rows: readonly ScheduleCircuit[],
  layout: CircuitScheduleLayout | undefined
): Array<{ circuit: ScheduleCircuit; gapBefore: number }> => {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ordered: ScheduleCircuit[] = []
  for (const item of layout?.items ?? []) {
    const row = byId.get(item.id)
    if (!row) continue
    ordered.push(row)
    byId.delete(item.id)
  }
  ordered.push(...byId.values())
  const gapById = new Map(
    (layout?.items ?? []).map((item) => [item.id, Math.max(0, Math.min(24, item.gapBefore ?? 0))])
  )
  return ordered.map((circuit) => ({ circuit, gapBefore: gapById.get(circuit.id) ?? 0 }))
}

export const circuitScheduleEditorItems = (
  project: Project | null,
  analysis: CircuitAnalysis
): CircuitScheduleEditorItem[] => {
  const circuits = circuitScheduleRows(analysis)
  const protections = scheduleProtections(project, circuits)
  return scheduleEditorItemsForRows([...protections, ...circuits])
}

const scheduleEditorItemsForRows = (rows: readonly ScheduleCircuit[]): CircuitScheduleEditorItem[] => {
  const items: CircuitScheduleEditorItem[] = rows.map((row) => ({
    id: row.id,
    boardId: row.boardId,
    railId: row.railId,
    mainDifferential: row.mainDifferential,
    suppliedCircuitIds: row.suppliedCircuitIds,
    protectionId: row.protectionId,
    topologyIndex: row.topologyIndex,
    topologyMain: row.topologyMain,
    sourceShapes: row.sourceShapes,
    title: row.category || row.id,
    subtitle: `${row.id.startsWith('DIFF:') ? '' : `${row.id} · `}${row.poles} · ${row.protection}${row.id.startsWith('DIFF:') && row.cable ? ` · ${row.cable}` : ''}`,
    kind: row.id.startsWith('DIFF:') ? 'differential' : 'circuit',
    modules: row.modules,
    ...(row.id.startsWith('DIFF:') ? {} : { cable: row.cable })
  }))
  return linkCircuitScheduleProtections(items)
}

export const refreshCircuitScheduleItems = (
  project: Project, items: readonly CircuitScheduleEditorItem[]
): CircuitScheduleEditorItem[] => {
  const circuits = items.filter((item) => item.kind === 'circuit')
  return linkCircuitScheduleProtections([...scheduleEditorItemsForRows(scheduleProtections(project, circuits)), ...circuits])
}

export const cabinetModulesPerRow = (layout: CircuitScheduleLayout, boardId: string): 18 | 24 =>
  layout.boardModulesPerRow?.[boardId] === 18 ? 18 : layout.boardModulesPerRow?.[boardId] === 24 ? 24
    : layout.modulesPerRow === 18 ? 18 : 24

export const linkCircuitScheduleProtections = <T extends CircuitScheduleEditorItem>(items: readonly T[]): T[] => {
  const linked: T[] = items.map((item) => ({ ...item, differentialIds: [], circuits: [], assignmentWarning: undefined }))
  const protections = linked.filter((item) => item.kind === 'differential')
  for (const circuit of linked.filter((item) => item.kind === 'circuit')) {
    const main = protections.filter((row) => row.boardId === circuit.boardId && row.mainDifferential)
    const additional = protections.filter((row) => row.boardId === circuit.boardId && !row.mainDifferential &&
      (row.suppliedCircuitIds ? row.suppliedCircuitIds.includes(circuit.id) : row.railId === circuit.railId && Boolean(row.railId)))
    circuit.differentialIds = [...main, ...(additional.length === 1 ? additional : [])].map((row) => row.id)
    if (additional.length > 1) circuit.assignmentWarning = 'Meerdere differentiëlen voor deze rij; controleer de koppeling.'
    else if (!circuit.differentialIds.length) circuit.assignmentWarning = 'Differentieel niet gekoppeld.'
  }
  for (const item of protections) {
    item.circuits = linked.filter((circuit) => circuit.differentialIds?.includes(item.id)).map((circuit) => circuit.id)
    if (!item.circuits.length) item.assignmentWarning = 'Geen eenduidig gekoppelde kringen.'
  }
  return linked
}

export type CabinetRow = { boardId: string; cells: Array<{ item: CircuitScheduleEditorItem; start: number; span: number }>; used: number }

export const packCircuitCabinetRows = (
  items: readonly (CircuitScheduleEditorItem & { gapBefore: number })[], modulesPerRow: 18 | 24
): CabinetRow[] => {
  const result: CabinetRow[] = []
  for (const boardId of new Set(items.map((item) => item.boardId))) {
    let row: CabinetRow = { boardId, cells: [], used: 0 }
    for (const item of items.filter((item) => item.boardId === boardId)) {
      const span = Math.max(1, Math.ceil(item.modules))
      const gap = Math.max(0, Math.min(modulesPerRow, item.gapBefore))
      if (row.used + gap + span > modulesPerRow && row.used) {
        result.push(row)
        row = { boardId, cells: [], used: 0 }
      }
      if (gap + span > modulesPerRow && gap) {
        row.used = gap
        result.push(row)
        row = { boardId, cells: [], used: 0 }
      } else row.used += gap
      row.cells.push({ item, start: row.used + 1, span })
      row.used += span
    }
    if (row.used) result.push(row)
  }
  return result
}

const ROWS_PER_PAGE = 30
const TABLE_Y = 34
const TABLE_ROW_H = 8

const scheduleTableHeader = (): string => `<g>
  <rect x="${PAGE_X}" y="${PAGE_Y}" width="${PAGE_W}" height="6" fill="#f1ebe7"/>
  ${text(12, 32, 'KRING', { size: 2.4, weight: 700, fill: '#756a63' })}
  ${text(30, 32, 'TYPE', { size: 2.4, weight: 700, fill: '#756a63' })}
  ${text(72, 32, 'BEVEILIGING', { size: 2.4, weight: 700, fill: '#756a63' })}
  ${text(100, 32, 'KABEL', { size: 2.4, weight: 700, fill: '#756a63' })}
  ${text(137, 32, 'VERBRUIKERS / OPMERKING', { size: 2.4, weight: 700, fill: '#756a63' })}
  ${text(181, 32, 'RUIMTE', { size: 2.4, weight: 700, fill: '#756a63' })}
</g>`

const scheduleTableRow = (circuit: ScheduleCircuit, rowIndex: number): string => {
  const y = TABLE_Y + rowIndex * TABLE_ROW_H
  const consumers = circuit.note?.trim() || circuit.consumers.join(', ') || 'Reserve'
  return `<g>
    <rect x="${PAGE_X}" y="${y}" width="${PAGE_W}" height="${TABLE_ROW_H}" fill="${rowIndex % 2 ? '#fdfbf9' : '#ffffff'}" stroke="#e4dad4" stroke-width="0.3"/>
    ${text(12, y + 5, circuit.id.startsWith('DIFF:') ? 'DIFF' : circuit.id, { size: 3, weight: 750, fill: '#a85427' })}
    ${text(30, y + 5, circuit.category || 'Overig', { size: 2.6, weight: 600 })}
    ${text(72, y + 5, `${circuit.poles} · ${circuit.protection}`, { size: 2.6, weight: 650 })}
    ${text(100, y + 5, circuit.cable, { size: 2.45, fill: '#4d433d' })}
    ${text(137, y + 5, wrap(consumers, 27, 1)[0] ?? '', { size: 2.45 })}
    ${text(181, y + 5, wrap(circuit.rooms.join(', '), 16, 1)[0] ?? '', { size: 2.35, fill: '#756a63' })}
  </g>`
}

const scheduleBoards = (project: Project | null, rows: readonly ScheduleCircuit[]) => {
  const boards = (project?.electricalProfile?.boards ?? []).map(({ id, name }) => ({ id, name }))
  const known = new Set(boards.map((board) => board.id))
  for (const row of rows) {
    if (known.has(row.boardId)) continue
    boards.push({ id: row.boardId, name: row.boardId === 'main' ? 'Hoofdverdeelbord' : row.boardId })
    known.add(row.boardId)
  }
  return boards.length ? boards : [{ id: 'main', name: 'Hoofdverdeelbord' }]
}

export const buildCircuitScheduleSvgs = (project: Project | null, analysis: CircuitAnalysis): string[] => {
  const circuits = circuitScheduleRows(analysis)
  const rows = [...scheduleProtections(project, circuits), ...circuits]
  for (const item of scheduleEditorItemsForRows(rows).filter((item) => item.kind === 'differential')) {
    const row = rows.find((row) => row.id === item.id)!
    row.note = item.circuits?.length ? `Voedt: ${item.circuits.join(', ')}` : item.assignmentWarning
  }
  const pages = scheduleBoards(project, rows).flatMap((board) => {
    const entries = configuredRows(
      rows.filter((row) => row.boardId === board.id),
      project?.circuitScheduleLayout
    )
    const pageCount = Math.max(1, Math.ceil(entries.length / ROWS_PER_PAGE))
    return Array.from({ length: pageCount }, (_, boardPageIndex) => ({
      board,
      boardPageIndex,
      boardPageCount: pageCount,
      circuits: entries.slice(boardPageIndex * ROWS_PER_PAGE, (boardPageIndex + 1) * ROWS_PER_PAGE)
    }))
  })
  return pages.map(({ board, boardPageIndex, boardPageCount, circuits }, pageIndex) => {
    const projectName = project?.name?.trim() || 'Cadle project'
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="2480" height="3508">
      <rect width="210" height="297" fill="#ffffff"/>
      <rect x="8" y="7" width="194" height="15" rx="1.5" fill="#2d231c"/>
      ${text(13, 13.5, 'VERDEELBORD', { size: 2.4, weight: 650, fill: '#dacbc1' })}
      ${text(13, 18, board.name.toUpperCase(), { size: 4, weight: 750, fill: '#ffffff' })}
      ${text(197, 13.5, projectName.toUpperCase(), { size: 2.5, weight: 600, anchor: 'end', fill: '#dacbc1' })}
      ${text(197, 18, `${boardPageIndex + 1}/${boardPageCount} · ${pageIndex + 1}/${pages.length}`, { size: 2.4, weight: 600, anchor: 'end', fill: '#ffffff' })}
      ${scheduleTableHeader()}
      ${circuits.map((entry, rowIndex) => scheduleTableRow(entry.circuit, rowIndex)).join('')}
      ${text(8, 291, 'Automatisch gegenereerd uit de kringgegevens van het project', { size: 2.2, fill: '#8b7e76' })}
      ${text(202, 291, `${circuits.filter((entry) => !entry.circuit.id.startsWith('DIFF:')).length} kringen`, { size: 2.2, weight: 600, anchor: 'end', fill: '#8b7e76' })}
    </svg>`
  })
}
