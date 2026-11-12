import type { Point } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingRoomKey, heatingWallDistances } from './heating-coverage.js'

export type HeatingPlanningDiagnostic = {
  code: 'capacity' | 'connection' | 'coverage' | 'placement' | 'timeout'
  scale: number; diameterMm: number; spacingMm: number; capacity: number; maxCircuitLengthM: number
  candidateCircuits: number; areaM2: number; estimatedFloorPipeM: number; point: Point
  rooms: { key: string; name: string; zoneName: string; areaM2: number; estimatedFloorPipeM: number; candidateCircuits: number; loopM: number; point: Point; bounds: { x: number; y: number; width: number; height: number } }[]
  issues: { message: string; point?: Point }[]
}

export class HeatingPlanningFailure extends Error {
  constructor(message: string, readonly diagnostics: HeatingPlanningDiagnostic) { super(message); this.name = 'HeatingPlanningFailure' }
}

export const describeHeatingPlan = (grid: HeatingGrid, settings: { diameterMm: number; spacingMm: number; edgeMm?: number; capacity?: number; design?: { maxCircuitLengthM?: number } }, scale: number, point: Point,
  fields: { roomKey?: string; roomName: string; roomMembers?: { key: string; name: string }[]; loopM: number }[]): HeatingPlanningDiagnostic => {
  const distance = heatingWallDistances(grid), areas = new Map(grid.rooms.map((room) => [heatingRoomKey(room), room.cells.filter((cell) => !grid.obstacle[cell] && distance[cell] * grid.step * scale / 8 >= (settings.edgeMm ?? 100)).length * (grid.step * scale / 8000) ** 2]))
  const rooms = grid.rooms.map((room) => {
    const key = heatingRoomKey(room), areaM2 = areas.get(key) ?? 0, p = grid.point(room.minY * grid.width + room.minX), q = grid.point(room.maxY * grid.width + room.maxX)
    const own = fields.filter((field) => field.roomMembers?.length ? field.roomMembers.some((r) => r.key === key) : field.roomKey === key)
    const centre = room.cells.reduce((sum, cell) => { const p = grid.point(cell); return { x: sum.x + p.x / room.cells.length, y: sum.y + p.y / room.cells.length } }, { x: 0, y: 0 })
    const nearest = room.cells.reduce((best, cell) => {
      const p = grid.point(cell), old = grid.point(best)
      return Math.hypot(p.x - centre.x, p.y - centre.y) < Math.hypot(old.x - centre.x, old.y - centre.y) ? cell : best
    }, room.cells[0])
    return { key, name: room.name, zoneName: own[0]?.roomName ?? room.name, areaM2, estimatedFloorPipeM: areaM2 / (settings.spacingMm / 1000), candidateCircuits: own.length,
      loopM: own.reduce((sum, field) => sum + field.loopM * areaM2 / Math.max(.0001, (field.roomMembers?.length ? field.roomMembers.map((r) => r.key) : [key]).reduce((total, memberKey) => total + (areas.get(memberKey) ?? 0), 0)), 0), point: grid.point(nearest), bounds: { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y } }
  })
  const areaM2 = rooms.reduce((sum, room) => sum + room.areaM2, 0)
  return { code: 'capacity', scale, diameterMm: settings.diameterMm, spacingMm: settings.spacingMm, capacity: settings.capacity ?? 12,
    maxCircuitLengthM: settings.design?.maxCircuitLengthM ?? 100, candidateCircuits: fields.length, areaM2, estimatedFloorPipeM: areaM2 / (settings.spacingMm / 1000), point, rooms, issues: [] }
}
