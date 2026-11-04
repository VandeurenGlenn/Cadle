import type { Point, RectShape } from './model/types.js'
import { drawingLengthMetres, drawingUnitsForMetres, isDrawingScale, DEFAULT_DRAWING_SCALE } from './layout/drawing-scale.js'
import { wrapPaperText } from './layout/paper-text-layout.js'

export type HeatingData = {
  kind: 'zone' | 'pipe' | 'manifold'
  name: string
  drawingScale: number
  spacingMm: number
  edgeMm: number
  diameterMm: number
  circuits: number
  direction: 'horizontal' | 'vertical'
  pipeRole: 'supply' | 'return'
  /** Pipe waypoints in the shape's own 0..1 coordinate space. */
  points?: Point[]
}

export const heatingDefaults = (kind: HeatingData['kind'], drawingScale = DEFAULT_DRAWING_SCALE): HeatingData => ({
  kind, drawingScale, name: kind === 'zone' ? 'Zone' : kind === 'manifold' ? 'Verdeler' : 'Buis',
  spacingMm: 150, edgeMm: 100, diameterMm: 16, circuits: kind === 'manifold' ? 6 : 1,
  direction: 'horizontal', pipeRole: 'supply'
})

export const sanitizeHeating = (value: unknown): HeatingData | undefined => {
  if (!value || typeof value !== 'object') return
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'zone' && raw.kind !== 'pipe' && raw.kind !== 'manifold') return
  const data = heatingDefaults(raw.kind, isDrawingScale(raw.drawingScale) ? raw.drawingScale : DEFAULT_DRAWING_SCALE)
  if (typeof raw.name === 'string') data.name = raw.name.trim().slice(0, 100)
  for (const [key, min, max] of [['spacingMm', 50, 500], ['edgeMm', 0, 1000], ['diameterMm', 6, 50], ['circuits', 1, 24]] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) data[key] = Math.max(min, Math.min(max, raw[key] as number))
  }
  data.circuits = Math.round(data.circuits)
  if (raw.direction === 'vertical') data.direction = 'vertical'
  if (raw.pipeRole === 'return') data.pipeRole = 'return'
  if (raw.kind === 'pipe' && Array.isArray(raw.points)) {
    data.points = raw.points.slice(0, 1000).flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const { x, y } = item as Point
      return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ x, y }] : []
    })
    if (data.points.length < 2) return
  }
  if (raw.kind === 'pipe' && !data.points) return
  return data
}

export const heatingBounds = (shape: RectShape) => ({
  x: Math.min(shape.start.x, shape.end.x), y: Math.min(shape.start.y, shape.end.y),
  width: Math.abs(shape.end.x - shape.start.x), height: Math.abs(shape.end.y - shape.start.y)
})

export const createHeatingPipe = (id: string, points: Point[], data: HeatingData): RectShape => {
  const x = Math.min(...points.map((p) => p.x)), y = Math.min(...points.map((p) => p.y))
  const width = Math.max(...points.map((p) => p.x)) - x, height = Math.max(...points.map((p) => p.y)) - y
  return { id, kind: 'rect', start: { x, y }, end: { x: x + width, y: y + height }, strokeWidth: 2,
    heating: { ...data, kind: 'pipe', points: points.map((p) => ({ x: width ? (p.x - x) / width : 0, y: height ? (p.y - y) / height : 0 })) } }
}

type HeatingCircuit = { path: string; lengthM: number; start: Point; end: Point }
export type HeatingLayout = { circuits: HeatingCircuit[]; areaM2: number; lengthM: number; warning?: string }

