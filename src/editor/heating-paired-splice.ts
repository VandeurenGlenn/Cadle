import type { Point } from './model/types.js'

export type HeatingSpliceWindow = { before: Point[]; after: Point[]; distance: number }

/** Insert a facing field without quantizing its existing bends. The closure
 * and both new bridges remain proposals until the caller audits real curves. */
export function* exactHeatingSpliceCandidates(a: readonly Point[], b: readonly Point[], pitch: number,
  radius: number, checkpoint: () => void = () => {}, allowPortSplice = false): Generator<Point[]> {
  if (a.length < 3 || b.length < 3) return
  const first = b[0], last = b.at(-1)!, head = b[1], tail = b.at(-2)!
  const close = Math.hypot(first.x - last.x, first.y - last.y)
  if (close < 1e-7 || close > pitch * 2 + 1e-7 ||
    Math.abs(first.x - last.x) > 1e-7 && Math.abs(first.y - last.y) > 1e-7) return
  const ax = head.x - first.x, ay = head.y - first.y, bx = tail.x - last.x, by = tail.y - last.y
  if (ax * bx + ay * by <= 0 || Math.abs(ax * by - ay * bx) > 1e-6) return
  type Run = { index: number; vertical: boolean; low: number; high: number; across: number; sign: number }
  const runs = (points: readonly Point[]): Run[] => points.slice(1).flatMap((p, n) => {
    const before = points[n], dx = p.x - before.x, dy = p.y - before.y
    if (Math.abs(dx) > 1e-7 && Math.abs(dy) > 1e-7 || Math.hypot(dx, dy) < 1e-7) return []
    const vertical = Math.abs(dx) < 1e-7, start = vertical ? before.y : before.x, end = vertical ? p.y : p.x
    return [{ index: n + 1, vertical, low: Math.min(start, end), high: Math.max(start, end),
      across: vertical ? p.x : p.y, sign: Math.sign(end - start) }]
  })
  const pairs = runs(a).flatMap((x) => runs(b).flatMap((y) => {
    const gap = Math.abs(x.across - y.across)
    return x.vertical === y.vertical && gap > 1e-7 && gap <= pitch * 2 + 1e-7 ? [{ x, y, gap }] : []
  })).sort((a, b) => a.gap - b.gap)
  let count = 0
  for (const { x, y, gap } of pairs) {
    checkpoint()
    const delta = Math.max(0, radius - gap / 2), theta = delta ? Math.acos(1 - delta / (2 * radius)) : 0
    // Closing the inserted field's former inlet creates another widened U.
    // Its S tangents still need room when the two facing runs are farther
    // apart and the bridge itself needs no widening.
    const closureDelta = Math.max(0, radius - close / 2)
    const closureTheta = closureDelta ? Math.acos(1 - closureDelta / (2 * radius)) : 0
    const margin = radius * 2 + 2 * radius * Math.max(Math.sin(theta), Math.sin(closureTheta)) + 1e-5
    const low = Math.max(x.low, y.low) + margin, high = Math.min(x.high, y.high) - margin
    const length = Math.min(pitch * 4, high - low)
    if (length < radius * 2 + pitch * .2) continue
    const start = x.sign > 0 ? (low + high - length) / 2 : (low + high + length) / 2
    const end = start + x.sign * length
    const point = (run: Run, station: number): Point => run.vertical ? { x: run.across, y: station } : { x: station, y: run.across }
    const af = point(x, start), at = point(x, end), bf = point(y, start), bt = point(y, end)
    const detour = x.sign === y.sign ? [...b.slice(0, y.index)].reverse().concat([...b.slice(y.index)].reverse()) :
      [...b.slice(y.index), ...b.slice(0, y.index)]
    yield [...a.slice(0, x.index), af, bf, ...detour, bt, at, ...a.slice(x.index)]
    if (++count >= 16) break
  }
  // A field facing a straight run can be inserted at its two open ends.
  // Closing that field into a loop first consumes space for an extra U-turn.
  if (!allowPortSplice) return
  const portAxis = Math.abs(ax) < 1e-7 ? 'y' : Math.abs(ay) < 1e-7 ? 'x' : undefined
  if (portAxis && Math.abs(first[portAxis] - last[portAxis]) < 1e-7) {
    const along = portAxis === 'x' ? 'y' : 'x'
    const direction = Math.sign(head[portAxis] - first[portAxis])
    for (let i = 1; i < a.length; i++) {
      checkpoint()
      const start = a[i - 1], end = a[i]
      if (Math.abs(start[portAxis] - end[portAxis]) > 1e-7) continue
      const gap = (first[portAxis] - start[portAxis]) * direction
      if (gap < radius - 1e-7 || gap > pitch * 2 + 1e-7) continue
      if (Math.min(first[along], last[along]) < Math.min(start[along], end[along]) + radius * 2 ||
        Math.max(first[along], last[along]) > Math.max(start[along], end[along]) - radius * 2) continue
      const field = (end[along] - start[along]) * (last[along] - first[along]) > 0 ? b : [...b].reverse()
      const entry = { ...field[0], [portAxis]: start[portAxis] }
      const exit = { ...field.at(-1)!, [portAxis]: start[portAxis] }
      yield [...a.slice(0, i), entry, ...field, exit, ...a.slice(i)]
    }
  }
}

/** Open a straight run inside a host coil, keeping both original feed ends.
 * A neighbouring field is inserted here with TWO connectors. Appending it to
 * one free end would move the return into another room and interleave feeds. */
export const heatingSpliceWindows = (points: readonly Point[], patch: readonly Point[], radius: number,
  pitch: number, diameter: number): HeatingSpliceWindow[] => {
  const windows: HeatingSpliceWindow[] = []
  const centre = { x: (patch[0].x + patch.at(-1)!.x) / 2, y: (patch[0].y + patch.at(-1)!.y) / 2 }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) continue
    // The retained corners and both new connectors each need an R tangent.
    const margin = radius * 2, available = length - margin * 2
    if (available < radius * 2 + diameter) continue
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
    for (const wanted of [Math.max(radius * 2 + diameter, pitch * 2), Math.max(radius * 4, pitch * 4)]) {
      const cut = Math.min(wanted, available)
      const near = (centre.x - a.x) * ux + (centre.y - a.y) * uy
      for (const position of [near, length / 2]) {
        const from = Math.max(margin, Math.min(length - margin - cut, position - cut / 2))
        const start = { x: a.x + ux * from, y: a.y + uy * from }
        const end = { x: start.x + ux * cut, y: start.y + uy * cut }
        if (windows.some((w) => Math.hypot(w.before.at(-1)!.x - start.x, w.before.at(-1)!.y - start.y) < 1e-6 &&
          Math.hypot(w.after[0].x - end.x, w.after[0].y - end.y) < 1e-6)) continue
        windows.push({ before: [...points.slice(0, i), start], after: [end, ...points.slice(i)],
          distance: Math.hypot(start.x - centre.x, start.y - centre.y) + Math.hypot(end.x - centre.x, end.y - centre.y) })
      }
    }
  }
  return windows.sort((a, b) => a.distance - b.distance)
}
