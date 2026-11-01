import type { LineShape, Point } from './types.js'
import type { ElectricalCableType } from './electrical.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'

export type ConnectionKind = 'wire' | 'cable' | 'branch' | 'bridge'
export type ElectricalConnection = {
  kind: ConnectionKind
  name?: string
  conductors?: number
  sectionMm2?: number
  cableType?: ElectricalCableType
  hasProtectiveConductor?: boolean
  showLabel?: boolean
  offsetMm?: number
  labelOwner?: 'circuit' | 'topology'
}

export const CONNECTION_NAMES: Record<ConnectionKind, string> = {
  wire: 'Draad', cable: 'Kabel', branch: 'Aftakking', bridge: 'Brugverbinding'
}
export const isConnectionKind = (value: unknown): value is ConnectionKind =>
  value === 'wire' || value === 'cable' || value === 'branch' || value === 'bridge'

export const connectionDefaults = (kind: ConnectionKind): ElectricalConnection => ({
  kind,
  ...(kind === 'wire' || kind === 'cable' ? {
    conductors: kind === 'cable' ? 3 : 1, sectionMm2: 2.5,
    cableType: kind === 'cable' ? 'XVB' : 'VOB', hasProtectiveConductor: kind === 'cable', showLabel: true
  } : { showLabel: false }),
  ...(kind === 'bridge' ? { offsetMm: 3 } : {})
})

export const sanitizeConnection = (value: unknown): ElectricalConnection | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (!isConnectionKind(raw.kind)) return undefined
  const result: ElectricalConnection = { kind: raw.kind }
  if (typeof raw.name === 'string') result.name = raw.name.slice(0, 160)
  if (typeof raw.conductors === 'number' && Number.isInteger(raw.conductors) && raw.conductors > 0 && raw.conductors <= 1000) result.conductors = raw.conductors
  if (typeof raw.sectionMm2 === 'number' && Number.isFinite(raw.sectionMm2) && raw.sectionMm2 > 0 && raw.sectionMm2 <= 10000) result.sectionMm2 = raw.sectionMm2
  if (['none', 'VOB', 'XVB', 'XVB-Cca', 'XGB', 'XGB-Cca', 'EXVB', 'other'].includes(String(raw.cableType))) result.cableType = raw.cableType as ElectricalCableType
  if (typeof raw.hasProtectiveConductor === 'boolean') result.hasProtectiveConductor = raw.hasProtectiveConductor
  if (typeof raw.showLabel === 'boolean') result.showLabel = raw.showLabel
  if (raw.labelOwner === 'circuit' || raw.labelOwner === 'topology') result.labelOwner = raw.labelOwner
  if (typeof raw.offsetMm === 'number' && Number.isFinite(raw.offsetMm)) result.offsetMm = Math.max(-30, Math.min(30, raw.offsetMm))
  return result
}

export const cableLabelText = (cable: {
  conductors?: number; sectionMm2?: number; hasProtectiveConductor?: boolean; cableType?: string
}): string => {
  const marker = (cable.hasProtectiveConductor ?? cable.conductors !== 4) ? 'G' : 'X'
  const type = cable.cableType?.trim()
  return `${cable.conductors ?? 3}${marker}${cable.sectionMm2 ?? 1.5} mm²${type && type !== 'none' ? ` ${type.replace('-', ' ')}` : ''}`
}

export const connectionLabel = (connection: ElectricalConnection): string => {
  if (connection.showLabel === false) return ''
  if (connection.name?.trim()) return connection.name.trim()
  if (connection.kind === 'cable') return cableLabelText(connection)
  if (connection.kind === 'wire') return `${(connection.conductors ?? 1) > 1 ? `${connection.conductors} × ` : ''}${connection.sectionMm2 ?? 2.5} mm²${connection.cableType && connection.cableType !== 'none' ? ` ${connection.cableType.replace('-', ' ')}` : ''}`
  return ''
}

/** Real conductor segments, shared by drawing, snapping and connectivity. */
export const connectionPoints = (shape: Pick<LineShape, 'start' | 'end' | 'connection'>): Point[] => {
  if (shape.connection?.kind !== 'bridge') return [shape.start, shape.end]
  const dx = shape.end.x - shape.start.x, dy = shape.end.y - shape.start.y
  const length = Math.hypot(dx, dy)
  if (!length) return [shape.start, shape.end]
  const offset = (shape.connection.offsetMm ?? 3) * PAPER_WORLD_UNITS_PER_MM
  const x = dy / length * offset, y = -dx / length * offset
  return [shape.start, { x: shape.start.x + x, y: shape.start.y + y },
    { x: shape.end.x + x, y: shape.end.y + y }, shape.end]
}

export const connectionSegments = (shape: Pick<LineShape, 'start' | 'end' | 'connection'>) => {
  const points = connectionPoints(shape)
  return points.slice(1).map((end, index) => ({ start: points[index], end }))
}

export const connectionTextLayout = (shape: LineShape) => {
  const points = connectionPoints(shape)
  const start = points.length === 4 ? points[1] : points[0]
  const end = points.length === 4 ? points[2] : points[1]
  const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x)
  let angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle <= -90) angle += 180
  if (vertical) angle = -Math.abs(angle)
  return { x: (start.x + end.x) / 2 + (vertical ? 16 : 0),
    y: (start.y + end.y) / 2 - (vertical ? 0 : 16), angle }
}

export const connectionBounds = (shape: LineShape) => {
  const points = connectionPoints(shape).map((point) => ({ ...point }))
  const label = shape.connection && !shape.connection.labelOwner && connectionLabel(shape.connection)
  if (label) {
    const text = connectionTextLayout(shape), radians = text.angle * Math.PI / 180
    const halfWidth = label.length * 20 * 0.68 / 2
    for (const x of [-halfWidth, halfWidth]) for (const y of [-20, 4]) points.push({
      x: text.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: text.y + x * Math.sin(radians) + y * Math.cos(radians)
    })
  }
  const padding = shape.connection?.kind === 'branch' ? 4 : shape.connection?.kind === 'cable' ? 8 : 0
  const left = Math.min(...points.map((point) => point.x)) - padding
  const top = Math.min(...points.map((point) => point.y)) - padding
  return { x: left, y: top, width: Math.max(...points.map((point) => point.x)) + padding - left,
    height: Math.max(...points.map((point) => point.y)) + padding - top }
}
