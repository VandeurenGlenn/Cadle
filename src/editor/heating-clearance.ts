import type { Point, RectShape } from './model/types.js'
import { heatingPipeGeometry, type PipeGeometry } from './heating-geometry.js'
import { segmentDistance } from './heating-distance.js'
import { drawingUnitsForMetres, type DrawingScale } from './layout/drawing-scale.js'

type Solid = { x: number; y: number; width: number; height: number; aperture?: readonly [Point, Point] }

/** Query real tube envelopes at fractional curve samples. Rounding an R80 arc
 * onto a 20 mm grid can otherwise reject two 16 mm tubes spaced 20 mm apart. */
export const heatingPointClearance = (pipes: readonly RectShape[], diameterMm: number, scale: DrawingScale,
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