/** Generate rounded meanders in rectangular zones. The stated length excludes external leads. */
export const heatingLayout = (shape: RectShape): HeatingLayout => {
  const data = shape.heating!
  const bounds = heatingBounds(shape)
  const metre = (length: number) => drawingLengthMetres(length, data.drawingScale)
  if (data.kind === 'pipe') {
    const points = (data.points ?? []).map((p) => ({ x: bounds.x + p.x * bounds.width, y: bounds.y + p.y * bounds.height }))
    const lengthM = points.slice(1).reduce((sum, p, i) => sum + metre(Math.hypot(p.x - points[i].x, p.y - points[i].y)), 0)
    return { areaM2: 0, lengthM, circuits: points.length < 2 ? [] : [{ path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), lengthM, start: points[0], end: points.at(-1)! }] }
  }
  const areaM2 = metre(bounds.width) * metre(bounds.height)
  if (data.kind !== 'zone') return { circuits: [], areaM2: 0, lengthM: 0 }
  const vertical = data.direction === 'vertical'
  const width = vertical ? bounds.height : bounds.width, height = vertical ? bounds.width : bounds.height
  const spacing = drawingUnitsForMetres(data.spacingMm / 1000, data.drawingScale)
  const edge = drawingUnitsForMetres(data.edgeMm / 1000, data.drawingScale)
  const strip = width / data.circuits, innerWidth = strip - 2 * edge, innerHeight = height - 2 * edge
  const rows = Math.min(1000, 2 * Math.floor((Math.floor(innerHeight / spacing) + 1) / 2))
  if (rows < 2 || innerWidth <= spacing || innerHeight < spacing) {
    return { circuits: [], areaM2, lengthM: 0, warning: 'Zone te klein voor deze buisafstand, randafstand en aantal lussen.' }
  }
  const radius = spacing / 2
  const point = (x: number, y: number): Point => vertical ? { x: bounds.x + y, y: bounds.y + x } : { x: bounds.x + x, y: bounds.y + y }
  const coordinates = (x: number, y: number) => { const p = point(x, y); return `${p.x} ${p.y}` }
  const circuits = Array.from({ length: data.circuits }, (_, index): HeatingCircuit => {
    const left = index * strip + edge, right = (index + 1) * strip - edge
    let path = `M ${coordinates(left, edge)} L ${coordinates(right - radius, edge)}`
    for (let row = 1; row < rows; row++) {
      const y = edge + row * spacing, rightTurn = row % 2 === 1
      const x = rightTurn ? right - radius : left + radius
      const sweep = (rightTurn !== vertical) ? 1 : 0
      path += ` A ${radius} ${radius} 0 0 ${sweep} ${coordinates(x, y)}`
      path += ` L ${coordinates(row === rows - 1 ? left : rightTurn ? left + radius : right - radius, y)}`
    }
    const lengthM = metre(rows * (innerWidth - 2 * radius) + 2 * radius + (rows - 1) * Math.PI * radius)
    return { path, lengthM, start: point(left, edge), end: point(left, edge + (rows - 1) * spacing) }
  })
  return { circuits, areaM2, lengthM: circuits.reduce((sum, item) => sum + item.lengthM, 0) }
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export const heatingAnchors = (shape: RectShape): Point[] => {
  const b = heatingBounds(shape), data = shape.heating!
  const points = data.kind === 'manifold' ? Array.from({ length: data.circuits }, (_, i) => {
    const x = b.x + b.width * (i + 1) / (data.circuits + 1)
    return [{ x: x - 2, y: b.y + b.height }, { x: x + 2, y: b.y + b.height }]
  }).flat() : heatingLayout(shape).circuits.flatMap((circuit) => [circuit.start, circuit.end])
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, radians = (shape.rotation ?? 0) * Math.PI / 180
  return points.map((p) => {
    const x = (p.x - cx) * (shape.flipX ? -1 : 1), y = (p.y - cy) * (shape.flipY ? -1 : 1)
    return { x: cx + x * Math.cos(radians) - y * Math.sin(radians), y: cy + x * Math.sin(radians) + y * Math.cos(radians) }
  })
}

export const heatingMarkup = (shape: RectShape, selected = false, monochrome = false): string => {
  const data = shape.heating!, b = heatingBounds(shape), layout = heatingLayout(shape)
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  const transform = `translate(${cx} ${cy}) rotate(${shape.rotation ?? 0}) scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1}) translate(${-cx} ${-cy})`
  const red = monochrome ? '#000000' : '#b42318', blue = monochrome ? '#000000' : '#175cd3'
  const label = (x: number, y: number, value: string) => {
    const lines = wrapPaperText(value, 20, Math.max(160, b.width))
    return `<text x="${x}" y="${y - (lines.length - 1) * 24}" fill="#111111" stroke="white" stroke-width="4" paint-order="stroke" font-family="Segoe UI, Arial, sans-serif" font-size="20">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? 24 : 0}">${escape(line)}</tspan>`).join('')}</text>`
  }
  let markup = ''
  if (data.kind === 'manifold') {
    const top = b.y + b.height * .35, bottom = b.y + b.height * .7
    markup = `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="white" stroke="#555" stroke-width="1"/>`
    markup += `<path d="M ${b.x + 6} ${top} H ${b.x + b.width - 6}" stroke="${red}"/><path d="M ${b.x + 6} ${bottom} H ${b.x + b.width - 6}" stroke="${blue}"/>`
    for (let i = 0; i < data.circuits; i++) {
      const x = b.x + b.width * (i + 1) / (data.circuits + 1)
      markup += `<path d="M ${x - 2} ${top} V ${b.y + b.height}" stroke="${red}"/><path d="M ${x + 2} ${bottom} V ${b.y + b.height}" stroke="${blue}"/>`
    }
    markup += label(b.x, b.y - 10, `${data.name} · ${data.circuits} groepen`)
  } else {
    if (data.kind === 'zone') markup += `<rect class="heating-zone-boundary" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="#777" stroke-width="1" stroke-dasharray="6 5"/>`
    for (const [index, circuit] of layout.circuits.entries()) {
      const color = data.kind === 'pipe' && data.pipeRole === 'return' ? blue : red
      markup += `<path class="heating-circuit" data-circuit="${index + 1}" d="${circuit.path}" stroke="${color}"/>`
      if (data.kind === 'zone') {
        markup += `<circle cx="${circuit.start.x}" cy="${circuit.start.y}" r="3" fill="${red}" stroke="none"/><circle cx="${circuit.end.x}" cy="${circuit.end.y}" r="3" fill="${blue}" stroke="none"/>`
        markup += `<text x="${circuit.start.x + 8}" y="${circuit.start.y + 18}" fill="#111111" stroke="white" stroke-width="3" paint-order="stroke" font-family="Segoe UI, Arial, sans-serif" font-size="16">${index + 1}</text>`
      }
    }
    const details = data.kind === 'zone' ? `${data.name} · ${data.circuits} lus(sen) · h.o.h. ${data.spacingMm} mm · Ø${data.diameterMm} · ${layout.lengthM.toFixed(1)} m` : `${data.name} · Ø${data.diameterMm} · ${layout.lengthM.toFixed(1)} m`
    markup += label(b.x, b.y - 10, layout.warning ?? details)
  }
  return `<g class="shape heating-shape heating-${data.kind}" data-shape-id="${escape(shape.id)}" data-selected="${selected}" transform="${transform}" fill="none" stroke-width="${shape.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`
}
