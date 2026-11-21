import Clipper from 'clipper-lib'
import type { Point } from './model/types.js'
import type { HeatingDesignInputs } from './heating-design.js'
import { heatingDesignLimits } from './heating-design.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { checkHeatingPlan } from './heating-checks.js'
import { drawingUnitsForMetres } from './layout/drawing-scale.js'
import { openHeatingTurns, rectangularHeatingField, heatingPairedEntries, clearHeatingConcaveTurns } from './heating-pattern-geometry.js'
import { heatingCoverageRadius } from './heating-coverage.js'
import { joinHeatingZoneFields } from './heating-zone-join.js'

/** Closed floor boundaries, with opposite winding for holes. All coordinates
 * use drawing units; spacing, clearance and product limits always use mm. */
type Bounds = { x: number; y: number; width: number; height: number }
export type HeatingArea = { boundaries: Point[][]; entry: Point;
  clearance?: { boundaries: Point[][]; edge: number; bounds: Bounds; layingBoundaries?: Point[][]; entryBoundaries?: Point[][]; coverageStep?: number } }
export type HeatingAreaSettings = { entryVariant?: number; diameterMm: number; spacingMm: number; edgeMm?: number; design?: HeatingDesignInputs }
export type HeatingAreaLoop = { points: Point[]; pattern: 'spiral' | 'meander' | 'mixed'; lengthM: number; gapRatio: number }
export type HeatingAreaTrace = { rings?: number; fields?: number; candidates?: number; rejected?: Record<string, number>; point?: Point; message?: string }
const precision = 1000
const integerPaths = (paths: readonly Point[][]) => paths.map((path) => path.map(({ x, y }) => ({ X: Math.round(x * precision), Y: Math.round(y * precision) })))
const drawingPaths = (paths: { X: number; Y: number }[][]): Point[][] => paths.map((path) => path.map(({ X, Y }) => ({ x: X / precision, y: Y / precision })))
const signedArea = (points: readonly Point[]) => points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - b.x * a.y }, 0) / 2
const layingContours = (area: HeatingArea, pitch: number, radius: number): HeatingArea => {
  if (area.boundaries.filter((ring) => signedArea(ring) > 0).length < 2) return area
  const components = heatingAreaComponents(area).filter((component) => {
    const box = heatingAreaBounds(component)
    return heatingAreaSurface(component) >= pitch * pitch * 8 || Math.min(box.width, box.height) >= radius * 2
  })
  return { ...area, boundaries: components.flatMap((component) => component.boundaries) }
}
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
const segmentIndex = (segments: readonly { a: Point; b: Point }[], reach: number, bucket: number) => {
  const cells = new Map<string, { a: Point; b: Point }[]>()
  for (const segment of segments) {
    const { a, b } = segment
    for (let y = Math.floor((Math.min(a.y, b.y) - reach) / bucket); y <= Math.floor((Math.max(a.y, b.y) + reach) / bucket); y++) {
      for (let x = Math.floor((Math.min(a.x, b.x) - reach) / bucket); x <= Math.floor((Math.max(a.x, b.x) + reach) / bucket); x++) {
        const key = `${x}:${y}`, list = cells.get(key) ?? []
        list.push(segment); cells.set(key, list)
      }
    }
  }
  return (p: Point, distance: number, inclusive = false) => (cells.get(`${Math.floor(p.x / bucket)}:${Math.floor(p.y / bucket)}`) ?? []).some(({ a, b }) => {
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
    const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0
    const x = p.x - a.x - t * dx, y = p.y - a.y - t * dy, squared = x * x + y * y
    return inclusive ? squared <= distance * distance : squared < distance * distance
  })
}

/** Both callers get the same rounded geometry and the same rejection rules.
 * An unsuccessful area never turns into extra, unrequested circuits. */
