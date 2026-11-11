import Clipper from 'clipper-lib'
import type { Point } from './model/types.js'
import type { HeatingDesignInputs } from './heating-design.js'
import { heatingDesignLimits } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { openHeatingTurns, rectangularHeatingField, heatingPairedEntries } from './heating-pattern-geometry.js'
import { joinHeatingZoneFields } from './heating-zone-join.js'

/** Closed floor boundaries, with opposite winding for holes. All coordinates
 * use drawing units; spacing, clearance and product limits always use mm. */
type Bounds = { x: number; y: number; width: number; height: number }
export type HeatingArea = { boundaries: Point[][]; entry: Point;
  clearance?: { boundaries: Point[][]; edge: number; bounds: Bounds } }
export type HeatingAreaSettings = { diameterMm: number; spacingMm: number; edgeMm?: number; design?: HeatingDesignInputs }
export type HeatingAreaLoop = { points: Point[]; pattern: 'spiral' | 'meander' | 'mixed'; lengthM: number; gapRatio: number }
export type HeatingAreaTrace = { rings?: number; fields?: number; candidates?: number; rejected?: Record<string, number>; point?: Point; message?: string }
const precision = 1000
const integerPaths = (paths: readonly Point[][]) => paths.map((path) => path.map(({ x, y }) => ({ X: Math.round(x * precision), Y: Math.round(y * precision) })))
const drawingPaths = (paths: { X: number; Y: number }[][]): Point[][] => paths.map((path) => path.map(({ X, Y }) => ({ x: X / precision, y: Y / precision })))
const signedArea = (points: readonly Point[]) => points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - b.x * a.y }, 0) / 2
const clockwise = (points: readonly Point[]) => signedArea(points) < 0 ? [...points].reverse() : [...points]
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const compact = (points: Point[]) => {
  const result: Point[] = []
  for (const p of points) {
    if (result.length && distance(p, result.at(-1)!) < 1e-7) continue
    while (result.length > 1) {
      const a = result.at(-2)!, b = result.at(-1)!
      if (Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) > 1e-7 ||
        (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) < 0) break
      result.pop()
    }
    result.push(p)
  }
  return result
}

