import type { Project } from '../types.js'
import type { Point } from './model/types.js'
import type { CircuitScheduleEditorItem } from './circuit-schedule-page.js'
import { bindingParts, inferCircuitRole } from './circuit-analysis.js'
import { normalizeElectricalProfile } from './electrical-profile.js'
import { nativeStateForProjectPage } from './model/document-state.js'
import { isDistributionBoardDevice } from './model/electrical.js'
import { shapeBounds } from './model/model.js'
import { drawingLengthMetres, isDrawingScale } from './layout/drawing-scale.js'

export type FloorPlanBoardLocation = {
  key: string
  pageKey: string
  shapeId: string
  label: string
  position: Point
  boardId?: string
}

export type CircuitCableEstimate = {
  id: string
  boardId: string
  cable: string
  metres: number | null
  complete: boolean
  notes: string[]
}

const floorPlans = (project: Project) => Object.entries(project.pages)
  .filter(([, page]) => page.pageType === 'groundplan' && !page.heatingPlanOf && !page.heatingScheduleOf)
  .map(([key, page]) => ({ key, page, state: nativeStateForProjectPage(project, key) }))

export const floorPlanBoardLocations = (project: Project): FloorPlanBoardLocation[] =>
  floorPlans(project).flatMap(({ key, page, state }) => (state?.shapes ?? []).flatMap((shape, index) =>
    !shape.hidden && (shape.kind === 'symbol' || shape.kind === 'image') && isDistributionBoardDevice(shape.name, shape.path)
      ? [{
          key: `${key}/${shape.id}`, pageKey: key, shapeId: shape.id, position: shape.position,
          label: `${page.name} - ${shape.bindingId || shape.name} (${index + 1})`,
          boardId: shape.kind === 'symbol' ? shape.electrical?.boardId : undefined
        }] : []))

export const cableEstimateBoardLocation = (
  project: Project, boardId: string, locations = floorPlanBoardLocations(project)
): FloorPlanBoardLocation | undefined => {
  const boards = normalizeElectricalProfile(project.electricalProfile).boards ?? []
  const saved = boards.find((board) => board.id === boardId)?.floorPlanLocation
  if (saved) return locations.find((location) => location.pageKey === saved.pageKey && location.shapeId === saved.shapeId)
  const assigned = locations.filter((location) => location.boardId === boardId)
  if (assigned.length) return assigned.length === 1 ? assigned[0] : undefined
  return boards.length === 1 && boards[0].id === boardId && locations.length === 1 && !locations[0].boardId
    ? locations[0] : undefined
}

// A rectilinear minimum spanning tree is a route estimate, not a wall-routing or installation model.
const estimatedNetworkLength = (points: readonly Point[]): number => {
  const distances = points.map((_, index) => index ? Infinity : 0)
  const visited = new Set<number>()
  let length = 0
  while (visited.size < points.length) {
    let nearest = -1
    for (let index = 0; index < points.length; index++) {
      if (!visited.has(index) && (nearest === -1 || distances[index] < distances[nearest])) nearest = index
    }
    visited.add(nearest)
    length += distances[nearest]
    for (let index = 0; index < points.length; index++) {
      if (visited.has(index)) continue
      distances[index] = Math.min(distances[index],
        Math.abs(points[index].x - points[nearest].x) + Math.abs(points[index].y - points[nearest].y))
    }
  }
  return length
}

export const estimateCircuitCables = (
  project: Project,
  items: readonly CircuitScheduleEditorItem[]
): CircuitCableEstimate[] => {
  const plans = floorPlans(project)
  const locations = floorPlanBoardLocations(project)
  return items.filter((item) => item.kind === 'circuit').map((item) => {
    const notes: string[] = []
    const devices = plans.flatMap(({ key, state }) => (state?.shapes ?? []).flatMap((shape) => {
      if (shape.hidden || bindingParts(shape.bindingId ?? '')?.family !== item.id ||
        (shape.kind === 'symbol' && shape.electrical?.oneWireEligible === false)) return []
      const role = inferCircuitRole(shape)
      if (role !== 'load' && role !== 'switch') return []
      const bounds = shapeBounds(shape)
      return [{ pageKey: key, position: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } }]
    }))
    const location = cableEstimateBoardLocation(project, item.boardId, locations)
    const local = location ? devices.filter((device) => device.pageKey === location.pageKey) : []
    const scale = plans.find((plan) => plan.key === location?.pageKey)?.state?.drawingScale
    if (!devices.length) notes.push('Geen gelabelde verbruikers of schakelaars op het situatieplan.')
    if (!location) notes.push('Koppel een unieke kastpositie op het situatieplan.')
    if (location && !isDrawingScale(scale)) notes.push('Tekenschaal ontbreekt op het situatieplan van de kast.')
    if (location && devices.length > local.length)
      notes.push(`${devices.length - local.length} punten op andere pagina's niet geraamd; verbindingsroute tussen pagina's onbekend.`)
    const metres = location && local.length && isDrawingScale(scale)
      ? drawingLengthMetres(estimatedNetworkLength([location.position, ...local.map((device) => device.position)]), scale)
      : null
    return {
      id: item.id, boardId: item.boardId, cable: item.cable ?? 'Kabel niet opgegeven',
      metres, complete: metres !== null && notes.length === 0, notes
    }
  })
}

export const formatCableMetres = (metres: number): string =>
  `${metres.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`
