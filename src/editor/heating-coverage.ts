import type { Point, RectShape, Shape } from './model/types.js'
import type { HeatingGrid, HeatingRoom } from './heating-routing.js'
import { segmentDistance } from './heating-distance.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { drawingLengthMetres, drawingUnitsForMetres } from './layout/drawing-scale.js'

export type HeatingCoverage = {
  rooms: { key: string; name: string; eligibleM2: number; coveredM2: number; gapM2: number; sampledMaxDistanceMm: number }[]
  gaps: Point[]; step: number
  signature?: string; stale?: boolean
}
export const heatingCoverageSignature = (shapes: readonly Shape[]) => JSON.stringify(shapes.filter((s) =>
  ['wall', 'door', 'gate', 'window', 'symbol'].includes(s.kind) || (s.kind === 'rect' && !s.heating && (s.locked || s.heatingObstacle !== undefined)) || ['pipe', 'manifold', 'exclusion'].includes(s.heating?.kind)).map((s: any) =>
  [s.id, s.kind, s.start, s.end, s.position, s.rotation, s.flipX, s.flipY, s.scale, s.path, s.hidden, s.locked, s.heatingObstacle, s.groupId, s.heating?.points,
    s.heating?.automatic, s.heating?.diameterMm, s.heating?.spacingMm, s.heating?.design?.minBendRadiusMm,
    s.heating?.kind === 'manifold' ? [s.heating.edgeMm, s.heating.capacity, s.heating.excludedRoomKeys] : null]))
export const heatingRoomKey = (room: HeatingRoom) => room.roomKey ?? `region-${room.id}`
const wallDistanceCache = new WeakMap<Uint8Array, Uint16Array>()
export const heatingWallDistances = (grid: HeatingGrid) => {
  const cached = wallDistanceCache.get(grid.wall)
  if (cached) return cached
  const distance = new Uint16Array(grid.wall.length).fill(65535), queue = new Int32Array(grid.wall.length)
  let read = 0, write = 0
  for (let i = 0; i < distance.length; i++) if (grid.wall[i]) { distance[i] = 0; queue[write++] = i }
  while (read < write) {
    const i = queue[read++], x = i % grid.width, y = Math.floor(i / grid.width)
    for (const n of [x ? i - 1 : -1, x + 1 < grid.width ? i + 1 : -1, y ? i - grid.width : -1, y + 1 < grid.height ? i + grid.width : -1]) {
      if (n >= 0 && distance[n] > distance[i] + 1) { distance[n] = distance[i] + 1; queue[write++] = n }
    }
  }
  wallDistanceCache.set(grid.wall, distance)
  return distance
}

/** Sample the actual rendered arcs and lines against free floor cells. This is a
 * geometric coverage check, independent of rectangular area allocations. */