export const heatingAreaBounds = (area: HeatingArea) => {
  const points = area.boundaries.flat(), xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
export const heatingAreaSurface = (area: HeatingArea) => Math.abs(area.boundaries.reduce((sum, path) => sum + signedArea(path), 0))
export const heatingAreaComponents = (area: HeatingArea): HeatingArea[] => area.boundaries.filter((ring) => signedArea(ring) > 0).map((outer) => ({
  entry: area.entry, boundaries: [outer, ...area.boundaries.filter((ring) => signedArea(ring) < 0 && contains({ boundaries: [outer], entry: area.entry }, ring[0]))]
}))
const booleanArea = (a: HeatingArea, b: Point[][], operation: number): HeatingArea => {
  const clip = new Clipper.Clipper(), result = []
  clip.AddPaths(integerPaths(a.boundaries), Clipper.PolyType.ptSubject, true)
  clip.AddPaths(integerPaths(b), Clipper.PolyType.ptClip, true)
  clip.Execute(operation, result, Clipper.PolyFillType.pftNonZero, Clipper.PolyFillType.pftNonZero)
  return { ...a, boundaries: drawingPaths(result) }
}
export const rectangularHeatingArea = (box: { x: number; y: number; width: number; height: number }, entry: Point = { x: box.x, y: box.y }): HeatingArea =>
  ({ entry, boundaries: [[{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }]] })
export const subtractHeatingAreas = (area: HeatingArea, obstacles: readonly { x: number; y: number; width: number; height: number }[]) =>
  obstacles.length ? booleanArea(area, obstacles.flatMap((box) => rectangularHeatingArea(box).boundaries), Clipper.ClipType.ctDifference) : area
export const intersectHeatingAreas = (a: HeatingArea, b: HeatingArea) => booleanArea(a, b.boundaries, Clipper.ClipType.ctIntersection)
export const unionHeatingAreas = (areas: readonly HeatingArea[], entry: Point): HeatingArea =>
  booleanArea({ boundaries: areas.flatMap((area) => area.boundaries), entry }, [], Clipper.ClipType.ctUnion)
export const insetHeatingArea = (area: HeatingArea, amount: number): HeatingArea => {
  const offset = new Clipper.ClipperOffset(2, .01 * precision), result = []
  offset.AddPaths(integerPaths(area.boundaries), Clipper.JoinType.jtMiter, Clipper.EndType.etClosedPolygon)
  offset.Execute(result, -amount * precision)
  return { ...area, boundaries: drawingPaths(result) }
}
/** Remove tiny drafting/threshold jogs by trimming free floor only. Expanding
 * into an obstacle is rejected by an exact polygon difference. The physical
 * clearance audit continues to use the original floor, not the trimmed shape. */
export const trimHeatingAreaJogs = (source: HeatingArea, feature: number): HeatingArea => {
  let area = source
  const original = heatingAreaSurface(source)
  for (let pass = 0; pass < 12; pass++) {
    let best: HeatingArea | undefined, leastLoss = Infinity
    for (const axis of ['x', 'y'] as const) {
      const values = [...new Set(area.boundaries.flat().map((p) => p[axis]))].sort((a, b) => a - b)
      for (let i = 1; i < values.length; i++) {
        const low = values[i - 1], high = values[i]
        if (high - low >= feature || high - low < 1e-5) continue
        for (const [from, to] of [[low, high], [high, low]]) {
          const changed = { ...area, boundaries: area.boundaries.map((path) => path.map((p) => ({ ...p, [axis]: Math.abs(p[axis] - from) < 1e-5 ? to : p[axis] }))) }
          const candidate = unionHeatingAreas([changed], area.entry), loss = original - heatingAreaSurface(candidate)
          if (loss < 1e-4 || loss > original * .02 || loss >= leastLoss || candidate.boundaries.length > area.boundaries.length) continue
          const added = booleanArea(candidate, area.boundaries, Clipper.ClipType.ctDifference)
          if (heatingAreaSurface(added) > 1e-5) continue
          best = candidate; leastLoss = loss
        }
      }
    }
    if (!best) break
    area = best
  }
  return area
}
const contains = (area: HeatingArea, point: Point) => {
  let inside = false
  for (const points of area.boundaries) for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Both callers get the same rounded geometry and the same rejection rules.
 * An unsuccessful area never turns into extra, unrequested circuits. */
const buildHeatingAreaLoop = (area: HeatingArea, settings: HeatingAreaSettings, scale: number,
  checkpoint: () => void = () => {}, trace?: HeatingAreaTrace): HeatingAreaLoop | null => {
  if (!area.boundaries.length) return null
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
  const edge = drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale)
  const outline = trimHeatingAreaJogs(area, radius * 2)
  const initial = insetHeatingArea(outline, edge), rings: Point[][] = []
  for (let depth = 0; depth < 250; depth++) {
    checkpoint()
    const inset = depth ? insetHeatingArea(outline, edge + depth * pitch) : initial
    if (inset.boundaries.length !== 1 || signedArea(inset.boundaries[0]) <= 0) break
    rings.push(clockwise(inset.boundaries[0]))
  }
  if (trace) trace.rings = rings.length
  if (!initial.boundaries.length) return null
  const physical = area.clearance ? { boundaries: area.clearance.boundaries, entry: area.entry } : area
  const boundary = physical.boundaries.flatMap((path) => path.map((a, i) => [a, path[(i + 1) % path.length]] as const))
  const physicalEdge = area.clearance?.edge ?? edge
  const inside = (p: Point) => {
    const b = area.clearance?.bounds
    return (!b || p.x >= b.x + edge - 1e-5 && p.y >= b.y + edge - 1e-5 && p.x <= b.x + b.width - edge + 1e-5 && p.y <= b.y + b.height - edge + 1e-5) &&
      contains(physical, p) && boundary.every(([a, b]) => segmentDistance(p, a, b) >= physicalEdge - 1e-5)
  }
  const box = heatingAreaBounds(area), samples: Point[] = []
  const sampleStep = Math.max(pitch / 2, Math.max(box.width, box.height) / 250)
  for (let y = box.y + sampleStep / 2; y < box.y + box.height; y += sampleStep) for (let x = box.x + sampleStep / 2; x < box.x + box.width; x += sampleStep) {
    const p = { x, y }
    if (inside(p)) samples.push(p)
  }
  const make = (points: Point[]) => {
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y), x = Math.min(...xs), y = Math.min(...ys)
    const w = Math.max(...xs) - x, h = Math.max(...ys) - y
    return { id: 'area-audit', kind: 'rect' as const, start: { x, y }, end: { x: x + w, y: y + h }, heating: {
      kind: 'pipe' as const, name: 'Area', ...settings, drawingScale: scale, edgeMm: settings.edgeMm ?? 100,
      direction: 'horizontal' as const, pipeRole: 'loop' as const, circuits: 1, circuitId: 'area', automatic: true,
      points: points.map((p) => ({ x: w ? (p.x - x) / w : 0, y: h ? (p.y - y) / h : 0 })) } }
  }
  let best: HeatingAreaLoop | null = null
  const reject = (reason: string, point?: Point) => {
    if (trace) { const counts = trace.rejected ??= {}; counts[reason] = (counts[reason] ?? 0) + 1; trace.point = point }
  }
  const evaluate = (raw: Point[], pattern: HeatingAreaLoop['pattern']) => {
    checkpoint()
    if (trace) trace.candidates = (trace.candidates ?? 0) + 1
    const points = openHeatingTurns(compact(raw), radius, diameter), pipe = make(points), geometry = heatingPipeGeometry(pipe)
    if (geometry.bends.some((bend) => bend.radiusMm < radius * scale / 8 - .1)) { reject('radius'); return }
    if (!heatingPairedEntries(points, settings.spacingMm, scale)) { reject('entry'); return }
    for (const piece of geometry.pieces) {
      const n = Math.max(1, Math.ceil(distance(piece.a, piece.b) / Math.max(diameter / 2, .1)))
      for (let i = 0; i <= n; i++) {
        const p = { x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n }
        if (!inside(p)) { reject('clearance', p); return }
      }
    }
    if (checkHeatingPlan([pipe], [], settings.design, [], { stopOnConflict: true, checkpoint }).errors) { reject('collision'); return }
    let gaps = 0
    for (const p of samples) if (geometry.pieces.every((piece) => segmentDistance(p, piece.a, piece.b) > pitch * .8)) gaps++
    const result = { points, pattern, lengthM: geometry.length * scale / 8000, gapRatio: gaps / Math.max(1, samples.length) }
    if (!best || result.gapRatio < best.gapRatio - .001 || Math.abs(result.gapRatio - best.gapRatio) <= .001 && distance(points[0], area.entry) < distance(best.points[0], area.entry)) best = result
  }
  // Rectangles retain the established, audited centre turn. Irregular areas
  // use complete inset outlines, rather than independent rectangle fragments.
  if (initial.boundaries.length === 1 && initial.boundaries[0].length === 4) {
    const b = heatingAreaBounds(initial), w = Math.floor(b.width / pitch + 1e-7) * pitch, h = Math.floor(b.height / pitch + 1e-7) * pitch
    const field = rectangularHeatingField(w, h, { ...settings, returnToEntrySide: true }, scale, checkpoint)
    if (field) for (const flipX of [false, true]) for (const flipY of [false, true]) evaluate(field.points.map((p) => ({ x: b.x + (b.width - w) / 2 + (flipX ? w - p.x : p.x), y: b.y + (b.height - h) / 2 + (flipY ? h - p.y : p.y) })), field.pattern)
    if (best?.gapRatio < .02) return best
  }
  const outer = rings[0] ?? []
  const seams = outer.map((corner, i) => ({ corner, previous: outer[(i + outer.length - 1) % outer.length], score: distance(corner, area.entry) }))
    .filter(({ corner, previous }) => distance(corner, previous) >= 2 * pitch).sort((a, b) => a.score - b.score)
  for (const seam of seams.slice(0, 8)) {
    const ux = seam.corner.x - seam.previous.x, uy = seam.corner.y - seam.previous.y, length = Math.hypot(ux, uy)
    const open = (ring: Point[]) => {
      const choices = ring.map((corner, index) => ({ corner, index, previous: ring[(index + ring.length - 1) % ring.length] }))
        .filter(({ corner, previous }) => Math.abs((corner.x - previous.x) * uy - (corner.y - previous.y) * ux) < 1e-6 &&
          (corner.x - previous.x) * ux + (corner.y - previous.y) * uy > 0 && distance(corner, previous) >= 2 * pitch)
        .sort((a, b) => distance(a.corner, seam.corner) - distance(b.corner, seam.corner))
      const selected = choices[0]
      if (!selected) return null
      return [...Array.from({ length: ring.length }, (_, n) => ring[(selected.index + n) % ring.length]),
        { x: selected.corner.x - ux / length * 2 * pitch, y: selected.corner.y - uy / length * 2 * pitch }]
    }
    const paths = rings.map(open)
    for (let count = paths.findIndex((path) => !path) < 0 ? paths.length : paths.findIndex((path) => !path); count >= 2; count--) {
      const supply = paths.slice(0, count).filter((_, i) => !(i % 2)).flat(), inwardReturn = paths.slice(0, count).filter((_, i) => i % 2).flat()
      const advance = (path: Point[], amount: number) => {
        const end = path.at(-1)!, previous = path.at(-2)!, length = distance(end, previous)
        return [...path.slice(0, -1), { x: end.x + (end.x - previous.x) / length * amount, y: end.y + (end.y - previous.y) / length * amount }]
      }
      for (const amount of [0, pitch / 2, pitch, pitch * 1.5]) {
        const x = advance(supply, amount), y = advance(inwardReturn, amount), a = x.at(-1)!, b = y.at(-1)!
        for (const corner of [{ x: a.x, y: b.y }, { x: b.x, y: a.y }]) evaluate([...x, corner, ...[...y].reverse()], 'spiral')
      }
      if (best?.gapRatio < .02) break
    }
    if (best?.gapRatio < .02) break
  }
  if ((!best || best.gapRatio > .02) && initial.boundaries.length === 1) {
    // A U-shaped area can lose its connecting neck during inward offsets.
    // A bounded monotone sweep plus one outer return keeps it a single tube.
    for (const transpose of [false, true]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const transform = (p: Point) => ({ x: (transpose ? p.y : p.x) * (flipX ? -1 : 1), y: (transpose ? p.x : p.y) * (flipY ? -1 : 1) })
      const inverse = (p: Point) => { const x = p.x * (flipX ? -1 : 1), y = p.y * (flipY ? -1 : 1); return transpose ? { x: y, y: x } : { x, y } }
      const ring = initial.boundaries[0].map(transform), a = { boundaries: [ring], entry: transform(area.entry) }, b = heatingAreaBounds(a)
      const interval = (x: number) => {
        const ys: number[] = []
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length]
          if ((p.x > x) !== (q.x > x)) ys.push(p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x))
        }
        ys.sort((a, b) => a - b)
        return ys.length === 2 ? { top: ys[0], bottom: ys[1] } : null
      }
      const first = b.x + pitch, columns = Math.floor((b.width - pitch - 2 * radius) / pitch) + 1
      const count = columns % 2 ? columns - 1 : columns
      if (count < 2 || count > 500) continue
      const xs = Array.from({ length: count }, (_, i) => first + i * pitch), ranges = xs.map(interval)
      if (ranges.some((value) => !value)) continue
      const envelope = (left: number, right: number) => {
        const probes = [left, right, ...ring.flatMap((p) => p.x > left && p.x < right ? [p.x - 1e-5, p.x + 1e-5] : [])].map(interval)
        return probes.some((p) => !p) ? null : { top: Math.max(...probes.map((p) => p!.top)), bottom: Math.min(...probes.map((p) => p!.bottom)) }
      }
      const path: Point[] = [{ x: xs[0], y: ranges[0]!.bottom }]
      let usable = true
      for (let i = 0; i < count; i++) {
        if (i === count - 1) { path.push({ x: xs[i], y: ranges[i]!.bottom }); break }
        const pair = envelope(xs[i], xs[i + 1])
        if (!pair || pair.bottom - pair.top < pitch * 2 + radius * 2) { usable = false; break }
        const y = i % 2 ? pair.bottom - pitch : pair.top + pitch
        path.push({ x: xs[i], y }, { x: xs[i + 1], y })
      }
      if (!usable) continue
      const end = path.at(-1)!, left = interval(b.x + 1e-5)
      if (!left) continue
      const target = { x: b.x, y: left.bottom }, cut: Point[] = []
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length]
        cut.push(p)
        for (const point of [end, target].filter((point) => segmentDistance(point, p, q) < 1e-5 && distance(point, p) > 1e-5 && distance(point, q) > 1e-5)
          .sort((a, b) => distance(a, p) - distance(b, p))) cut.push(point)
      }
      const startIndex = cut.findIndex((p) => distance(p, end) < 1e-5), endIndex = cut.findIndex((p) => distance(p, target) < 1e-5)
      if (startIndex < 0 || endIndex < 0) continue
      const alternatives = [1, -1].map((direction) => {
        const points = [end]
        for (let i = (startIndex + direction + cut.length) % cut.length; i !== endIndex; i = (i + direction + cut.length) % cut.length) points.push(cut[i])
        points.push(target)
        return { points, length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) }
      }).sort((a, b) => b.length - a.length)
      evaluate([...path, ...alternatives[0].points.slice(1)].map(inverse), 'mixed')
    }
  }
  if (!best || best.gapRatio > .05) {
    // A neck can split inset contours into pockets. Fill those pockets locally,
    // then splice them into the same tube; they never become extra circuits.
    const rows = [...new Set(initial.boundaries.flat().map((p) => p.y))].sort((a, b) => a - b)
    const rectangles: Bounds[] = []
    for (let y = 1; y < rows.length; y++) {
      const middle = (rows[y - 1] + rows[y]) / 2, xs: number[] = []
      for (const ring of initial.boundaries) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        if ((a.y > middle) !== (b.y > middle)) xs.push(a.x + (b.x - a.x) * (middle - a.y) / (b.y - a.y))
      }
      xs.sort((a, b) => a - b)
      for (let x = 1; x < xs.length; x += 2) {
        const previous = rectangles.find((r) => Math.abs(r.x - xs[x - 1]) < 1e-6 && Math.abs(r.width - xs[x] + xs[x - 1]) < 1e-6 && Math.abs(r.y + r.height - rows[y - 1]) < 1e-6)
        if (previous) previous.height += rows[y] - rows[y - 1]
        else rectangles.push({ x: xs[x - 1], y: rows[y - 1], width: xs[x] - xs[x - 1], height: rows[y] - rows[y - 1] })
      }
    }
    const fields: Point[][][] = [], patterns = new WeakMap<Point[], HeatingAreaLoop['pattern']>()
    for (const r of rectangles) {
      const w = Math.floor((r.width - pitch) / pitch) * pitch, h = Math.floor((r.height - pitch) / pitch) * pitch
      if (w <= 0 || h <= 0) continue
      const variants: Point[][] = []
      for (const axis of ['x', 'y'] as const) {
        const field = rectangularHeatingField(w, h, { ...settings, returnToEntrySide: true }, scale, checkpoint, axis)
        if (!field) continue
        for (const flipX of [false, true]) for (const flipY of [false, true]) {
          const points = field.points.map((p) => ({ x: r.x + (r.width - w) / 2 + (flipX ? w - p.x : p.x), y: r.y + (r.height - h) / 2 + (flipY ? h - p.y : p.y) }))
          patterns.set(points, field.pattern); variants.push(points)
        }
      }
      if (variants.length) fields.push(variants)
    }
    if (trace) trace.fields = fields.length
    if (fields.length > 1 && fields.length <= 12) {
      const valid = (raw: Point[], remaining: readonly Point[][]) => {
        const pipes = [raw, ...remaining].map((points, i) => {
          const pipe = make(openHeatingTurns(compact(points), radius, diameter))
          pipe.id = `area-join-${i}`; pipe.heating.circuitId = pipe.id
          return pipe
        })
        const geometry = heatingPipeGeometry(pipes[0])
        for (const piece of geometry.pieces) for (const fraction of [0, .25, .5, .75, 1]) {
          if (!inside({ x: piece.a.x + (piece.b.x - piece.a.x) * fraction, y: piece.a.y + (piece.b.y - piece.a.y) * fraction })) { reject('join-clearance'); return false }
        }
        const audit = checkHeatingPlan(pipes, [], settings.design, [], { stopOnConflict: true, checkpoint })
        if (audit.errors) { reject(`join-${audit.issues[0]?.code}`, audit.issues[0]?.point); if (trace) trace.message = audit.issues[0]?.message }
        return !audit.errors
      }
      const joined = joinHeatingZoneFields(fields, heatingAreaBounds(initial), [], pitch, radius, valid, (points) => patterns.get(points) ?? 'spiral', { timeMs: 750, auditLimit: 256, checkpoint })
      if (joined) evaluate(joined.points, joined.pattern)
    }
  }
  return best
}