const buildHeatingAreaLoopVariants = (area: HeatingArea, settings: HeatingAreaSettings, scale: number,
  checkpoint: () => void = () => {}, trace?: HeatingAreaTrace): HeatingAreaLoop[] => {
  if (!area.boundaries.length) return []
  const pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const diameter = drawingUnitsForMetres(settings.diameterMm / 1000, scale)
  const edge = drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale)
  const outline = trimHeatingAreaJogs(area, radius * 2)
  const initial = layingContours(insetHeatingArea(outline, edge), pitch, radius), rings: Point[][] = []
  for (let depth = 0; depth < 250; depth++) {
    checkpoint()
    const inset = depth ? layingContours(insetHeatingArea(outline, edge + depth * pitch), pitch, radius) : initial
    if (inset.boundaries.length !== 1 || signedArea(inset.boundaries[0]) <= 0) break
    rings.push(clockwise(inset.boundaries[0]))
  }
  if (trace) trace.rings = rings.length
  if (!initial.boundaries.length) return []
  const physical = area.clearance ? { boundaries: area.clearance.boundaries, entry: area.entry } : area
  const boundary = physical.boundaries.flatMap((path) => path.map((a, i) => [a, path[(i + 1) % path.length]] as const))
  const physicalEdge = area.clearance?.edge ?? edge
  const entryPhysical = area.clearance?.entryBoundaries ? { boundaries: area.clearance.entryBoundaries, entry: area.entry } : physical
  const nearBoundary = segmentIndex(boundary.map(([a, b]) => ({ a, b })), physicalEdge, Math.max(pitch, physicalEdge))
  const laying = area.clearance?.layingBoundaries
  const layingEdges = laying?.flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })))
  const onLayingBoundary = layingEdges ? segmentIndex(layingEdges, 1e-5, pitch) : undefined
  const inLaying = (p: Point) => !laying || contains({ boundaries: laying, entry: area.entry }, p) || onLayingBoundary!(p, 1e-5, true)
  const inside = (p: Point) => {
    const b = area.clearance?.bounds
    return (!b || p.x >= b.x + edge - 1e-5 && p.y >= b.y + edge - 1e-5 && p.x <= b.x + b.width - edge + 1e-5 && p.y <= b.y + b.height - edge + 1e-5) &&
      inLaying(p) && contains(physical, p) && !nearBoundary(p, Math.max(0, physicalEdge - 1e-5))
  }
  const box = heatingAreaBounds(area), samples: Point[] = []
  const coverageStep = area.clearance?.coverageStep ?? pitch / 5
  const coverageRadius = heatingCoverageRadius(settings.spacingMm, scale, coverageStep)
  const sampleStep = Math.max(area.clearance?.coverageStep ?? pitch / 2, Math.max(box.width, box.height) / 250)
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
  const entries = new Map<string, HeatingAreaLoop>()
  const entryDistance = (points: readonly Point[]) => [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]].reduce((sum, [head, next]) => {
    const length = distance(head, next)
    return sum + distance({ x: head.x + (head.x - next.x) / length * radius, y: head.y + (head.y - next.y) / length * radius }, area.entry)
  }, 0)
  const reject = (reason: string, point?: Point) => {
    if (trace) { const counts = trace.rejected ??= {}; counts[reason] = (counts[reason] ?? 0) + 1; trace.point = point }
  }
  const inletClear = (points: readonly Point[], pieces: ReturnType<typeof heatingPipeGeometry>['pieces'], report = true) => {
    const nearTube = segmentIndex(pieces, diameter, pitch)
    for (const [head, next] of [[points[0], points[1]], [points.at(-1)!, points.at(-2)!]]) {
      const length = distance(head, next), dx = (head.x - next.x) / length, dy = (head.y - next.y) / length
      // The launch centre-line needs one full bend tangent. Tube-envelope
      // clearance is checked separately below; adding a second full diameter
      // here rejected an R80 launch at the requested 100 mm wall offset.
      const advances = [radius]
      for (let advance = diameter * 1.01; advance < radius; advance += diameter / 2) advances.push(advance)
      for (const advance of advances) {
        const p = { x: head.x + dx * advance, y: head.y + dy * advance }
        if (!contains(entryPhysical, p) || nearBoundary(p, diameter / 2) || nearTube(p, diameter - 1e-5)) {
          if (report) reject('entry-tangent', p)
          return false
        }
      }
    }
    return true
  }
  const physicalEntryKey = (points: readonly Point[]) => {
    const entrySignature = (head: Point, next: Point) => {
      const length = distance(head, next)
      return [head.x, head.y, (head.x - next.x) / length, (head.y - next.y) / length].map((value) => Math.round(value * 1e6) / 1e6)
    }
    // Swapping supply and return does not open a different physical inlet.
    return JSON.stringify([entrySignature(points[0], points[1]), entrySignature(points.at(-1)!, points.at(-2)!) ]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  }
  const evaluate = (raw: Point[], pattern: HeatingAreaLoop['pattern'], repaired = false) => {
    checkpoint()
    if (trace) trace.candidates = (trace.candidates ?? 0) + 1
    const points = openHeatingTurns(compact(raw), radius, diameter), pipe = make(points), geometry = heatingPipeGeometry(pipe)
    const repair = () => {
      if (repaired) return
      const alternative = clearHeatingConcaveTurns(points, radius, inside)
      if (alternative) evaluate(alternative, pattern, true)
    }
    if (geometry.bends.some((bend) => bend.radiusMm < radius * scale / 8 - .1)) { reject('radius'); return }
    if (!heatingPairedEntries(points, settings.spacingMm, scale)) { reject('entry'); return }
    for (const piece of geometry.pieces) {
      const n = Math.max(1, Math.ceil(distance(piece.a, piece.b) / Math.max(diameter / 2, .1)))
      for (let i = 0; i <= n; i++) {
        const p = { x: piece.a.x + (piece.b.x - piece.a.x) * i / n, y: piece.a.y + (piece.b.y - piece.a.y) * i / n }
        if (!inside(p)) { reject('clearance', p); repair(); return }
      }
    }
    if (checkHeatingPlan([pipe], [], settings.design, [], { stopOnConflict: true, checkpoint }).errors) { reject('collision'); return }
    const nearTube = segmentIndex(geometry.pieces, Math.max(coverageRadius, diameter), pitch)
    // A collision-free coil can still have an unusable entrance: a concave
    // return may cross its outward tangent. Reject that seam here, while other
    // corners are still available, instead of rebuilding the same floor later.
    if (!inletClear(points, geometry.pieces)) return
    let gaps = 0
    for (let i = 0; i < samples.length; i++) {
      if (i % 2048 === 0) checkpoint()
      if (!nearTube(samples[i], coverageRadius, true)) gaps++
    }
    const result = { points, pattern, lengthM: geometry.length * scale / 8000, gapRatio: gaps / Math.max(1, samples.length) }
    const entryKey = physicalEntryKey(points)
    const previous = entries.get(entryKey)
    if (!previous || result.gapRatio < previous.gapRatio) entries.set(entryKey, result)
    const acceptable = result.gapRatio <= .02, previousAcceptable = best && best.gapRatio <= .02
    if (!best || acceptable && !previousAcceptable || acceptable && previousAcceptable && entryDistance(points) < entryDistance(best.points) - 1e-6 ||
      !acceptable && !previousAcceptable && result.gapRatio < best.gapRatio - .001) best = result
  }
  const rankedVariants = () => {
    if (!best) return []
    const bestKey = physicalEntryKey(best.points)
    // Variant zero is the chosen best inlet. Start alternatives after that
    // exact physical inlet; its place in the quality-sorted pool may differ.
    return [best, ...[...entries.values()]
      .filter((loop) => physicalEntryKey(loop.points) !== bestKey && loop.gapRatio <= Math.max(.02, best!.gapRatio + .001))
      .sort((a, b) => entryDistance(a.points) - entryDistance(b.points))]
  }
  // Rectangles retain the established, audited centre turn. Irregular areas
  // use complete inset outlines, rather than independent rectangle fragments.
  if (initial.boundaries.length === 1 && initial.boundaries[0].length === 4) {
    const b = heatingAreaBounds(initial)
    const sizes = [[b.width, b.height], [Math.floor(b.width / pitch + 1e-7) * pitch, Math.floor(b.height / pitch + 1e-7) * pitch]]
    // Mask-only access reservations use the established pitch-aligned field.
    // An explicit laying floor (or a manual zone) supports exact boundary fits.
    if (area.clearance && !area.clearance.layingBoundaries) sizes.reverse()
    for (const [size, [w, h]] of sizes.entries()) {
    if (size && Math.abs(w - sizes[0][0]) + Math.abs(h - sizes[0][1]) < 1e-6) continue
    const anchored = { x: area.entry.x < b.x + b.width / 2 ? 0 : b.width - w,
      y: area.entry.y < b.y + b.height / 2 ? 0 : b.height - h }
    for (const offset of [anchored, { x: (b.width - w) / 2, y: (b.height - h) / 2 }]) {
      for (const axis of [undefined, 'x', 'y'] as const) {
        const field = rectangularHeatingField(w, h, { ...settings, returnToEntrySide: true }, scale, checkpoint, axis)
        if (field) for (const flipX of [false, true]) for (const flipY of [false, true]) evaluate(field.points.map((p) => ({ x: b.x + offset.x + (flipX ? w - p.x : p.x), y: b.y + offset.y + (flipY ? h - p.y : p.y) })), field.pattern)
      }
      if (best?.gapRatio < .02) return rankedVariants()
    }
    }
  }
  for (const orientedRings of [rings, rings.map((ring) => [...ring].reverse())]) {
    const outer = orientedRings[0] ?? []
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
      const paths = orientedRings.map(open)
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
    }
  }
  if ((!best || best.gapRatio > .02 || entryDistance(best.points) > radius * 8) && initial.boundaries.length === 1) {
    // A U-shaped area can lose its connecting neck during inward offsets.
    // A bounded monotone sweep plus one outer return keeps it a single tube.
    // Also compare this fallback when a complete spiral can only enter far
    // from the accessible corner. Otherwise a valid coil can seal its own
    // practical approach, despite a mixed pattern having a nearby inlet.
    const monotoneFloors = [initial], terminalCuts: { area: HeatingArea; loss: number }[] = []
    const bounds = heatingAreaBounds(initial), surface = heatingAreaSurface(initial)
    // A narrow doorway tail can prevent a sweep across the useful room. A
    // bounded construction-only crop may leave that tail to the approaches;
    // coverage continues to sample the complete original floor below.
    for (const axis of ['x', 'y'] as const) {
      const start = bounds[axis], span = axis === 'x' ? bounds.width : bounds.height
      for (const value of new Set(initial.boundaries[0].map((p) => p[axis]))) for (const high of [false, true]) {
        const removed = high ? start + span - value : value - start
        if (removed <= 1e-5 || removed > span / 4) continue
        const box = { ...bounds, ...(axis === 'x' ? high ? { width: value - bounds.x } : { x: value, width: bounds.x + bounds.width - value }
          : high ? { height: value - bounds.y } : { y: value, height: bounds.y + bounds.height - value }) }
        const crop = intersectHeatingAreas(initial, rectangularHeatingArea(box)), loss = surface - heatingAreaSurface(crop)
        if (loss > 1e-5 && loss <= surface * .02 && crop.boundaries.length === 1) terminalCuts.push({ area: crop, loss })
      }
    }
    const seenFloors = new Set([JSON.stringify(initial.boundaries)])
    for (const { area } of terminalCuts.sort((a, b) => b.loss - a.loss)) {
      const signature = JSON.stringify(area.boundaries)
      if (!seenFloors.has(signature)) { monotoneFloors.push(area); seenFloors.add(signature) }
      if (monotoneFloors.length >= 5) break
    }
    for (const monotoneFloor of monotoneFloors) for (const transpose of [false, true]) for (const flipX of [false, true]) for (const flipY of [false, true])
      for (const returnInset of radius > pitch / 2 ? [0, radius - pitch / 2] : [0])
      for (const perimeterClearance of returnInset ? [false, true] : [false]) for (const bottomGap of [pitch, 0]) {
      const transform = (p: Point) => ({ x: (transpose ? p.y : p.x) * (flipX ? -1 : 1), y: (transpose ? p.x : p.y) * (flipY ? -1 : 1) })
      const inverse = (p: Point) => { const x = p.x * (flipX ? -1 : 1), y = p.y * (flipY ? -1 : 1); return transpose ? { x: y, y: x } : { x, y } }
      const floor = { boundaries: [clockwise(monotoneFloor.boundaries[0].map(transform))], entry: transform(area.entry) }
      const returnFloor = returnInset ? insetHeatingArea(floor, returnInset) : floor
      if (returnFloor.boundaries.length !== 1) continue
      const ring = returnFloor.boundaries[0], b = heatingAreaBounds(returnFloor)
      const innerFloor = perimeterClearance ? insetHeatingArea(returnFloor, pitch) : returnFloor
      const intervalAt = (boundaries: Point[][], x: number) => {
        const ys: number[] = []
        for (const boundary of boundaries) for (let i = 0; i < boundary.length; i++) {
          const p = boundary[i], q = boundary[(i + 1) % boundary.length]
          if ((p.x > x) !== (q.x > x)) ys.push(p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x))
        }
        ys.sort((a, b) => a - b)
        return ys.length === 2 ? { top: ys[0], bottom: ys[1] } : null
      }
      const interval = (x: number) => intervalAt([ring], x)
      const columnInterval = (x: number) => {
        const outer = interval(x), inner = perimeterClearance ? intervalAt(innerFloor.boundaries, x) : outer
        return outer && inner ? { top: inner.top, bottom: outer.bottom } : null
      }
      const first = b.x + pitch, columns = Math.floor((b.width - pitch - 2 * radius) / pitch) + 1
      const fittedColumns = Math.ceil((b.width - 2 * pitch) / pitch - 1e-7) + 1
      const count = returnInset ? fittedColumns + fittedColumns % 2 : columns % 2 ? columns - 1 : columns
      if (count < 2 || count > 500) continue
      // Reserving 2R and rounding an even column count can leave a 160–360 mm
      // strip beside the outer return. Its inward allowance contains the
      // widened last U; fit the straight rows at no more than nominal pitch.
      const step = returnInset ? (b.width - 2 * pitch) / (count - 1) : pitch
      if (step <= radius + diameter / 2 + 1e-6 || step > pitch + 1e-6) continue
      const xs = Array.from({ length: count }, (_, i) => first + i * step), ranges = xs.map(columnInterval)
      if (ranges.some((value) => !value)) continue
      const envelope = (left: number, right: number) => {
        // A column beside a concave perimeter leg must keep its pitch from
        // that return too, rather than merely staying within the floor outline.
        const probes = [left, right, ...[ring, ...innerFloor.boundaries].flatMap((path) => path.flatMap((p) =>
          p.x > left && p.x < right ? [p.x - 1e-5, p.x + 1e-5] : []))].map(columnInterval)
        return probes.some((p) => !p) ? null : { top: Math.max(...probes.map((p) => p!.top)), bottom: Math.min(...probes.map((p) => p!.bottom)) }
      }
      const path: Point[] = [{ x: xs[0], y: ranges[0]!.bottom }]
      let usable = true
      for (let i = 0; i < count; i++) {
        if (i === count - 1) { path.push({ x: xs[i], y: ranges[i]!.bottom }); break }
        const pair = envelope(xs[i], xs[i + 1])
        if (!pair || pair.bottom - pair.top < pitch * 2 + radius * 2) { usable = false; break }
        // The long perimeter return omits the bottom edge. Where clear, let
        // the lower U-bends reach that edge instead of leaving a full-pitch
        // strip beyond every turn. Retain the inset version for concave floors.
        const y = i % 2 ? pair.bottom - bottomGap : pair.top + (perimeterClearance ? 0 : pitch)
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
    const fields: Point[][][] = [], patterns = new WeakMap<Point[], HeatingAreaLoop['pattern']>(), inletUsability = new WeakMap<Point[], boolean>()
    const initialEdges = initial.boundaries.flatMap((ring) => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })))
    const onInitialEdge = segmentIndex(initialEdges, 1e-5, pitch)
    const border = (a: Point, b: Point) => [0, .25, .5, .75, 1].every((t) =>
      onInitialEdge({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 1e-5, true))
    for (const r of rectangles) {
      const variants: Point[][] = []
      // Physical offsets and partition half-pitch seams are already present in
      // initial. Only an internal rectangle-to-rectangle cut needs padding;
      // padding the outside again creates a 150–200 mm unheated seam.
      const l = border({ x: r.x, y: r.y }, { x: r.x, y: r.y + r.height }) ? 0 : pitch / 2
      const rr = border({ x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }) ? 0 : pitch / 2
      const t = border({ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }) ? 0 : pitch / 2
      const bb = border({ x: r.x, y: r.y + r.height }, { x: r.x + r.width, y: r.y + r.height }) ? 0 : pitch / 2
      const fw = Math.floor((r.width - pitch) / pitch) * pitch, fh = Math.floor((r.height - pitch) / pitch) * pitch
      const sizes = [{ w: r.width - l - rr, h: r.height - t - bb, x: r.x + l, y: r.y + t },
        { w: r.width - pitch, h: r.height - pitch, x: r.x + pitch / 2, y: r.y + pitch / 2 },
        { w: fw, h: fh, x: r.x + (r.width - fw) / 2, y: r.y + (r.height - fh) / 2 }]
      const seen = new Set<string>()
      for (const size of sizes) {
        const { w, h } = size, key = JSON.stringify(size)
        if (w <= 0 || h <= 0 || seen.has(key)) continue
        seen.add(key)
        for (const axis of ['x', 'y'] as const) {
          const field = rectangularHeatingField(w, h, { ...settings, returnToEntrySide: true }, scale, checkpoint, axis)
          // A shallow threshold can yield only one straight stroke. It has no
          // paired side to splice into a coil; forcing it into the join makes
          // an otherwise usable room fail with a reduced-radius connector.
          // The original floor remains in the coverage samples and final audit.
          if (!field || !heatingPairedEntries(field.points, settings.spacingMm, scale)) continue
          for (const flipX of [false, true]) for (const flipY of [false, true]) {
            const points = field.points.map((p) => ({ x: size.x + (flipX ? w - p.x : p.x), y: size.y + (flipY ? h - p.y : p.y) }))
            patterns.set(points, field.pattern); variants.push(points)
          }
        }
      }
      for (const points of variants) {
        const geometry = heatingPipeGeometry(make(openHeatingTurns(compact(points), radius, diameter)))
        inletUsability.set(points, inletClear(geometry.points, geometry.pieces, false))
      }
      if (variants.length) fields.push(variants.sort((a, b) => Number(inletUsability.get(b)) - Number(inletUsability.get(a)) || entryDistance(a) - entryDistance(b)))
    }
    fields.sort((a, b) => Number(inletUsability.get(b[0])) - Number(inletUsability.get(a[0])) || entryDistance(a[0]) - entryDistance(b[0]))
    if (trace) trace.fields = fields.length
    const oneComponent = heatingAreaComponents(initial).length === 1
    if (oneComponent && fields.length === 1) for (const points of fields[0]) evaluate(points, patterns.get(points) ?? 'spiral')
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
        return !audit.errors && (remaining.length > 0 || inletClear(geometry.points, geometry.pieces))
      }
      // Later splices must see the real tangent controls of earlier widened
      // returns, so their connector cuts cannot consume the same straight leg.
      const join = (choices: readonly Point[][][]) => joinHeatingZoneFields(choices, heatingAreaBounds(initial), [], pitch, radius, valid,
        (points) => patterns.get(points) ?? 'spiral', { timeMs: 750, auditLimit: 256, checkpoint, prepare: (points) => openHeatingTurns(compact(points), radius, diameter) })
      const joined = join(fields)
      if (joined) evaluate(joined.points, joined.pattern)
      if (!best || best.gapRatio > .02) {
        // A tiny threshold pocket may fit a local return but no pair of splice
        // connectors. Try the main fields too; the entire original floor is
        // still sampled, so an uncovered pocket cannot silently disappear.
        const main = fields.filter((variants) => {
          const bounds = heatingAreaBounds({ boundaries: [variants[0]], entry: area.entry })
          return bounds.width * bounds.height >= 4 * pitch * pitch
        })
        if (main.length && main.length < fields.length) {
          const candidate = join(main)
          if (candidate) evaluate(candidate.points, candidate.pattern)
        }
      }
      // A narrow approach may be heated by the host or its transit pipes.
      // Keep a real main-field alternative for that combined-area caller;
      // its gap is still measured against every original sample, and the
      // ordinary standalone coverage gate remains unchanged.
      if (oneComponent && (!best || best.gapRatio > .05)) for (const variants of fields) {
        const bounds = heatingAreaBounds({ boundaries: [variants[0]], entry: area.entry })
        if (bounds.width * bounds.height < heatingAreaSurface(initial) * .5) continue
        for (const points of variants) evaluate(points, patterns.get(points) ?? 'spiral')
      }
    }
  }
  return rankedVariants()
}

