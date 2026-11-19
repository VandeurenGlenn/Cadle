import type { DifferentialProtection, Project } from '../types.js'
import { normalizeElectricalProfile } from './electrical-profile.js'
import { refreshCircuitScheduleItems, type CircuitScheduleEditorItem } from './circuit-schedule-page.js'
import { orderedOneWireDifferentials } from './layout/onewire-topology.js'

export const addScheduleDifferential = (
  project: Project, boardId: string, protection: DifferentialProtection, main = false
): Project => {
  const profile = normalizeElectricalProfile(project.electricalProfile)
  const board = profile.boards?.find((board) => board.id === boardId)
  if (!board) throw new Error('De gekozen kast bestaat niet meer.')
  if (![protection.ratedCurrentA, protection.sensitivityMa].every((value) => Number.isFinite(value) && value > 0) ||
    ![2, 3, 4].includes(protection.poles)) throw new Error('Controleer de stroom, gevoeligheid en het pooltal.')
  if (protection.railId && !board.rails.some((rail) => rail.id === protection.railId)) throw new Error('De gekozen rij bestaat niet meer.')
  if (main) {
    if (board.mainDifferential || refreshCircuitScheduleItems(project, []).some((item) =>
      item.boardId === boardId && item.mainDifferential)) throw new Error('Deze kast heeft al een hoofddifferentieel.')
    board.mainDifferential = { ...protection, railId: undefined }
  } else {
    if (board.additionalDifferentials?.some((item) => item.id === protection.id)) throw new Error('Dit differentieel bestaat al in de kast.')
    board.additionalDifferentials = [...(board.additionalDifferentials ?? []), { ...protection, matchExistingSources: false }]
  }
  return { ...project, electricalProfile: profile }
}

export const assignScheduleDifferential = (
  project: Project, items: readonly CircuitScheduleEditorItem[], id: string, boardId: string, railId?: string
): Project => {
  const item = items.find((item) => item.id === id && item.kind === 'differential')
  if (!item) throw new Error('Het differentieel bestaat niet meer.')
  const profile = normalizeElectricalProfile(project.electricalProfile)
  const target = profile.boards?.find((board) => board.id === boardId)
  if (!target) throw new Error('De gekozen kast bestaat niet meer.')
  if (railId && !target.rails.some((rail) => rail.id === railId)) throw new Error('De gekozen rij bestaat niet meer.')
  if (item.topologyMain && boardId !== profile.boards?.[0]?.id) throw new Error('De hoofddifferentieel van de hoofdvoeding kan niet naar een andere kast worden verplaatst.')
  if (item.mainDifferential && item.boardId !== boardId && refreshCircuitScheduleItems(project, []).some((candidate) =>
    candidate.mainDifferential && candidate.boardId === boardId)) throw new Error('De doelkast heeft al een hoofddifferentieel.')
  let next: Project = { ...project, electricalProfile: profile, pages: { ...project.pages } }
  let protectionId = item.protectionId
  if (protectionId !== undefined) {
    const source = profile.boards?.find((board) => board.id === item.boardId)
    const protection = item.mainDifferential ? source?.mainDifferential
      : source?.additionalDifferentials?.find((protection) => protection.id === item.protectionId)
    if (!source || !protection) throw new Error('De opgeslagen beveiliging bestaat niet meer.')
    if (item.mainDifferential) {
      source.mainDifferential = undefined
      target.mainDifferential = { ...protection, railId: undefined }
    } else {
      source.additionalDifferentials = source.additionalDifferentials?.filter((entry) => entry.id !== protection.id)
      const ids = new Set(target.additionalDifferentials?.map((entry) => entry.id))
      for (let suffix = 2; ids.has(protectionId); suffix++) protectionId = `${protection.id}-${suffix}`
      target.additionalDifferentials = [...(target.additionalDifferentials ?? []), { ...protection, id: protectionId, railId }]
    }
  }
  if (item.topologyIndex !== undefined && next.oneWireTopology) {
    const ordered = orderedOneWireDifferentials(next.oneWireTopology)
    next = { ...next, oneWireTopology: { ...next.oneWireTopology,
      additionalDifferentials: ordered.map((entry, index) => ({ ...entry, count: 1,
        ...(index === item.topologyIndex ? { boardId, railId } : {}) })) } }
  }
  if (item.protectionId === undefined && item.topologyIndex === undefined && !item.sourceShapes?.length && !item.topologyMain) {
    throw new Error('Dit differentieel heeft geen bewerkbare kastkoppeling.')
  }
  for (const pageKey of new Set(item.sourceShapes?.map((reference) => reference.pageKey))) {
    const shapeIds = new Set(item.sourceShapes?.filter((reference) => reference.pageKey === pageKey).map((reference) => reference.shapeId))
    const page = next.pages[pageKey]
    if (!page) throw new Error('Het schemablad bestaat niet meer.')
    let updated = 0
    const objects = page.schema.objects.map((object) => {
      const wrapper = object as { kind?: string; payload?: { shapes?: unknown[] } }
      if (wrapper.kind !== 'cadle-native-svg-document' || !Array.isArray(wrapper.payload?.shapes)) return object
      return { ...wrapper, payload: { ...wrapper.payload, shapes: wrapper.payload.shapes.map((value) => {
        if (!value || typeof value !== 'object') return value
        const shape = value as { id?: string; kind?: string; locked?: boolean; electrical?: Record<string, unknown> }
        if (shape.kind !== 'symbol' || !shape.id || !shapeIds.has(shape.id)) return value
        if (shape.locked) throw new Error('Ontgrendel het differentieel op het eendraads voordat je de kastkoppeling wijzigt.')
        updated++
        return { ...shape, electrical: { ...shape.electrical, role: 'protection', oneWireEligible: true,
          boardId, railId: item.mainDifferential ? undefined : railId } }
      }) } }
    })
    if (updated !== shapeIds.size) throw new Error('Het differentieel kon niet op het opgeslagen schemablad worden teruggevonden.')
    next.pages[pageKey] = { ...page, schema: { ...page.schema, objects } }
  }
  const refreshed = refreshCircuitScheduleItems(next, items)
  const moved = refreshed.find((candidate) => candidate.kind === 'differential' && candidate.boardId === boardId &&
    (protectionId !== undefined ? candidate.protectionId === protectionId
      : item.topologyIndex !== undefined ? candidate.topologyIndex === item.topologyIndex
        : item.sourceShapes?.some((reference) => candidate.sourceShapes?.some((source) =>
          source.pageKey === reference.pageKey && source.shapeId === reference.shapeId))))
  if (moved && moved.id !== id && next.circuitScheduleLayout?.items) {
    const used = new Set<string>()
    next = { ...next, circuitScheduleLayout: { ...next.circuitScheduleLayout, items: next.circuitScheduleLayout.items
      .map((entry) => entry.id === id ? { ...entry, id: moved.id } : entry)
      .filter((entry) => { if (used.has(entry.id)) return false; used.add(entry.id); return true }) } }
  }
  return next
}