const areaLoopCache = new Map<string, { loop: HeatingAreaLoop | null; trace: HeatingAreaTrace }>()
/** Translation-independent, bounded cache for pointer moves, inspectors and
 * exports. Cached arrays are copied so an automatic route cannot alter a preview. */
export const generateHeatingAreaLoop = (area: HeatingArea, settings: HeatingAreaSettings, scale: number,
  checkpoint: () => void = () => {}, trace?: HeatingAreaTrace): HeatingAreaLoop | null => {
  checkpoint()
  if (!area.boundaries.length) return null
  const origin = heatingAreaBounds(area), shift = (p: Point) => ({ x: p.x - origin.x, y: p.y - origin.y })
  const normalized: HeatingArea = { boundaries: area.boundaries.map((ring) => ring.map(shift)), entry: shift(area.entry),
    ...(area.clearance ? { clearance: { boundaries: area.clearance.boundaries.map((ring) => ring.map(shift)), edge: area.clearance.edge,
      bounds: { ...area.clearance.bounds, x: area.clearance.bounds.x - origin.x, y: area.clearance.bounds.y - origin.y } } } : {}) }
  const key = JSON.stringify([normalized, settings.diameterMm, settings.spacingMm, settings.edgeMm ?? 100, settings.design, scale])
  let cached = areaLoopCache.get(key)
  if (!cached) {
    const details: HeatingAreaTrace = {}, loop = buildHeatingAreaLoop(normalized, settings, scale, checkpoint, details)
    cached = { loop, trace: details }; areaLoopCache.set(key, cached)
    if (areaLoopCache.size > 128) areaLoopCache.delete(areaLoopCache.keys().next().value!)
  }
  if (trace) Object.assign(trace, cached.trace, { ...(cached.trace.point ? { point: { x: cached.trace.point.x + origin.x, y: cached.trace.point.y + origin.y } } : {}) })
  return cached.loop ? { ...cached.loop, points: cached.loop.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })) } : null
}