export const measureHeatingCoverage = (grid: HeatingGrid, pipes: readonly RectShape[], scale: number, spacingMm: number,
  edgeMm = 100, checkpoint: () => void = () => {}, measureSpacing = true) => {
  const radius = drawingUnitsForMetres(spacingMm / 2000, scale) + grid.step * .75
  const bucket = Math.max(radius * 2, grid.step), distance = heatingWallDistances(grid)
  type Piece = { a: Point; b: Point; circuit: string; loop: boolean; pipe: string; primitive: number }
  const buckets = new Map<string, Piece[]>(), all: Piece[] = []
  for (const pipe of pipes) {
    checkpoint()
    if (pipe.hidden || pipe.heating?.kind !== 'pipe' || !pipe.heating.circuitId) continue
    for (const piece of heatingPipeGeometry(pipe).pieces) {
      const value = { a: piece.a, b: piece.b, circuit: pipe.heating.circuitId, loop: pipe.heating.pipeRole === 'loop', pipe: pipe.id, primitive: piece.primitive }; all.push(value)
      const minX = Math.floor((Math.min(piece.a.x, piece.b.x) - radius) / bucket), maxX = Math.floor((Math.max(piece.a.x, piece.b.x) + radius) / bucket)
      const minY = Math.floor((Math.min(piece.a.y, piece.b.y) - radius) / bucket), maxY = Math.floor((Math.max(piece.a.y, piece.b.y) + radius) / bucket)
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const key = `${x},${y}`, list = buckets.get(key) ?? []; list.push(value); buckets.set(key, list)
      }
    }
  }
  const cellM2 = drawingLengthMetres(grid.step, scale) ** 2, clearance = drawingUnitsForMetres(edgeMm / 1000, scale) / grid.step
  const areaByCircuit = new Map<string, number>(), gaps: Point[] = [], rooms: HeatingCoverage['rooms'] = []
  let visited = 0
  for (const room of grid.rooms) {
    let eligible = 0, covered = 0, maxDistance = 0, gapSamples = 0
    for (const cell of room.cells) {
      if (++visited % 2048 === 0) checkpoint()
      if (grid.obstacle[cell] || distance[cell] < clearance) continue
      eligible++
      const p = grid.point(cell), pieces = buckets.get(`${Math.floor(p.x / bucket)},${Math.floor(p.y / bucket)}`) ?? []
      let nearest = Infinity, circuit = ''
      for (const piece of pieces) {
        const d = segmentDistance(p, piece.a, piece.b)
        if (d < nearest) { nearest = d; circuit = piece.circuit }
      }
      if (nearest <= radius) {
        covered++; areaByCircuit.set(circuit, (areaByCircuit.get(circuit) ?? 0) + cellM2)
      } else {
        // Only gap cells need the wider nearest-neighbour query. Keep all cell
        // counts while bounding the stored overlay used by the editor/export.
        if (gaps.length < 2000) gaps.push(p)
        if ((eligible - covered) % 64 === 1 && gapSamples++ < 256) {
          checkpoint()
          for (const piece of all) nearest = Math.min(nearest, segmentDistance(p, piece.a, piece.b))
        }
      }
      if (Number.isFinite(nearest)) maxDistance = Math.max(maxDistance, nearest)
    }
    rooms.push({ key: heatingRoomKey(room), name: room.name, eligibleM2: eligible * cellM2,
      coveredM2: covered * cellM2, gapM2: (eligible - covered) * cellM2, sampledMaxDistanceMm: drawingLengthMetres(maxDistance, scale) * 1000 })
  }
  const spacingByCircuit = new Map<string, { min: number; max: number }>()
  const pitch = drawingUnitsForMetres(spacingMm / 1000, scale)
  for (const piece of measureSpacing ? all : []) {
    if (!piece.loop) continue
    const ux = piece.b.x - piece.a.x, uy = piece.b.y - piece.a.y, length = Math.hypot(ux, uy)
    if (length < pitch * 2) continue
    checkpoint()
    for (const t of [.25, .5, .75]) {
      const p = { x: piece.a.x + ux * t, y: piece.a.y + uy * t }, bx = Math.floor(p.x / bucket), by = Math.floor(p.y / bucket)
      let nearest = Infinity
      const checked = new Set<Piece>()
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
        if (!other.loop || checked.has(other) || (piece.pipe === other.pipe && Math.abs(piece.primitive - other.primitive) <= 1)) continue
        checked.add(other)
        const vx = other.b.x - other.a.x, vy = other.b.y - other.a.y, squared = vx * vx + vy * vy
        if (squared < pitch * pitch * 4 || Math.abs(ux * vy - uy * vx) > length * Math.sqrt(squared) * .01) continue
        const projection = ((p.x - other.a.x) * vx + (p.y - other.a.y) * vy) / squared
        if (projection <= 0 || projection >= 1) continue
        nearest = Math.min(nearest, segmentDistance(p, other.a, other.b))
      }
      if (nearest > pitch * 2 || !Number.isFinite(nearest)) continue
      const mm = drawingLengthMetres(nearest, scale) * 1000, value = spacingByCircuit.get(piece.circuit) ?? { min: Infinity, max: 0 }
      value.min = Math.min(value.min, mm); value.max = Math.max(value.max, mm); spacingByCircuit.set(piece.circuit, value)
    }
  }
  return { coverage: { rooms, gaps, step: grid.step } satisfies HeatingCoverage, areaByCircuit, spacingByCircuit }
}
