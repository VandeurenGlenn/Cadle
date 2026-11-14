import type { Point, RectShape } from './model/types.js'
import { heatingPipeGeometry, type PipeGeometry } from './heating-geometry.js'
import { segmentDistance } from './heating-distance.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { heatingDesignLimits } from './heating-design.js'

type Solid = { x: number; y: number; width: number; height: number; aperture?: readonly [Point, Point] }

/** Query real tube envelopes at fractional curve samples. Rounding an R80 arc
 * onto a 20 mm grid can otherwise reject two 16 mm tubes spaced 20 mm apart. */
export const heatingPointClearance = (pipes: readonly RectShape[], diameterMm: number, scale: number,
  { joints = new Map<string, readonly Point[]>(), solids = [] as readonly Solid[], extraClearanceMm = new Map<string, number>(), geometryFor = heatingPipeGeometry } = {}) => {
  const bucket = drawingUnitsForMetres(.1, scale), aperture = drawingUnitsForMetres(diameterMm / 2000, scale)
  type Entry = { a: Point; b: Point; clearance: number; joints?: readonly Point[] }
  const columns = new Map<number, Map<number, Entry[]>>()
  for (const pipe of pipes) {
    const clearance = drawingUnitsForMetres((diameterMm + pipe.heating!.diameterMm) / 2000 + Math.max(0, extraClearanceMm.get(pipe.id) ?? 0) / 1000, scale)
    const endpoints = joints.get(pipe.id), geometry: PipeGeometry = geometryFor(pipe)
    for (const { a, b } of geometry.pieces) {
      const entry: Entry = { a, b, clearance, ...(endpoints ? { joints: endpoints } : {}) }
      for (let x = Math.floor((Math.min(a.x, b.x) - clearance) / bucket); x <= Math.floor((Math.max(a.x, b.x) + clearance) / bucket); x++) {
        let rows = columns.get(x)
        if (!rows) { rows = new Map(); columns.set(x, rows) }
        for (let y = Math.floor((Math.min(a.y, b.y) - clearance) / bucket); y <= Math.floor((Math.max(a.y, b.y) + clearance) / bucket); y++) {
          const entries = rows.get(y) ?? []; entries.push(entry); rows.set(y, entries)
        }
      }
    }
  }
  return (point: Point) => {
    for (const box of solids) if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height &&
      (!box.aperture || segmentDistance(point, box.aperture[0], box.aperture[1]) > aperture + 1e-7)) return false
    const entries = columns.get(Math.floor(point.x / bucket))?.get(Math.floor(point.y / bucket))
    for (const entry of entries ?? []) {
      if (entry.joints?.some((joint) => Math.hypot(point.x - joint.x, point.y - joint.y) <= entry.clearance + 1e-7)) continue
      if (segmentDistance(point, entry.a, entry.b) < entry.clearance - 1e-7) return false
    }
    return true
  }
}

/** A splice must leave both remaining ends accessible. The joined tube can be
 * collision-free while its new connector runs across its own future inlet. */
export const heatingEntryTangentConflict = (pipe: RectShape, others: readonly RectShape[] = []): Point | undefined => {
  const data = pipe.heating!, scale = data.drawingScale, points = heatingPipeGeometry(pipe).points
  if (points.length < 2) return points[0] ?? pipe.start
  const diameter = drawingUnitsForMetres(data.diameterMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(data.diameterMm, data.design).minBendRadiusMm / 1000, scale)
  const free = heatingPointClearance([pipe, ...others], data.diameterMm, scale,
    { joints: new Map([[pipe.id, [points[0], points.at(-1)!]]]) })
  for (const [head, next] of [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]]) {
    const length = Math.hypot(head.x - next.x, head.y - next.y)
    if (!length) return head
    const samples = [radius]
    for (let advance = diameter * 1.01; advance < radius; advance += diameter / 2) samples.push(advance)
    for (const advance of samples) {
      const p = { x: head.x + (head.x - next.x) / length * advance, y: head.y + (head.y - next.y) / length * advance }
      if (!free(p)) return p
    }
  }
}

/** Open a real turning window at a paired inlet. Field partitions leave one
 * laying pitch between coils; ending both arms exactly on that seam leaves
 * no room for a 16 mm pair to turn with R80. Retract only the straight tips,
 * retaining the first fillet and every laying run. The feeds fill this gap. */
export const retractHeatingFeedEntries = <T extends Point>(points: readonly T[], diameterMm: number, spacingMm: number,
  scale: number, minRadiusMm: number): T[] => {
  const result = points.map((p) => ({ ...p }))
  if (result.length < 4) return result
  const first = result[0], next = result[1], last = result.at(-1)!, previous = result.at(-2)!
  const a = Math.hypot(next.x - first.x, next.y - first.y), b = Math.hypot(previous.x - last.x, previous.y - last.y)
  if (!a || !b || ((next.x - first.x) * (previous.x - last.x) + (next.y - first.y) * (previous.y - last.y)) / (a * b) < .999 ||
    Math.hypot(last.x - first.x, last.y - first.y) > spacingMm * 16 / scale + 1e-6) return result
  const keep = drawingUnitsForMetres((minRadiusMm + diameterMm) / 1000, scale)
  const retreat = Math.min(drawingUnitsForMetres(Math.max(spacingMm / 2, minRadiusMm + diameterMm) / 1000, scale), a - keep, b - keep)
  if (retreat <= 1e-7) return result
  result[0] = { ...first, x: first.x + (next.x - first.x) / a * retreat, y: first.y + (next.y - first.y) / a * retreat }
  result[result.length - 1] = { ...last, x: last.x + (previous.x - last.x) / b * retreat, y: last.y + (previous.y - last.y) / b * retreat }
  return result
}