type AreaPartition = { areas: HeatingArea[]; score: number }
/** Allocate connected areas before drawing tubes. Structural vertices are
 * candidate cuts too: a cabinet recess is not forced into an equal-width strip. */
export const partitionHeatingArea = (source: HeatingArea, count: number, settings: HeatingAreaSettings, scale: number,
  options: { checkpoint?: () => void; leadM?: (point: Point) => number; axis?: 'x' | 'y'; onRejectedArea?: (area: HeatingArea, trace?: HeatingAreaTrace) => void } = {}) => {
  const checkpoint = options.checkpoint ?? (() => {}), pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const padding = Math.max(0, drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale) - pitch / 2)
  const area = insetHeatingArea(source, padding), localSettings = { ...settings, edgeMm: settings.spacingMm / 2 }
  const physicalEdge = drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale)
  area.clearance = { boundaries: source.boundaries, edge: physicalEdge, bounds: heatingAreaBounds(area) }
  const memo = new Map<string, AreaPartition[]>(), loopMemo = new Map<string, HeatingAreaLoop | null>(), rejected = new Set<string>(), traces = new Map<string, HeatingAreaTrace>()
  const cost = (a: HeatingArea, groups: number) => {
    const b = heatingAreaBounds(a), surface = heatingAreaSurface(a), length = surface * (scale / 8000) ** 2 / (settings.spacingMm / 1000)
    const lead = options.leadM?.({ x: b.x + b.width / 2, y: b.y + b.height / 2 }) ?? 0
    return length / groups + 2 * lead
  }
  let expanded = 0
  const plan = (a: HeatingArea, groups: number, depth = 0): AreaPartition[] => {
    checkpoint()
    const key = JSON.stringify([a.boundaries, groups]), cached = memo.get(key)
    if (cached) return cached
    if (groups === 1) {
      if (rejected.has(JSON.stringify(a.boundaries))) return []
      const laying = insetHeatingArea(a, pitch / 2)
      return laying.boundaries.length === 1 ? [{ areas: [a], score: cost(a, 1) }] : []
    }
    if (++expanded > 1000 || depth > 6) return []
    const box = heatingAreaBounds(a), areaM2 = heatingAreaSurface(a), candidates: { a: HeatingArea; b: HeatingArea; left: number; score: number }[] = []
    for (const axis of options.axis ? [options.axis] : ['x', 'y'] as const) {
      const start = axis === 'x' ? box.x : box.y, span = axis === 'x' ? box.width : box.height
      const values = new Set(a.boundaries.flatMap((path) => path.flatMap((p) => [-4, -2, 0, 2, 4].map((n) => p[axis] + n * pitch))))
      for (let group = 1; group < groups; group++) for (const shift of [-.06, 0, .06]) values.add(start + span * (group / groups + shift))
      for (const value of values) {
        if (value < start + 3 * pitch || value > start + span - 3 * pitch) continue
        const first = intersectHeatingAreas(a, rectangularHeatingArea({ ...box, ...(axis === 'x' ? { width: value - box.x } : { height: value - box.y }) }))
        const second = intersectHeatingAreas(a, rectangularHeatingArea({ ...box, ...(axis === 'x' ? { x: value, width: box.x + box.width - value } : { y: value, height: box.y + box.height - value }) }))
        first.clearance = { boundaries: source.boundaries, edge: physicalEdge, bounds: heatingAreaBounds(first) }
        second.clearance = { boundaries: source.boundaries, edge: physicalEdge, bounds: heatingAreaBounds(second) }
        if (first.boundaries.filter((p) => signedArea(p) > 0).length !== 1 || second.boundaries.filter((p) => signedArea(p) > 0).length !== 1) continue
        const ratio = heatingAreaSurface(first) / areaM2
        for (const left of new Set([Math.round(ratio * groups), Math.floor(ratio * groups), Math.ceil(ratio * groups)])) {
          if (left < 1 || left >= groups) continue
          const ca = cost(first, left), cb = cost(second, groups - left)
          candidates.push({ a: first, b: second, left, score: Math.max(ca, cb) + Math.abs(ca - cb) * .1 })
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score)
    const result: AreaPartition[] = []
    for (const choice of candidates.slice(0, depth ? 8 : 16)) {
      const left = plan(choice.a, choice.left, depth + 1), right = plan(choice.b, groups - choice.left, depth + 1)
      for (const a of left.slice(0, 2)) for (const b of right.slice(0, 2)) result.push({ areas: [...a.areas, ...b.areas], score: Math.max(a.score, b.score) + (a.score + b.score) * .001 })
    }
    result.sort((a, b) => a.score - b.score)
    memo.set(key, result.slice(0, 8)); return result.slice(0, 8)
  }
  if (!Number.isInteger(count) || count < 1 || count > 24 || !area.boundaries.length) return null
  let best: { loops: HeatingAreaLoop[]; areas: HeatingArea[]; maxM: number; gapRatio: number } | null = null
  for (let round = 0; round < 4; round++) {
    const previousRejected = rejected.size, plans = plan(area, count)
    for (const proposal of plans.slice(0, 8)) {
    const loops: HeatingAreaLoop[] = []
    for (const a of proposal.areas) {
      const key = JSON.stringify(a.boundaries)
      if (!loopMemo.has(key)) { const trace = {}; traces.set(key, trace); loopMemo.set(key, generateHeatingAreaLoop(a, localSettings, scale, checkpoint, trace)) }
      const loop = loopMemo.get(key)
      if (!loop) { rejected.add(key); options.onRejectedArea?.(a, traces.get(key)); break }
      loops.push(loop)
    }
    if (loops.length !== count) continue
    const maxM = Math.max(...loops.map((loop) => loop.lengthM + (options.leadM?.(loop.points[0]) ?? 0) + (options.leadM?.(loop.points.at(-1)!) ?? 0)))
    const gapRatio = Math.max(...loops.map((loop) => loop.gapRatio)), candidate = { loops, areas: proposal.areas, maxM, gapRatio }
    if (!best || gapRatio < best.gapRatio - .01 || Math.abs(gapRatio - best.gapRatio) <= .01 && maxM < best.maxM) best = candidate
    if (gapRatio <= .02 && maxM + heatingDesignLimits(settings.diameterMm, settings.design).allowanceM <= heatingDesignLimits(settings.diameterMm, settings.design).maxCircuitLengthM) return best
    }
    if (rejected.size === previousRejected) break
    memo.clear(); expanded = 0
  }
  return best
}
