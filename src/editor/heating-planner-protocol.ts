import type { AutomaticHeatingResult, AutomaticHeatingSettings } from './automatic-heating-plan.js'
import type { DrawingScale } from './layout/drawing-scale.js'
import type { Point, Shape, RectShape } from './model/types.js'

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
  layoutLimit?: number
}
export type HeatingPlannerInput = {
  preserved?: RectShape[]
  existingManifold?: RectShape
  onlyRoom?: string
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
  | { type: 'error'; message: string; diagnostics?: import('./heating-diagnostics.js').HeatingPlanningDiagnostic }

export const heatingProgressText = (progress: HeatingPlanningProgress | null): string => {
  if (!progress || progress.phase === 'rooms') return 'Ruimtes herkennen…'
  const attempt = progress.layoutLimit ? ` · indeling ${progress.attempt ?? 1}/${progress.layoutLimit}` : progress.attempt && progress.attempt > 1 ? ` · indeling ${progress.attempt}` : ''
  if (progress.phase === 'circuits') return `Slakkenhuizen indelen${attempt}${progress.rooms ? ` · ${progress.completedRooms ?? 0}/${progress.rooms} ruimtes` : ''}${progress.roomName ? ` · ${progress.roomName}` : ''}${progress.remainingFields !== undefined ? ` · ${progress.remainingFields} deelvlakken` : ''}${progress.routeAttempts ? ` · ${progress.routeAttempts} routepogingen` : ''}…`
  if (progress.phase === 'connections') return `Aansluitingen zoeken · ${progress.completedCircuits ?? 0}/${progress.circuits ?? 0} kringen${progress.roomName ? ` · ${progress.roomName}` : ''}${attempt}…`
  return 'Kringen, lengtes en kringentabel controleren…'
}
