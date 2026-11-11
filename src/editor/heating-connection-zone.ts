import type { Point, Shape } from './model/types.js'
import { heatingSharedDoors, heatingSourceRoom, type HeatingGrid } from './heating-routing.js'

/** Open tails stay in the source room and face its exit, without assigning
 * hardware ports. The marked position remains the reference for the open zone. */
export const heatingConnectionZone = (grid: HeatingGrid, _shapes: readonly Shape[], position: Point, capacity: number,
  diameterMm: number, radiusMm: number, scale: number) => {
  const centre = grid.index(position)
  if (centre < 0 || grid.obstacle[centre]) throw new Error('Kies een vrije verdelerpositie.')
  const sourceRegion = heatingSourceRoom(grid, position)
  const sourceRoom = sourceRegion?.id ?? grid.room[centre]
  const cx = centre % grid.width, cy = Math.floor(centre / grid.width), cellMm = grid.step * scale / 8
  const separation = Math.max(1, Math.ceil(diameterMm * 1.2 / cellMm)), apron = Math.ceil(radiusMm / cellMm)
  const width = Math.ceil(Math.max(600, capacity * 75 + 100) / cellMm), halfHeight = Math.ceil(150 / cellMm)
  const boxes = [
    { left: cx, right: cx + width, top: cy - halfHeight, bottom: cy + halfHeight },
    { left: cx - width, right: cx, top: cy - halfHeight, bottom: cy + halfHeight },
    { left: cx - halfHeight, right: cx + halfHeight, top: cy, bottom: cy + width },
    { left: cx - halfHeight, right: cx + halfHeight, top: cy - width, bottom: cy }
  ]
  if (sourceRegion) {
    const near = sourceRegion.cells.filter((cell) => grid.door[cell]).sort((a, b) => {
      const p = grid.point(a), q = grid.point(b)
      return Math.hypot(p.x - position.x, p.y - position.y) - Math.hypot(q.x - position.x, q.y - position.y)
    })[0]
    if (near !== undefined) {
      const opening = [...heatingSharedDoors(grid, [near])], xs = opening.map((cell) => cell % grid.width), ys = opening.map((cell) => Math.floor(cell / grid.width))
      const x = Math.round(xs.reduce((sum, n) => sum + n, 0) / xs.length), y = Math.round(ys.reduce((sum, n) => sum + n, 0) / ys.length)
      const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
      for (const sign of [1, -1]) {
        for (let n = 1; n <= apron + halfHeight * 2; n++) {
          const xx = x + (horizontal ? 0 : sign * n), yy = y + (horizontal ? sign * n : 0)
          if (xx < 0 || yy < 0 || xx >= grid.width || yy >= grid.height) break
          const cell = yy * grid.width + xx
          if (grid.room[cell] !== sourceRoom || grid.wall[cell] || grid.obstacle[cell]) continue
          if (horizontal) {
            const edge = yy + sign * apron
            boxes.unshift({ left: x - Math.floor(width / 2), right: x + Math.ceil(width / 2), top: sign > 0 ? edge : edge - halfHeight * 2, bottom: sign > 0 ? edge + halfHeight * 2 : edge })
          } else {
            const edge = xx + sign * apron
            boxes.unshift({ top: y - Math.floor(width / 2), bottom: y + Math.ceil(width / 2), left: sign > 0 ? edge : edge - halfHeight * 2, right: sign > 0 ? edge + halfHeight * 2 : edge })
          }
          break
        }
      }
    }
  }
  for (const box of boxes) {
    const stubs: number[][] = [], interior: number[] = [], reserved: number[] = []
    for (let y = box.top - apron; y <= box.bottom + apron; y++) for (let x = box.left - apron; x <= box.right + apron; x++) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue
      const cell = y * grid.width + x
      reserved.push(cell)
      if (x > box.left && x < box.right && y > box.top && y < box.bottom) interior.push(cell)
      const vertical = x === box.left || x === box.right, horizontal = y === box.top || y === box.bottom
      if ((!vertical && !horizontal) || vertical && horizontal || x < box.left || x > box.right || y < box.top || y > box.bottom) continue
      if (grid.obstacle[cell] || grid.wall[cell] && !grid.door[cell] || (vertical ? y - box.top : x - box.left) % separation) continue
      const direction = vertical ? x === box.left ? -1 : 1 : y === box.top ? -grid.width : grid.width
      const stub = Array.from({ length: apron + 1 }, (_, n) => cell + direction * n)
      if (stub.every((c) => c >= 0 && c < grid.wall.length && !grid.obstacle[c] && (!grid.wall[c] || grid.door[c]) && (sourceRoom <= 0 || grid.room[c] === sourceRoom))) stubs.push(stub)
    }
    if (stubs.length < capacity * 2) continue
    const a = grid.point(box.top * grid.width + box.left), b = grid.point(box.bottom * grid.width + box.right)
    const bounds = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
    return { stubs, interior, reserved, bounds, radiusMm: Math.ceil(Math.max(...stubs.map(([cell]) => {
      const p = grid.point(cell); return Math.hypot(p.x - position.x, p.y - position.y) * scale / 8
    })) / 50) * 50 }
  }
  throw new Error('Te weinig vrije plaats voor de open leidinguiteinden. Kies een vrijere verdelerpositie.')
}
