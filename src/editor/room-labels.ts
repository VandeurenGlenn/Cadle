import type { Point, Shape, TextShape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'

export type RoomLabelData = { id: string; name: string }
export const sanitizeRoomLabel = (value: unknown): RoomLabelData | undefined => {
  if (!value || typeof value !== 'object') return
  const { id, name } = value as RoomLabelData
  if (typeof id !== 'string' || typeof name !== 'string' || !id.trim() || !name.trim()) return
  return { id: id.trim().slice(0, 32), name: name.trim().slice(0, 100) }
}
export const isRoomLabel = (shape: Shape): shape is TextShape & { roomLabel: RoomLabelData } =>
  shape.kind === 'text' && Boolean(shape.roomLabel)
export const roomLabelName = (label: RoomLabelData): string => `${label.id} – ${label.name}`
export const nextRoomLabelId = (shapes: readonly Shape[]): string => {
  const ids = new Set(shapes.filter(isRoomLabel).map((shape) => shape.roomLabel.id.toUpperCase()))
  let index = 1
  while (ids.has(`R${String(index).padStart(2, '0')}`)) index++
  return `R${String(index).padStart(2, '0')}`
}
export const roomLabelInRegion = (shapes: readonly Shape[], grid: HeatingGrid, roomId: number) =>
  shapes.filter(isRoomLabel).find((shape) => !shape.hidden && grid.room[grid.index(shape.position)] === roomId)

/** Names belong to the closed floor region containing the anchor, independently
 * of wall groups, door swing geometry or the bounding box of an L-shaped room. */
export const assignRoomLabel = (shapes: readonly Shape[], grid: HeatingGrid, point: Point, data: RoomLabelData, nextId: () => string) => {
  const region = grid.rooms.find((room) => room.id === grid.room[grid.index(point)])
  if (!region) throw new Error('Klik binnen een gesloten ruimte. Controleer de muren en deuropeningen.')
  const label = sanitizeRoomLabel(data)
  if (!label) throw new Error('Vul een ruimte-ID en naam in.')
  const existing = roomLabelInRegion(shapes, grid, region.id)
  if (shapes.some((shape) => isRoomLabel(shape) && shape.id !== existing?.id && shape.roomLabel.id.toUpperCase() === label.id.toUpperCase())) {
    throw new Error('Deze ruimte-ID is al in gebruik. Kies een unieke ID.')
  }
  const annotation: TextShape = { ...existing, id: existing?.id ?? nextId(), kind: 'text', roomLabel: label,
    position: existing?.position ?? point, text: `${label.id}\n${label.name}`, scale: existing?.scale ?? 1,
    fontWeight: existing?.fontWeight ?? 600, textAnchor: 'middle' }
  const circuitIds = new Set(shapes.filter((shape) => {
    if (shape.kind !== 'rect' || shape.heating?.pipeRole !== 'loop' || !shape.heating.circuitId) return false
    if (existing && shape.heating.roomKey === existing.id) return true
    const p = shape.heating.points?.[0]
    if (!p) return false
    const anchor = { x: Math.min(shape.start.x, shape.end.x) + Math.abs(shape.end.x - shape.start.x) * p.x,
      y: Math.min(shape.start.y, shape.end.y) + Math.abs(shape.end.y - shape.start.y) * p.y }
    return grid.room[grid.index(anchor)] === region.id
  }).map((shape) => shape.heating!.circuitId!))
  const name = roomLabelName(label)
  const updated = shapes.map((shape): Shape => {
    if (shape.id === existing?.id) return annotation
    const data = shape.heating
    if (data?.kind === 'pipe' && circuitIds.has(data.circuitId!)) return { ...shape, heating: { ...data, roomName: name, roomKey: annotation.id } }
    const loads = data?.design?.roomHeatLoadsW
    if (data?.kind === 'manifold' && loads && region.name !== name && Object.hasOwn(loads, region.name)) {
      const renamed = { ...loads, [name]: loads[region.name] }; delete renamed[region.name]
      return { ...shape, heating: { ...data, design: { ...data.design, roomHeatLoadsW: renamed } } }
    }
    return shape
  })
  if (!existing) updated.push(annotation)
  return { shapes: updated, annotation }
}
