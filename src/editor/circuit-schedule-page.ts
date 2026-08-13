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
  title: string
  subtitle: string
  kind: 'differential' | 'circuit'
  modules: number
}

const circuitCategory = (type: CircuitGroup['specification']['circuitType']): string => {
  switch (type) {
    case 'lighting': return 'Verlichting'
    case 'sockets': return 'Stopcontacten'
    case 'motor': return 'Motor'
    case 'mixed': return 'Gemengde kring'
    default: return ''
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
    const curve = specification.breakerCurve && specification.breakerCurve !== 'other'
      ? specification.breakerCurve
      : ''
    const cableType = specification.cableType === 'none' ? '' : ` ${specification.cableType}`
    const conductor = specification.hasProtectiveConductor ? 'G' : 'x'
    return {
      id,
      protection: `${curve}${specification.breakerCurrentA}A`,
      poles: `${specification.poles}P`,
      cable: `${specification.cableConductors}${conductor}${specification.cableSectionMm2} mm²${cableType}`,
      consumers: countedNames(groups),
      rooms: [...new Set(groups.flatMap((group) => group.components.map((component) => component.roomName).filter((name): name is string => Boolean(name))))],
      category: circuitCategory(specification.circuitType),
      modules: Math.max(1, specification.poles),
      ...(specification.notes ? { note: specification.notes } : {})
    }
  })
}

const ROWS = 5
const PAGE_X = 8
const PAGE_Y = 28
const PAGE_W = 194
const PAGE_H = 247
const CELL_H = PAGE_H / ROWS

const differentialRows = (project: Project | null): ScheduleCircuit[] => {
  const boards = project?.electricalProfile?.boards ?? []
  return boards.flatMap((board) => {
    const protections = [
      ...(board.mainDifferential ? [{ ...board.mainDifferential, main: true }] : []),
      ...(board.additionalDifferentials ?? []).map((item) => ({ ...item, main: false }))
    ]
    return protections.map((protection, index) => ({
      id: protection.main ? `DIFF:${board.id}:MAIN` : `DIFF:${board.id}:${protection.id || index}`,
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
  const gapById = new Map((layout?.items ?? []).map((item) => [item.id, Math.max(0, Math.min(24, item.gapBefore ?? 0))]))
  return ordered.map((circuit) => ({ circuit, gapBefore: gapById.get(circuit.id) ?? 0 }))
}

export const circuitScheduleEditorItems = (project: Project | null, analysis: CircuitAnalysis): CircuitScheduleEditorItem[] =>
  [...differentialRows(project), ...circuitScheduleRows(analysis)].map((row) => ({
    id: row.id,
    title: row.category || row.id,
    subtitle: `${row.id} · ${row.protection}`,
    kind: row.id.startsWith('DIFF:') ? 'differential' : 'circuit',
    modules: row.modules
  }))

type SchedulePlacement = { circuit: ScheduleCircuit; page: number; row: number; module: number }

const placeSchedule = (
  entries: Array<{ circuit: ScheduleCircuit; gapBefore: number }>,
  modulesPerRow: number
): SchedulePlacement[] => {
  const placements: SchedulePlacement[] = []
  let absoluteRow = 0
  let cursor = 0
  for (const entry of entries) {
    const span = Math.min(modulesPerRow, Math.max(1, entry.circuit.modules))
    let start = cursor + entry.gapBefore
    if (start + span > modulesPerRow) {
      absoluteRow += 1
      cursor = 0
      start = Math.min(entry.gapBefore, Math.max(0, modulesPerRow - span))
    }
    placements.push({
      circuit: entry.circuit,
      page: Math.floor(absoluteRow / ROWS),
      row: absoluteRow % ROWS,
      module: start
    })
    cursor = start + span
    if (cursor >= modulesPerRow) {
      absoluteRow += 1
      cursor = 0
    }
  }
  return placements
}

const cell = (placement: SchedulePlacement, modulesPerRow: number): string => {
  const { circuit, row, module } = placement
  const moduleWidth = PAGE_W / modulesPerRow
  const cellWidth = Math.max(moduleWidth, circuit.modules * moduleWidth)
  const x = PAGE_X + module * moduleWidth
  const y = PAGE_Y + row * CELL_H
  const center = x + cellWidth / 2
  const consumerLabel = circuit.category || circuit.consumers.join(' · ') || 'Reserve'
  const roomLabel = circuit.rooms.length ? ` · ${circuit.rooms.join(', ')}` : ''
  const title = circuit.note?.trim() || `${consumerLabel}${roomLabel}`
  const titleLines = wrap(title.toUpperCase(), 22, 3)
  return `<g>
    <rect x="${x}" y="${y}" width="${cellWidth}" height="${CELL_H}" fill="${row % 2 ? '#fdfbf9' : '#ffffff'}" stroke="#d8cec7" stroke-width="0.35"/>
    ${text(x + 3, y + 7, circuit.id, { size: 4.2, weight: 750, fill: '#a85427' })}
    ${text(x + cellWidth - 3, y + 7, circuit.poles, { size: 2.4, weight: 600, anchor: 'end', fill: '#756a63' })}
    ${text(center, y + 17, circuit.protection, { size: 4, weight: 700, anchor: 'middle' })}
    ${text(center, y + 23, circuit.cable, { size: 2.25, weight: 500, anchor: 'middle', fill: '#756a63' })}
    <line x1="${x + 5}" y1="${y + 28}" x2="${x + cellWidth - 5}" y2="${y + 28}" stroke="#eadfd8" stroke-width="0.35"/>
    ${titleLines.map((line, lineIndex) => text(center, y + 38 + lineIndex * 5, line, { size: 2.8, weight: lineIndex === 0 ? 650 : 500, anchor: 'middle' })).join('')}
  </g>`
}

export const buildCircuitScheduleSvgs = (project: Project | null, analysis: CircuitAnalysis): string[] => {
  const modulesPerRow = project?.circuitScheduleLayout?.modulesPerRow === 18 ? 18 : 24
  const entries = configuredRows(
    [...differentialRows(project), ...circuitScheduleRows(analysis)],
    project?.circuitScheduleLayout
  )
  if (!entries.length) return []
  const placements = placeSchedule(entries, modulesPerRow)
  const pages = Math.max(1, ...placements.map((placement) => placement.page + 1))
  return Array.from({ length: pages }, (_, pageIndex) => {
    const pageCircuits = placements.filter((placement) => placement.page === pageIndex)
    const projectName = project?.name?.trim() || 'Cadle project'
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" width="2480" height="3508">
      <rect width="210" height="297" fill="#ffffff"/>
      <rect x="8" y="7" width="194" height="15" rx="1.5" fill="#2d231c"/>
      ${text(13, 16.5, 'VERDEELBORD · KRINGENOVERZICHT', { size: 4, weight: 750, fill: '#ffffff' })}
      ${text(197, 13.5, projectName.toUpperCase(), { size: 2.5, weight: 600, anchor: 'end', fill: '#dacbc1' })}
      ${text(197, 18, `${pageIndex + 1}/${pages}`, { size: 2.4, weight: 600, anchor: 'end', fill: '#ffffff' })}
      ${pageCircuits.map((placement) => cell(placement, modulesPerRow)).join('')}
      ${text(8, 291, 'Automatisch gegenereerd uit de kringgegevens van het project', { size: 2.2, fill: '#8b7e76' })}
      ${text(202, 291, `${analysis.families.length} kringen`, { size: 2.2, weight: 600, anchor: 'end', fill: '#8b7e76' })}
    </svg>`
  })
}