const areaLoopCache = new Map<string, { variants: HeatingAreaLoop[]; trace: HeatingAreaTrace }>()
/** Translation-independent, bounded cache for pointer moves, inspectors and
 * exports. Cached arrays are copied so an automatic route cannot alter a preview. */
export const generateHeatingAreaLoop = (area: HeatingArea, settings: HeatingAreaSettings, scale: number,
  checkpoint: () => void = () => {}, trace?: HeatingAreaTrace): HeatingAreaLoop | null => {
  checkpoint()
  if (!area.boundaries.length) return null
  const origin = heatingAreaBounds(area), shift = (p: Point) => ({ x: p.x - origin.x, y: p.y - origin.y })
  const normalized: HeatingArea = { boundaries: area.boundaries.map((ring) => ring.map(shift)), entry: shift(area.entry),
    ...(area.clearance ? { clearance: { boundaries: area.clearance.boundaries.map((ring) => ring.map(shift)), edge: area.clearance.edge,
      bounds: { ...area.clearance.bounds, x: area.clearance.bounds.x - origin.x, y: area.clearance.bounds.y - origin.y },
      ...(area.clearance.layingBoundaries ? { layingBoundaries: area.clearance.layingBoundaries.map((ring) => ring.map(shift)) } : {}),
      ...(area.clearance.entryBoundaries ? { entryBoundaries: area.clearance.entryBoundaries.map((ring) => ring.map(shift)) } : {}),
      ...(area.clearance.coverageStep !== undefined ? { coverageStep: area.clearance.coverageStep } : {}) } } : {}) }
  const key = JSON.stringify([normalized, settings.diameterMm, settings.spacingMm, settings.edgeMm ?? 100, settings.design, scale])
  let cached = areaLoopCache.get(key)
  if (!cached) {
    const details: HeatingAreaTrace = {}, variants = buildHeatingAreaLoopVariants(normalized, settings, scale, checkpoint, details)
    cached = { variants, trace: details }; areaLoopCache.set(key, cached)
    if (areaLoopCache.size > 128) areaLoopCache.delete(areaLoopCache.keys().next().value!)
  }
  if (trace) Object.assign(trace, cached.trace, { ...(cached.trace.point ? { point: { x: cached.trace.point.x + origin.x, y: cached.trace.point.y + origin.y } } : {}) })
  const loop = cached.variants[(settings.entryVariant ?? 0) % cached.variants.length]
  return loop ? { ...loop, points: loop.points.map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })) } : null
}

