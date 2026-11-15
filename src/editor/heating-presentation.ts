import type { Point, RectShape } from './model/types.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { segmentDistance } from './heating-distance.js'

type Box = { x: number; y: number; width: number; height: number }
export type HeatingCircuitLabel = Point & { text: string; fontSize: number; width: number; height: number }

/** A circuit keeps one colour from the source through its complete loop. */
export const heatingCircuitColor = (id: string | undefined, monochrome = false): string => {
  if (monochrome) return '#000000'
  const number = id?.match(/(\d+)$/)?.[1]
  const index = number ? Number(number) : [...id ?? '1'].reduce((sum, c) => sum + c.charCodeAt(0), 0)
  return index % 2 ? '#b42318' : '#175cd3'
}

const labels = new Map<string, HeatingCircuitLabel | null>()
const compactId = (id: string) => {
  const number = id.match(/(\d{1,8})$/)?.[1]
  return number ? String(Number(number)) : id
}
const intersects = (a: Box, b: Box) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y

/** Pick a real empty body pocket, rather than the bounding-box corner or an
 * architectural void between two connected fields. Dense fields may have no
 * readable slot: their ID remains available in the title and circuit table. */
export const heatingCircuitLabelPosition = (shape: RectShape, obstacles: readonly Box[] = []): HeatingCircuitLabel | undefined => {
  const data = shape.heating
  if (!data || data.kind !== 'pipe' || !data.automatic || data.pipeRole !== 'loop' || !data.points?.length) return
  const bounds = { x: Math.min(shape.start.x, shape.end.x), y: Math.min(shape.start.y, shape.end.y),
    width: Math.abs(shape.end.x - shape.start.x), height: Math.abs(shape.end.y - shape.start.y) }
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
  const inverse = (p: Point): Point => {
    const angle = -(shape.rotation ?? 0) * Math.PI / 180, dx = p.x - cx, dy = p.y - cy
    return { x: cx + (dx * Math.cos(angle) - dy * Math.sin(angle)) * (shape.flipX ? -1 : 1),
      y: cy + (dx * Math.sin(angle) + dy * Math.cos(angle)) * (shape.flipY ? -1 : 1) }
  }
  const blocked = obstacles.map((box) => {
    if (!(shape.rotation || shape.flipX || shape.flipY)) return box
    const points = [inverse(box), inverse({ x: box.x + box.width, y: box.y }), inverse({ x: box.x, y: box.y + box.height }),
      inverse({ x: box.x + box.width, y: box.y + box.height })]
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }).filter((box) => intersects(box, bounds))
  const text = compactId(data.circuitId ?? data.name)
  const key = JSON.stringify([bounds, data.points, data.circuitId, data.name, data.spacingMm, data.drawingScale, data.design, data.bendRadiusMm,
    shape.rotation, shape.flipX, shape.flipY, shape.strokeWidth, blocked])
  if (labels.has(key)) return labels.get(key) ?? undefined
  const geometry = heatingPipeGeometry({ ...shape, rotation: 0, flipX: false, flipY: false })
  const pieces = geometry.pieces, pitch = drawingUnitsForMetres(data.spacingMm / 1000, data.drawingScale)
  const stroke = (shape.strokeWidth ?? 2) / 2
  const candidates: Point[] = [{ x: cx, y: cy }]
  const runs = pieces.filter(({ a, b }) => Math.hypot(a.x - b.x, a.y - b.y) >= pitch * 2 &&
    (Math.abs(a.x - b.x) < 1e-7 || Math.abs(a.y - b.y) < 1e-7))
  // Midpoints between nearby parallel laying runs find off-centre and concave
  // field cores too. The subsequent curve/fixture checks decide actual safety.
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i], b = runs[j], vertical = Math.abs(a.a.x - a.b.x) < 1e-7
    if (vertical !== (Math.abs(b.a.x - b.b.x) < 1e-7)) continue
    const gap = vertical ? Math.abs(a.a.x - b.a.x) : Math.abs(a.a.y - b.a.y)
    if (gap < 8 || gap > pitch * 4) continue
    const low = Math.max(Math.min(vertical ? a.a.y : a.a.x, vertical ? a.b.y : a.b.x), Math.min(vertical ? b.a.y : b.a.x, vertical ? b.b.y : b.b.x))
    const high = Math.min(Math.max(vertical ? a.a.y : a.a.x, vertical ? a.b.y : a.b.x), Math.max(vertical ? b.a.y : b.a.x, vertical ? b.b.y : b.b.x))
    if (high - low < 10) continue
    for (const ratio of [.5, .35, .65]) candidates.push(vertical
      ? { x: (a.a.x + b.a.x) / 2, y: low + (high - low) * ratio }
      : { x: low + (high - low) * ratio, y: (a.a.y + b.a.y) / 2 })
  }
  const unique = new Map<string, Point>()
  for (const p of candidates) unique.set(`${p.x.toFixed(2)},${p.y.toFixed(2)}`, p)
  const bucket = Math.max(pitch * 4, 1), nearby = new Map<string, typeof pieces>()
  for (const piece of pieces) {
    for (let y = Math.floor((Math.min(piece.a.y, piece.b.y) - pitch * 2) / bucket); y <= Math.floor((Math.max(piece.a.y, piece.b.y) + pitch * 2) / bucket); y++)
      for (let x = Math.floor((Math.min(piece.a.x, piece.b.x) - pitch * 2) / bucket); x <= Math.floor((Math.max(piece.a.x, piece.b.x) + pitch * 2) / bucket); x++) {
        const key = `${x},${y}`, list = nearby.get(key) ?? []; list.push(piece); nearby.set(key, list)
      }
  }
  // Rank real empty pockets before closeness to the overall bounding centre.
  // A long approach stem can otherwise crowd all candidates out of the body.
  const ordered = [...unique.values()].filter((p) => !blocked.some((box) => intersects(
    { x: p.x - 5, y: p.y - 5, width: 10, height: 10 }, box))).map((point) => ({ point,
      clearance: Math.min(...(nearby.get(`${Math.floor(point.x / bucket)},${Math.floor(point.y / bucket)}`) ?? [])
        .map(({ a, b }) => segmentDistance(point, a, b))) }))
    .filter(({ clearance }) => clearance <= pitch * 2)
    .sort((a, b) => b.clearance - a.clearance || Math.hypot(a.point.x - cx, a.point.y - cy) - Math.hypot(b.point.x - cx, b.point.y - cy)).slice(0, 192)
  const surrounded = (p: Point) => {
    let left = false, right = false, top = false, bottom = false
    for (const { a, b } of pieces) {
      if ((a.y <= p.y && b.y >= p.y || b.y <= p.y && a.y >= p.y) && Math.abs(b.y - a.y) > 1e-7) {
        const x = a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y)
        left ||= x < p.x; right ||= x > p.x
      }
      if ((a.x <= p.x && b.x >= p.x || b.x <= p.x && a.x >= p.x) && Math.abs(b.x - a.x) > 1e-7) {
        const y = a.y + (b.y - a.y) * (p.x - a.x) / (b.x - a.x)
        top ||= y < p.y; bottom ||= y > p.y
      }
      if (left && right && top && bottom) return true
    }
    return false
  }
  let chosen: HeatingCircuitLabel | undefined
  for (const fontSize of [12, 10]) {
    const width = Math.max(fontSize * .62, text.length * fontSize * .62) + 2.4, height = fontSize + 2.4
    for (const { point: p } of ordered) {
      const box = { x: p.x - width / 2, y: p.y - height / 2, width, height }
      if (box.x < bounds.x || box.y < bounds.y || box.x + width > bounds.x + bounds.width || box.y + height > bounds.y + bounds.height ||
        blocked.some((other) => intersects(box, other))) continue
      if (pieces.some(({ a, b }) => intersects(box, { x: Math.min(a.x, b.x) - stroke, y: Math.min(a.y, b.y) - stroke,
        width: Math.abs(a.x - b.x) + stroke * 2, height: Math.abs(a.y - b.y) + stroke * 2 }))) continue
      if (surrounded(p)) { chosen = { ...p, text, fontSize, width, height }; break }
    }
    if (chosen) break
  }
  labels.set(key, chosen ?? null)
  if (labels.size > 96) labels.delete(labels.keys().next().value!)
  return chosen
}
