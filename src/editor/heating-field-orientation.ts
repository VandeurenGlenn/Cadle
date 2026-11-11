import type { HeatingGrid } from './heating-routing.js'
import { heatingWallAllowed, segmentDistance, simplifyHeatingPath } from './heating-routing.js'
import { openHeatingTurns, type HeatingSpiralField } from './heating-spiral.js'
import { createHeatingPipe, heatingDefaults } from './heating-plan.js'
import { heatingPipeGeometry } from './heating-geometry.js'
import { drawingUnitsForMetres, type DrawingScale } from './layout/drawing-scale.js'

/** Orient each field independently before joining them. A single global flip
 * cannot face both a tall cabinet recess and the neighbouring wide field toward
 * their shared approach. Measure access around the field, not through its coil. */
export const orientHeatingFields = (grid: HeatingGrid, fields: HeatingSpiralField[], sources: readonly number[],
  diameterMm: number, radiusMm: number, scale: DrawingScale, checkpoint: () => void, permittedWallCells: ReadonlySet<number> = new Set()) => {
  const walls = { allowWalls: true, permittedWallCells }
  const radius = drawingUnitsForMetres(radiusMm / 1000, scale), diameter = drawingUnitsForMetres(diameterMm / 1000, scale)
  const occupied = new Uint16Array(grid.wall.length)
  const masks = fields.map((field, i) => {
    const pipe = createHeatingPipe(`orient-${i}`, openHeatingTurns(simplifyHeatingPath(field.cells.map(grid.point)), radius, diameter),
      { ...heatingDefaults('pipe', scale), diameterMm, spacingMm: field.spacingMinMm, automatic: true, pipeRole: 'loop' })
    const cells = new Set<number>()
    for (const piece of heatingPipeGeometry(pipe).pieces) {
      const left = Math.max(0, Math.floor((Math.min(piece.a.x, piece.b.x) - diameter - grid.origin.x) / grid.step))
      const right = Math.min(grid.width - 1, Math.ceil((Math.max(piece.a.x, piece.b.x) + diameter - grid.origin.x) / grid.step))
      const top = Math.max(0, Math.floor((Math.min(piece.a.y, piece.b.y) - diameter - grid.origin.y) / grid.step))
      const bottom = Math.min(grid.height - 1, Math.ceil((Math.max(piece.a.y, piece.b.y) + diameter - grid.origin.y) / grid.step))
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const cell = y * grid.width + x
        if (segmentDistance(grid.point(cell), piece.a, piece.b) < diameter) cells.add(cell)
      }
    }
    for (const [end, near] of [[field.cells[0], field.cells[1]], [field.cells.at(-1)!, field.cells.at(-2)!]]) {
      const direction = end - near
      for (let n = 1; n < Math.ceil(radius / grid.step); n++) {
        const cell = end + direction * n
        if (cell >= 0 && cell < occupied.length) cells.add(cell)
      }
    }
    for (const cell of cells) occupied[cell]++
    return cells
  })
  const distance = new Int32Array(grid.wall.length), queue = new Int32Array(grid.wall.length)
  for (let index = 0; index < fields.length; index++) {
    checkpoint()
    const field = fields[index]
    if (field.doorAligned) continue
    const xs = field.cells.map((cell) => cell % grid.width), ys = field.cells.map((cell) => Math.floor(cell / grid.width))
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys)
    for (const cell of masks[index]) occupied[cell]--
    distance.fill(-1)
    let read = 0, write = 0
    for (const cell of sources) if (cell >= 0 && !occupied[cell] && distance[cell] < 0) { distance[cell] = 0; queue[write++] = cell }
    while (read < write) {
      if (read % 4096 === 0) checkpoint()
      const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
      for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
        if (next < 0 || distance[next] >= 0 || grid.obstacle[next] || !heatingWallAllowed(grid, next, walls) || occupied[next]) continue
        const xx = next % grid.width, yy = Math.floor(next / grid.width)
        if (xx >= left && xx <= right && yy >= top && yy <= bottom) continue
        distance[next] = distance[cell] + 1; queue[write++] = next
      }
    }
    let best = field.cells, score = Infinity, reflectedX = false, reflectedY = false
    for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const cells = field.cells.map((cell) => {
        const x = cell % grid.width, y = Math.floor(cell / grid.width)
        return (flipY ? top + bottom - y : y) * grid.width + (flipX ? left + right - x : x)
      })
      let cost = 0
      for (const [p, q] of [[cells[0], cells[1]], [cells.at(-1)!, cells.at(-2)!]]) {
        const direction = p - q, reach = Math.ceil(radius / grid.step)
        let end = p, valid = true
        for (let n = 1; n <= reach; n++) {
          const next = p + direction * n
          if (next < 0 || next >= distance.length || grid.obstacle[next] || !heatingWallAllowed(grid, next, walls) || occupied[next] || Math.abs(next % grid.width - end % grid.width) + Math.abs(Math.floor(next / grid.width) - Math.floor(end / grid.width)) !== 1) { valid = false; break }
          end = next
        }
        if (!valid || distance[end] < 0) { cost = Infinity; break }
        cost += distance[end] + reach
      }
      if (cost < score) { score = cost; best = cells; reflectedX = flipX; reflectedY = flipY }
    }
    field.cells = best
    // Subsequent fields must see this field at its selected orientation.
    // Bounding boxes stay unchanged; the tube mask is reflected with the path.
    const mask = new Set<number>()
    for (const cell of masks[index]) {
      const x = cell % grid.width, y = Math.floor(cell / grid.width)
      mask.add((reflectedY ? top + bottom - y : y) * grid.width + (reflectedX ? left + right - x : x))
    }
    masks[index] = mask
    for (const cell of mask) if (cell >= 0 && cell < occupied.length) occupied[cell]++
  }
}
