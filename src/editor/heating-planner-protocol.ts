import type { AutomaticHeatingResult, AutomaticHeatingSettings } from './automatic-heating-plan.js'
import type { DrawingScale } from './layout/drawing-scale.js'
import type { Point, Shape } from './model/types.js'

export type HeatingPlanningProgress = {
  phase: 'rooms' | 'circuits' | 'connections' | 'checks'
  roomName?: string
  rooms?: number
  fields?: number
  remainingFields?: number
  routeAttempts?: number
  circuits?: number
  completedRooms?: number
  completedCircuits?: number
  attempt?: number
}
export type HeatingPlannerInput = {
  scene: Shape[]
  position: Point
  settings: AutomaticHeatingSettings
  scale: DrawingScale
  pageArea: { x: number; y: number; width: number; height: number }
}
export type HeatingPlannerRequest = HeatingPlannerInput & { id: string }
export type HeatingPlannerResponse =
  | { type: 'progress'; progress: HeatingPlanningProgress }
  | { type: 'result'; result: AutomaticHeatingResult }
  | { type: 'error'; message: string }

export const heatingProgressText = (progress: HeatingPlanningProgress | null): string => {
  if (!progress || progress.phase === 'rooms') return 'Ruimtes herkennen…'
  if (progress.phase === 'circuits') return `Legvlakken samenvoegen${progress.rooms ? ` · ${progress.completedRooms ?? 0}/${progress.rooms} ruimtes` : ''}${progress.roomName ? ` · ${progress.roomName}` : ''}${progress.remainingFields !== undefined ? ` · ${progress.remainingFields} deelvlakken` : ''}${progress.routeAttempts ? ` · ${progress.routeAttempts} pogingen` : ''}…`
  if (progress.phase === 'connections') return `Aansluitingen zoeken · ${progress.completedCircuits ?? 0}/${progress.circuits ?? 0} kringen${progress.roomName ? ` · ${progress.roomName}` : ''}${progress.attempt && progress.attempt > 1 ? ` · poging ${progress.attempt}` : ''}…`
  return 'Kringen, lengtes en kringentabel controleren…'
}
