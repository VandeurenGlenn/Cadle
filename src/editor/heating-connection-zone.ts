import type { Point, Shape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'

/** Open ends around the chosen position, without a port fan or a mandatory
 * doorway. Door and wall costs still govern the approach to this small area. */
export const heatingConnectionZone = (grid: HeatingGrid, _shapes: readonly Shape[], position: Point, capacity: number,
  diameterMm: number, radiusMm: number, scale: number) => {
  const centre = grid.index(position)
  if (centre < 0 || grid.obstacle[centre]) throw new Error('Kies een vrije verdelerpositie.')
  const cx = centre % grid.width, cy = Math.floor(centre / grid.width)
  const separation = Math.max(1, Math.ceil(diameterMm * 1.2 * 8 / scale / grid.step))
  // About 25 cm from the position normally provides ample independent tails.
  // Grow only if fixtures or walls remove too many usable endpoints.
  for (const halfMm of [250, 350, 500, 750]) {
    const reach = Math.ceil(halfMm * 8 / scale / grid.step), stubs: number[][] = [], interior: number[] = [], reserved: number[] = []
    const apron = Math.ceil(radiusMm * 8 / scale / grid.step)
    for (let dy = -reach - apron; dy <= reach + apron; dy++) for (let dx = -reach - apron; dx <= reach + apron; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue
      const cell = y * grid.width + x, edge = Math.max(Math.abs(dx), Math.abs(dy))
      reserved.push(cell)
      if (edge < reach) interior.push(cell)
      if (edge !== reach || grid.obstacle[cell] || grid.wall[cell] && !grid.door[cell]) continue
      if ((Math.abs(dx) === reach ? dy + reach : dx + reach) % separation) continue
      stubs.push([cell])
    }
    if (stubs.length >= capacity * 2) return { stubs, interior, reserved, radiusMm: Math.ceil(Math.SQRT2 * reach * grid.step * scale / 8 / 50) * 50 }
  }
  throw new Error('Te weinig vrije plaats voor de open leidinguiteinden. Kies een vrijere verdelerpositie.')
}
