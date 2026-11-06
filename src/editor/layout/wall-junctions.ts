import type { LineShape, Point, Shape } from '../model/types.js'

/** Fill true shared corners with a miter. Free ends remain precisely on their
 * coordinates with butt caps; nearby, disconnected walls are never extended. */
export const wallJunctionMarkup = (shapes: readonly Shape[], monochrome = false): string => {
  const nodes = new Map<string, { point: Point; other: Point; wall: LineShape }[]>()
  for (const wall of shapes) {
    if (wall.kind !== 'wall' || wall.hidden) continue
    for (const [point, other] of [[wall.start, wall.end], [wall.end, wall.start]]) {
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`, entries = nodes.get(key) ?? []
      entries.push({ point, other, wall }); nodes.set(key, entries)
    }
  }
  const result: string[] = []
  for (const entries of nodes.values()) for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i], b = entries[j], halfA = (a.wall.strokeWidth ?? 6) / 2, halfB = (b.wall.strokeWidth ?? 6) / 2
    if ((a.wall.stroke ?? '') !== (b.wall.stroke ?? '')) continue
    const ax = a.point.x - a.other.x, ay = a.point.y - a.other.y, bx = b.other.x - b.point.x, by = b.other.y - b.point.y
    const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by)
    if (!al || !bl) continue
    const ux = ax / al, uy = ay / al, vx = bx / bl, vy = by / bl, turn = ux * vy - uy * vx
    if (Math.abs(turn) < 1e-6) continue
    const side = turn > 0 ? -1 : 1, p = a.point
    const first = { x: p.x - uy * halfA * side, y: p.y + ux * halfA * side }
    const last = { x: p.x - vy * halfB * side, y: p.y + vx * halfB * side }
    const t = ((last.x - first.x) * vy - (last.y - first.y) * vx) / turn
    const corner = { x: first.x + ux * t, y: first.y + uy * t }
    // Match a miter limit of 2: acute corners are bevelled rather than producing
    // long spikes. Different wall thicknesses meet at their actual offset edges.
    const miter = Math.hypot(corner.x - p.x, corner.y - p.y) <= 2 * Math.max(halfA, halfB)
    const stroke = monochrome ? '#101010' : '#3b2c20'
    result.push(`<path class="wall-junction" d="M ${p.x} ${p.y} L ${first.x} ${first.y}${miter ? ` L ${corner.x} ${corner.y}` : ''} L ${last.x} ${last.y} Z" fill="${stroke}" stroke="none" pointer-events="none"/>`)
  }
  return result.join('')
}
