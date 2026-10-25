import type { CircuitScheduleLayout, Project } from '../types.js'
import type { CircuitAnalysis, CircuitGroup } from './circuit-analysis.js'

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
}

export type CircuitScheduleEditorItem = {
  id: string
  boardId: string
  title: string
  subtitle: string
  kind: 'differential' | 'circuit'
  modules: number
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
    const components = loads.length ? loads : group.components.filter((component) => component.role !== 'switch')
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
    const cableType = specification.cableType === 'none' ? '' : ` ${specification.cableType}`
    const conductor = specification.hasProtectiveConductor ? 'G' : 'x'
    return {
      id,
      boardId: specification.boardId ?? 'main',
      protection: `${curve}${specification.breakerCurrentA}A`,
      poles: `${specification.poles}P`,
      cable: `${specification.cableConductors}${conductor}${specification.cableSectionMm2} mm²${cableType}`,
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
): CircuitScheduleEditorItem[] =>
  [...differentialRows(project), ...circuitScheduleRows(analysis)].map((row) => ({
    id: row.id,
    boardId: row.boardId,
    title: row.category || row.id,
    subtitle: `${row.id} · ${row.protection}`,
    kind: row.id.startsWith('DIFF:') ? 'differential' : 'circuit',
    modules: row.modules
  }))

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
    ${text(12, y + 5, circuit.id, { size: 3, weight: 750, fill: '#a85427' })}
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
  const rows = [...differentialRows(project), ...circuitScheduleRows(analysis)]
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
