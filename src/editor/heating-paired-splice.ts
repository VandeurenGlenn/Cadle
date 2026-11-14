import type { Point } from './model/types.js'

export type HeatingSpliceWindow = { before: Point[]; after: Point[]; distance: number }

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
