import type { Point } from './model/types.js'

export type HeatingFieldBox = { left: number; right: number; top: number; bottom: number }
type Remainder = { box: HeatingFieldBox; lengthM: number }
const separation = (a: HeatingFieldBox, b: HeatingFieldBox) => Math.max(0, a.left - b.right, b.left - a.right) + Math.max(0, a.top - b.bottom, b.top - a.bottom)
const nearer = (boxes: readonly HeatingFieldBox[], target: HeatingFieldBox) => {
  let nearest = 0
  const centre = (box: HeatingFieldBox) => Math.abs(box.left + box.right - target.left - target.right) + Math.abs(box.top + box.bottom - target.top - target.bottom)
  for (let i = 1; i < boxes.length; i++) {
    const a = separation(boxes[i], target), b = separation(boxes[nearest], target)
    if (a < b || a === b && centre(boxes[i]) < centre(boxes[nearest])) nearest = i
  }
  return nearest
}


/** Equalise complete lengths, not just areas. Extra small fields consume part
 * of the nearby circuit's budget before the large rectangle is divided. */
export const balancedHeatingCuts = (box: HeatingFieldBox, count: number, alongX: boolean, loopM: number,
  pitchCells: number, cellM: number, source: Point, sourceHalfCells: number, remainders: readonly Remainder[], measure?: (box: HeatingFieldBox, part: number) => number, spill?: { atEnd: boolean; maxM: number }) => {
  const first = alongX ? box.left : box.top, last = alongX ? box.right : box.bottom, span = last - first
  let cuts = Array.from({ length: count + 1 }, (_, i) => first + span * i / count)
  const canBalance = count >= 2 && span >= count * pitchCells * 2 && Number.isFinite(loopM) && loopM > 0
  if (canBalance) for (let pass = 0; pass < 4; pass++) {
    const boxes = Array.from({ length: count }, (_, i) => ({ ...box, ...(alongX ? { left: cuts[i], right: cuts[i + 1] } : { top: cuts[i], bottom: cuts[i + 1] }) }))
    const extra = boxes.map((part) => 2 * (Math.max(0, part.left - source.x - sourceHalfCells, source.x - sourceHalfCells - part.right) +
      Math.max(0, part.top - source.y - sourceHalfCells, source.y - sourceHalfCells - part.bottom)) * cellM)
    for (const remainder of remainders) {
      const nearest = nearer(boxes, remainder.box)
      extra[nearest] += remainder.lengthM + 2 * separation(boxes[nearest], remainder.box) * cellM + .5
    }
    const target = (loopM + extra.reduce((sum, n) => sum + n, 0)) / count
    const weights = extra.map((n) => Math.max(5, target - n)), total = weights.reduce((sum, n) => sum + n, 0)
    let consumed = 0
    cuts = [first]
    for (let i = 1; i < count; i++) {
      consumed += weights[i - 1]
      cuts.push(Math.max(cuts[i - 1] + pitchCells * 2, Math.min(last - (count - i) * pitchCells * 2, Math.round(first + span * consumed / total))))
    }
    cuts.push(last)
  }
  if (measure) {
    const totalsFor = (boundaries: number[]) => {
      const boxes = Array.from({ length: count }, (_, i) => ({ ...box, ...(alongX ? { left: boundaries[i], right: boundaries[i + 1] } : { top: boundaries[i], bottom: boundaries[i + 1] }) }))
      const totals = boxes.map((part, i) => measure(part, i))
      for (const remainder of remainders) {
        const nearest = nearer(boxes, remainder.box)
        totals[nearest] += remainder.lengthM + 2 * separation(boxes[nearest], remainder.box) * cellM + .5
      }
      return totals
    }
    const score = (boundaries: number[]) => {
      const totals = totalsFor(boundaries)
      const mean = totals.reduce((sum, n) => sum + n, 0) / count
      return [Math.max(...totals), totals.reduce((sum, n) => sum + (n - mean) ** 2, 0)]
    }
    const better = (a: number[], b: number[]) => a[0] < b[0] - .01 || Math.abs(a[0] - b[0]) <= .01 && a[1] < b[1]
    let best = score(cuts)
    if (canBalance) for (let pass = 0; pass < 2; pass++) for (let boundary = 1; boundary < count; boundary++) {
      const uniform = Math.round(first + span * boundary / count), centre = cuts[boundary]
      for (let offset = -pitchCells * 2; offset <= pitchCells * 2; offset++) for (const start of [uniform, centre]) {
        const value = start + offset
        if (value <= cuts[boundary - 1] + pitchCells * 2 || value >= cuts[boundary + 1] - pitchCells * 2) continue
        const proposal = [...cuts]; proposal[boundary] = value
        const next = score(proposal)
        if (better(next, best)) { cuts = proposal; best = next }
      }
    }
    if (spill && count === 2 && canBalance) {
      let smallest = Infinity, spilling: number[] | undefined
      for (let boundary = first + pitchCells * 2; boundary <= last - pitchCells * 2; boundary++) {
        const proposal = [first, boundary, last], totals = totalsFor(proposal)
        const small = totals[spill.atEnd ? 1 : 0]
        if (Math.max(...totals) <= spill.maxM && small < smallest) { smallest = small; spilling = proposal }
      }
      if (spilling) { cuts = spilling; best = score(cuts) }
    }
    return { cuts, maxM: best[0] }
  }
  return { cuts, maxM: Infinity }
}
