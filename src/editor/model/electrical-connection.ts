import { cableLabelText, cableTypeLabel, sanitizeCableFireClass, withCableFireClass } from './cable-designation.js'
export { cableLabelText } from './cable-designation.js'
import type { LineShape, Point } from './types.js'
import type { ElectricalCableType } from './electrical.js'
import { PAPER_WORLD_UNITS_PER_MM } from '../constants.js'
import { paperTextLineHeight, paperTextWidth, wrapPaperText } from '../layout/paper-text-layout.js'

export type ConnectionKind = 'wire' | 'cable' | 'branch' | 'bridge'
export type ElectricalConnection = {
  kind: ConnectionKind
  name?: string
  conductors?: number
  sectionMm2?: number
  fireClass?: string
  cableType?: ElectricalCableType
  hasProtectiveConductor?: boolean
  showLabel?: boolean
  offsetMm?: number
  labelOwner?: 'circuit' | 'topology'
  routing?: 'orthogonal'
  via?: Point[]
}

export const CONNECTION_NAMES: Record<ConnectionKind, string> = {
  wire: 'Draad', cable: 'Kabel', branch: 'Aftakking', bridge: 'Brugverbinding'
}
export const isConnectionKind = (value: unknown): value is ConnectionKind =>
  value === 'wire' || value === 'cable' || value === 'branch' || value === 'bridge'

export const connectionDefaults = (kind: ConnectionKind): ElectricalConnection => ({
  kind,
  routing: 'orthogonal',
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
  if (typeof raw.fireClass === 'string') result.fireClass = sanitizeCableFireClass(raw.fireClass)
  if (typeof raw.name === 'string') result.name = raw.name.slice(0, 160)
  if (typeof raw.conductors === 'number' && Number.isInteger(raw.conductors) && raw.conductors > 0 && raw.conductors <= 1000) result.conductors = raw.conductors
  if (typeof raw.sectionMm2 === 'number' && Number.isFinite(raw.sectionMm2) && raw.sectionMm2 > 0 && raw.sectionMm2 <= 10000) result.sectionMm2 = raw.sectionMm2
  if (['none', 'VOB', 'XVB', 'XVB-Cca', 'XGB', 'XGB-Cca', 'EXVB', 'other'].includes(String(raw.cableType))) result.cableType = raw.cableType as ElectricalCableType
  if (typeof raw.hasProtectiveConductor === 'boolean') result.hasProtectiveConductor = raw.hasProtectiveConductor
  if (typeof raw.showLabel === 'boolean') result.showLabel = raw.showLabel
  if (raw.labelOwner === 'circuit' || raw.labelOwner === 'topology') result.labelOwner = raw.labelOwner
  if (raw.routing === 'orthogonal') result.routing = 'orthogonal'
  if (Array.isArray(raw.via)) result.via = raw.via.slice(0, 1000).flatMap((point) => point &&
    typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
    ? [{ x: point.x, y: point.y }] : [])
  if (typeof raw.offsetMm === 'number' && Number.isFinite(raw.offsetMm)) result.offsetMm = Math.max(-30, Math.min(30, raw.offsetMm))
  return result
}

export const connectionLabel = (connection: ElectricalConnection): string => {
  if (connection.showLabel === false) return ''
  if (connection.name?.trim()) return withCableFireClass(connection.name.trim(), connection.kind === 'wire' || connection.kind === 'cable' ? connection.fireClass : undefined)
  if (connection.kind === 'cable') return cableLabelText(connection)
  if (connection.kind === 'wire') return `${(connection.conductors ?? 1) > 1 ? `${connection.conductors} × ` : ''}${connection.sectionMm2 ?? 2.5} mm²${cableTypeLabel(connection) ? ` ${cableTypeLabel(connection)}` : ''}`
  return ''
}

/** Real conductor segments, shared by drawing, snapping and connectivity. */
export const connectionPoints = (shape: Pick<LineShape, 'start' | 'end' | 'connection'>): Point[] => {
  if (shape.connection && shape.connection.kind !== 'bridge') {
    const stops = [shape.start, ...(shape.connection.via ?? []), shape.end]
    const points = [stops[0]]
    for (let index = 1; index < stops.length; index++) {
      const start = stops[index - 1], end = stops[index]
      if (Math.abs(start.x - end.x) >= 1e-8 && Math.abs(start.y - end.y) >= 1e-8) {
        const vertical = Math.abs(end.y - start.y) >= Math.abs(end.x - start.x)
        const middle = vertical ? (start.y + end.y) / 2 : (start.x + end.x) / 2
        points.push(...(vertical ? [{ x: start.x, y: middle }, { x: end.x, y: middle }]
          : [{ x: middle, y: start.y }, { x: middle, y: end.y }]))
      }
      points.push(end)
    }
    const distinct = points.filter((point, index) => !index || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-8)
    return distinct.length > 1 ? distinct : [shape.start, shape.end]
  }
  if (shape.connection?.kind !== 'bridge') return [shape.start, shape.end]
  const dx = shape.end.x - shape.start.x, dy = shape.end.y - shape.start.y
  const length = Math.hypot(dx, dy)
  if (!length) return [shape.start, shape.end]
  const offset = (shape.connection.offsetMm ?? 3) * PAPER_WORLD_UNITS_PER_MM
  if (Math.abs(dx) > 1e-8 && Math.abs(dy) > 1e-8) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      const y = Math.min(shape.start.y, shape.end.y) - Math.abs(offset)
      return [shape.start, { x: shape.start.x, y }, { x: shape.end.x, y }, shape.end]
    }
    const x = Math.max(shape.start.x, shape.end.x) + Math.abs(offset)
    return [shape.start, { x, y: shape.start.y }, { x, y: shape.end.y }, shape.end]
  }
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
  const segments = points.slice(1).map((end, index) => ({ start: points[index], end }))
  const { start, end } = segments.reduce((longest, segment) =>
    Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y) >
      Math.hypot(longest.end.x - longest.start.x, longest.end.y - longest.start.y) ? segment : longest)
  const vertical = Math.abs(end.y - start.y) > Math.abs(end.x - start.x)
  let angle = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
  if (angle > 90) angle -= 180
  if (angle <= -90) angle += 180
  if (vertical) angle = -Math.abs(angle)
  return { x: (start.x + end.x) / 2 + (vertical ? 32 : 0),
    y: (start.y + end.y) / 2 - (vertical ? 0 : 16), angle }
}

export const connectionBounds = (shape: LineShape) => {
  const points = connectionPoints(shape).map((point) => ({ ...point }))
  const label = shape.connection && !shape.connection.labelOwner && connectionLabel(shape.connection)
  if (label) {
    const text = connectionTextLayout(shape), radians = text.angle * Math.PI / 180
    const lines = wrapPaperText(label, 20)
    const halfWidth = Math.max(...lines.map((line) => paperTextWidth(line, 20))) / 2
    for (const x of [-halfWidth, halfWidth]) for (const y of [-20, (lines.length - 1) * paperTextLineHeight(20) + 4]) points.push({
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
