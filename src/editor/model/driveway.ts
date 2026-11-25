import type { DrivewayMaterial, Point, RectShape } from './types.js'
import { cleanStairRoute } from './stair-route.js'

export const isDrivewayMaterial = (value: unknown): value is DrivewayMaterial =>
  value === 'cobbles' || value === 'gravel' || value === 'pavers'

export const drivewayRouteError = (points: readonly Point[], width: number): string | null => {
  if (!Number.isFinite(width) || width <= 0) return 'Vul een geldige opritbreedte in.'
  if (points.length < 2) return 'Teken minstens een lijnstuk voor de oprit.'
  if (points.length > 200) return 'Een oprit mag maximaal 200 punten bevatten.'
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return 'Een punt van het oprittraject is ongeldig.'
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) < 1) {
      return 'Plaats de punten verder uit elkaar.'
    }
    if (i > 1) {
      const a = points[i - 2], b = points[i - 1], c = points[i]
      const ax = b.x - a.x, ay = b.y - a.y, bx = c.x - b.x, by = c.y - b.y
      if ((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by)) < -0.99) {
        return 'Keer niet op dezelfde lijn terug.'
      }
    }
  }
  return null
}

export const createDriveway = (id: string, input: readonly Point[], width: number, material: DrivewayMaterial, curved: boolean): RectShape => {
  const points = cleanStairRoute(input)
  const error = drivewayRouteError(points, width)
  if (error) throw new Error(error)
  const x = Math.min(...points.map((p) => p.x)) - width / 2
  const y = Math.min(...points.map((p) => p.y)) - width / 2
  const w = Math.max(...points.map((p) => p.x)) - x + width / 2
  const h = Math.max(...points.map((p) => p.y)) - y + width / 2
  return {
    id, kind: 'rect', variant: 'driveway-route', start: { x, y }, end: { x: x + w, y: y + h },
    drivewayRoute: { points: points.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h })), width: width / Math.min(w, h) },
    drivewayMaterial: material, drivewayCurved: curved
  }
}

export const drivewayGeometry = (shape: RectShape): { path: string; width: number } => {
  const route = shape.drivewayRoute
  if (!route) return { path: '', width: 0 }
  const x = Math.min(shape.start.x, shape.end.x), y = Math.min(shape.start.y, shape.end.y)
  const w = Math.abs(shape.end.x - shape.start.x), h = Math.abs(shape.end.y - shape.start.y)
  const points = cleanStairRoute(route.points.map((p) => ({ x: x + p.x * w, y: y + p.y * h })))
  if (points.length < 2) return { path: '', width: 0 }
  const width = route.width * Math.min(w, h)
  const xy = (p: Point) => `${p.x} ${p.y}`
  let path = `M ${xy(points[0])}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    if (shape.drivewayCurved === false) { path += ` L ${xy(b)}`; continue }
    const before = Math.hypot(b.x - a.x, b.y - a.y), after = Math.hypot(c.x - b.x, c.y - b.y)
    const cut = Math.min(before / 2, after / 2, width * 1.5)
    const start = { x: b.x + (a.x - b.x) * cut / before, y: b.y + (a.y - b.y) * cut / before }
    const end = { x: b.x + (c.x - b.x) * cut / after, y: b.y + (c.y - b.y) * cut / after }
    path += ` L ${xy(start)} Q ${xy(b)} ${xy(end)}`
  }
  return { path: `${path} L ${xy(points[points.length - 1])}`, width }
}

export const drivewayPatterns = (monochrome = false): string => `
  <pattern id="driveway-cobbles" patternUnits="userSpaceOnUse" width="24" height="20">
    <rect width="24" height="20" fill="${monochrome ? '#b0b0b0' : '#a9a49a'}"/>
    <g fill="${monochrome ? '#d0d0d0' : '#cbc6bc'}" stroke="${monochrome ? '#888888' : '#8e897f'}" stroke-width=".6">
      <rect x="1" y="1" width="10" height="8" rx="2"/><rect x="13" y="1" width="10" height="8" rx="2"/>
      <rect x="-5" y="11" width="10" height="8" rx="2"/><rect x="7" y="11" width="10" height="8" rx="2"/><rect x="19" y="11" width="10" height="8" rx="2"/>
    </g>
  </pattern>
  <pattern id="driveway-gravel" patternUnits="userSpaceOnUse" width="24" height="24">
    <rect width="24" height="24" fill="${monochrome ? '#e0e0e0' : '#ded9ca'}"/>
    <g fill="${monochrome ? '#aaaaaa' : '#aaa498'}"><ellipse cx="4" cy="5" rx="2.3" ry="1.5"/><ellipse cx="15" cy="4" rx="1.5" ry="2"/><ellipse cx="9" cy="14" rx="2" ry="1.4"/><ellipse cx="20" cy="16" rx="2.5" ry="1.5"/><ellipse cx="2" cy="21" rx="1.4" ry="1.8"/></g>
  </pattern>
  <pattern id="driveway-pavers" patternUnits="userSpaceOnUse" width="28" height="16">
    <rect width="28" height="16" fill="${monochrome ? '#c0c0c0' : '#c8b9ac'}"/>
    <path d="M 0 0 H 28 M 0 8 H 28 M 0 16 H 28 M 0 0 V 8 M 14 0 V 8 M 28 0 V 8 M 7 8 V 16 M 21 8 V 16" fill="none" stroke="${monochrome ? '#808080' : '#88776b'}" stroke-width="0.9"/>
  </pattern>`

export const DRIVEWAY_PATTERNS = drivewayPatterns()