type AreaPartition = { areas: HeatingArea[]; score: number }
/** Allocate connected areas before drawing tubes. Structural vertices are
 * candidate cuts too: a cabinet recess is not forced into an equal-width strip. */
type PartitionOptions = { coverageBudgetM2?: number; coverageLimit?: number; centreFloor?: HeatingArea; fieldEntryVariants?: ReadonlyMap<string, number>; checkpoint?: () => void; leadM?: (point: Point) => number; entryPoint?: Point; axis?: 'x' | 'y'; variant?: number; onRejectedArea?: (area: HeatingArea, trace?: HeatingAreaTrace) => void }
const partitionHeatingAreaWithAxes = (source: HeatingArea, count: number, settings: HeatingAreaSettings, scale: number,
  options: PartitionOptions = {}) => {
  const checkpoint = options.checkpoint ?? (() => {}), pitch = drawingUnitsForMetres(settings.spacingMm / 1000, scale)
  const radius = drawingUnitsForMetres(heatingDesignLimits(settings.diameterMm, settings.design).minBendRadiusMm / 1000, scale)
  const physicalEdge = drawingUnitsForMetres((settings.edgeMm ?? 100) / 1000, scale)
  // Partition the usable centre-line floor. A narrow threshold remnant may
  // disappear at the physical edge offset; it must not make otherwise valid
  // cuts look disconnected at the earlier half-pitch offset.
  const centreFloor = layingContours(options.centreFloor ?? insetHeatingArea(source, physicalEdge), pitch, radius)
  const area = insetHeatingArea(centreFloor, -pitch / 2), localSettings = { ...settings, edgeMm: settings.spacingMm / 2 }
  area.clearance = { ...(source.clearance ?? { boundaries: source.boundaries, edge: physicalEdge }),
    ...(options.centreFloor ? { layingBoundaries: centreFloor.boundaries } : {}), bounds: heatingAreaBounds(area) }
  const memo = new Map<string, AreaPartition[]>(), loopMemo = new Map<string, HeatingAreaLoop | null>(), rejected = new Set<string>(), traces = new Map<string, HeatingAreaTrace>()
  const cost = (a: HeatingArea, groups: number): number => {
    const components = heatingAreaComponents(a)
    if (groups > 1 && components.length === groups) return Math.max(...components.map((component) => cost(component, 1)))
    const b = heatingAreaBounds(a), surface = heatingAreaSurface(a), length = surface * (scale / 8000) ** 2 / (settings.spacingMm / 1000)
    const lead = options.leadM?.({ x: b.x + b.width / 2, y: b.y + b.height / 2 }) ?? 0
    return length / groups + 2 * lead
  }
  let expanded = 0
  const family = (areas: HeatingArea[], aspect = true) => JSON.stringify(areas.map((area) => {
    const box = heatingAreaBounds(area)
    const corners = area.boundaries.reduce((sum, ring) => sum + ring.filter((p, i) => {
      const before = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
      return distance(before, p) >= radius && distance(p, next) >= radius &&
        Math.abs((p.x - before.x) * (next.y - p.y) - (p.y - before.y) * (next.x - p.x)) > 1e-5
    }).length, 0)
    return [corners, area.boundaries.length, aspect ? box.width >= box.height ? 1 : 0 : 0]
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
  const diverse = <T>(values: T[], signature: (value: T) => string) => {
    const first = new Map<string, T>()
    for (const value of values) if (!first.has(signature(value))) first.set(signature(value), value)
    const chosen = new Set(first.values())
    return [...chosen, ...values.filter((value) => !chosen.has(value))]
  }
  const plan = (a: HeatingArea, groups: number, depth = 0): AreaPartition[] => {
    checkpoint()
    const key = JSON.stringify([a.boundaries, groups]), cached = memo.get(key)
    if (cached) return cached
    if (groups === 1) {
      if (rejected.has(JSON.stringify(a.boundaries))) return []
      const laying = layingContours(insetHeatingArea(a, pitch / 2), pitch, radius)
      return laying.boundaries.filter((ring) => signedArea(ring) > 0).length === 1 ? [{ areas: [a], score: cost(a, 1) }] : []
    }
    if (++expanded > 1000 || depth > 6) return []
    const components = heatingAreaComponents(a)
    if (components.length > 1) {
      if (components.length > groups) return []
      let states = [{ areas: [] as HeatingArea[], score: 0, used: 0 }]
      for (const [index, component] of components.entries()) {
        if (a.clearance) component.clearance = { ...a.clearance, bounds: heatingAreaBounds(component) }
        const next: (AreaPartition & { used: number })[] = []
        for (const state of states) for (let count = 1; count <= groups - state.used - (components.length - index - 1); count++) {
          for (const child of plan(component, count, depth + 1).slice(0, 2)) next.push({
            areas: [...state.areas, ...child.areas], used: state.used + count,
            score: Math.max(state.score, child.score) + (state.score + child.score) * .001 })
        }
        const retained = new Map<number, number>()
        states = next.sort((a, b) => a.score - b.score).filter((state) => {
          const count = retained.get(state.used) ?? 0
          retained.set(state.used, count + 1); return count < 8
        })
      }
      const result = states.filter((state) => state.used === groups).slice(0, 8)
      memo.set(key, result); return result
    }
    const box = heatingAreaBounds(a), areaM2 = heatingAreaSurface(a), candidates: { a: HeatingArea; b: HeatingArea; left: number; score: number; family: string }[] = []
    for (const axis of options.axis ? [options.axis] : ['x', 'y'] as const) {
      const start = axis === 'x' ? box.x : box.y, span = axis === 'x' ? box.width : box.height
      const values = new Set(a.boundaries.flatMap((path) => path.flatMap((p) => [-4, -2, 0, 2, 4].map((n) => p[axis] + n * pitch))))
      for (let group = 1; group < groups; group++) for (const shift of [-.06, 0, .06]) values.add(start + span * (group / groups + shift))
      for (const value of values) {
        if (value < start + 3 * pitch || value > start + span - 3 * pitch) continue
        const first = layingContours(intersectHeatingAreas(a, rectangularHeatingArea({ ...box, ...(axis === 'x' ? { width: value - box.x } : { height: value - box.y }) })), pitch, radius)
        const second = layingContours(intersectHeatingAreas(a, rectangularHeatingArea({ ...box, ...(axis === 'x' ? { x: value, width: box.x + box.width - value } : { y: value, height: box.y + box.height - value }) })), pitch, radius)
        first.clearance = { ...area.clearance!, bounds: heatingAreaBounds(first) }
        second.clearance = { ...area.clearance!, bounds: heatingAreaBounds(second) }
        const firstCount = first.boundaries.filter((p) => signedArea(p) > 0).length
        const secondCount = second.boundaries.filter((p) => signedArea(p) > 0).length
        if (!firstCount || !secondCount || firstCount + secondCount > groups) continue
        const ratio = heatingAreaSurface(first) / areaM2
        for (const left of new Set([Math.round(ratio * groups), Math.floor(ratio * groups), Math.ceil(ratio * groups), firstCount, groups - secondCount])) {
          if (left < firstCount || groups - left < secondCount) continue
          const ca = cost(first, left), cb = cost(second, groups - left)
          candidates.push({ a: first, b: second, left, family: `${axis}:${firstCount}:${secondCount}:${left}`,
            score: Math.max(ca, cb) + Math.abs(ca - cb) * .1 })
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score)
    const result: AreaPartition[] = []
    for (const choice of diverse(candidates, (choice) => choice.family).slice(0, depth ? 8 : 16)) {
      const left = plan(choice.a, choice.left, depth + 1), right = plan(choice.b, groups - choice.left, depth + 1)
      for (const a of left.slice(0, 2)) for (const b of right.slice(0, 2)) result.push({ areas: [...a.areas, ...b.areas], score: Math.max(a.score, b.score) + (a.score + b.score) * .001 })
    }
    result.sort((a, b) => a.score - b.score)
    const retained = diverse(result, (partition) => family(partition.areas)).slice(0, 8)
    memo.set(key, retained); return retained
  }
  if (!Number.isInteger(count) || count < 1 || count > 24 || !area.boundaries.length) return null
  let best: { loops: HeatingAreaLoop[]; areas: HeatingArea[]; maxM: number; gapRatio: number } | null = null
  const alternatives: NonNullable<typeof best>[] = [], seenPartitions = new Set<string>()
  const variant = Number.isSafeInteger(options.variant) && options.variant! >= 0 ? options.variant! : 0
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const score = (candidate: NonNullable<typeof best>) => [candidate.gapRatio > .05 ? 1 : 0,
    Math.max(0, candidate.maxM + limits.allowanceM - limits.maxCircuitLengthM), candidate.gapRatio > .02 ? 1 : 0,
    candidate.loops.filter((loop) => loop.pattern !== 'spiral').length, candidate.maxM, candidate.gapRatio]
  const better = (candidate: NonNullable<typeof best>, previous: NonNullable<typeof best>) => {
    const a = score(candidate), b = score(previous)
    const difference = a.map((value, i) => value - b[i]).find((value) => Math.abs(value) > 1e-7)
    return difference !== undefined && difference < 0
  }
  for (let round = 0; round < 4; round++) {
    const previousRejected = rejected.size, plans = plan(area, count)
    for (const proposal of plans.slice(0, 8)) {
    const loops: HeatingAreaLoop[] = []
    for (const a of proposal.areas) {
      const key = JSON.stringify(a.boundaries)
      if (options.entryPoint) a.entry = options.entryPoint
      else if (options.leadM && !loopMemo.has(key)) {
        const centre = layingContours(insetHeatingArea(a, pitch / 2), pitch, radius)
        let bestCost = Infinity
        for (const ring of centre.boundaries) for (let i = 0; i < ring.length; i++) for (const next of [ring[(i + 1) % ring.length], ring[(i + ring.length - 1) % ring.length]]) {
          const head = ring[i], length = distance(head, next)
          if (!length) continue
          const entry = { x: head.x + (head.x - next.x) / length * radius, y: head.y + (head.y - next.y) / length * radius }
          const cost = options.leadM(entry)
          if (cost < bestCost) { bestCost = cost; a.entry = entry }
        }
      }
      if (!loopMemo.has(key)) { const trace = {}; traces.set(key, trace); loopMemo.set(key, generateHeatingAreaLoop(a, { ...localSettings, entryVariant: options.fieldEntryVariants?.get(key) ?? localSettings.entryVariant }, scale, checkpoint, trace)) }
      const loop = loopMemo.get(key)
      if (!loop) { rejected.add(key); options.onRejectedArea?.(a, traces.get(key)); break }
      const localCoverageLimit = Math.max(options.coverageLimit ?? .05,
        (options.coverageBudgetM2 ?? 0) / Math.max(.0001, heatingAreaSurface(a) * (scale / 8000) ** 2))
      if (loop.gapRatio > localCoverageLimit) {
        rejected.add(key); options.onRejectedArea?.(a, { ...traces.get(key), message: `Coverage gap ${(loop.gapRatio * 100).toFixed(2)}%` }); break
      }
      const completeLength = loop.lengthM + (options.leadM?.(loop.points[0]) ?? 0) + (options.leadM?.(loop.points.at(-1)!) ?? 0) + limits.allowanceM
      if (completeLength > limits.maxCircuitLengthM + .05) {
        // Feed lengths can unbalance unequal wings even when their combined
        // average looks fine. Feed this failed leaf back into the partitioner.
        rejected.add(key); options.onRejectedArea?.(a, { ...traces.get(key), message: `Complete circuit ${completeLength.toFixed(2)}m exceeds ${limits.maxCircuitLengthM}m` }); break
      }
      loops.push(loop)
    }
    if (loops.length !== count) continue
    const maxM = Math.max(...loops.map((loop) => loop.lengthM + (options.leadM?.(loop.points[0]) ?? 0) + (options.leadM?.(loop.points.at(-1)!) ?? 0)))
    const gapRatio = Math.max(...loops.map((loop) => loop.gapRatio)), candidate = { loops, areas: proposal.areas, maxM, gapRatio }
    if (!best || better(candidate, best)) best = candidate
    if (gapRatio <= .02 && maxM + limits.allowanceM <= limits.maxCircuitLengthM) {
      const signature = JSON.stringify(proposal.areas.map((area) => JSON.stringify(area.boundaries)).sort())
      if (!seenPartitions.has(signature)) {
        seenPartitions.add(signature); alternatives.push(candidate)
        const spirals = alternatives.filter((candidate) => candidate.loops.every((loop) => loop.pattern === 'spiral'))
        if (spirals.length > variant) return spirals[variant]
      }
    }
    }
    if (rejected.size === previousRejected) break
    memo.clear(); expanded = 0
  }
  alternatives.sort((a, b) => a.loops.filter((loop) => loop.pattern !== 'spiral').length - b.loops.filter((loop) => loop.pattern !== 'spiral').length ||
    a.maxM - b.maxM || a.gapRatio - b.gapRatio)
  const choices = diverse(alternatives, (partition) => family(partition.areas, false))
  return choices.length ? choices[variant % choices.length] : best
}

/** Preserve a complete preferred layout; use directional searches to recover
 * geometry that the mixed-axis estimate could otherwise prune too early. */
export const partitionHeatingArea = (source: HeatingArea, count: number, settings: HeatingAreaSettings, scale: number,
  options: PartitionOptions = {}) => {
  const preferred = partitionHeatingAreaWithAxes(source, count, settings, scale, options)
  const limits = heatingDesignLimits(settings.diameterMm, settings.design)
  const feasible = (candidate: NonNullable<typeof preferred>) => candidate.gapRatio <= (options.coverageLimit ?? .05) &&
    candidate.maxM + limits.allowanceM <= limits.maxCircuitLengthM + .05
  if (options.axis || count < 3 || preferred && feasible(preferred) && preferred.loops.every((loop) => loop.pattern === 'spiral')) return preferred
  const candidates = [preferred, ...(['x', 'y'] as const).map((axis) => partitionHeatingAreaWithAxes(source, count, settings, scale, { ...options, axis }))]
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
  candidates.sort((a, b) => Number(!feasible(a)) - Number(!feasible(b)) ||
    a.loops.filter((loop) => loop.pattern !== 'spiral').length - b.loops.filter((loop) => loop.pattern !== 'spiral').length)
  return candidates[0] ?? null
}
