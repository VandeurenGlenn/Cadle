import { heatingGridRound, type HeatingGrid } from './heating-routing.js'

const grids = new WeakMap<HeatingGrid, { scale: number; fine: HeatingGrid }>()

/** Local entries and global leaders use the same 10 mm feed lattice. The
 * native architectural grid remains the authority for physical wall checks.
 * Heating grids are immutable snapshots during a planning attempt. */
export const heatingFeedGrid = (grid: HeatingGrid, scale: number, checkpoint: () => void = () => {}): HeatingGrid => {
  if (grid.step * scale / 8 <= 10.01 || grid.wall.length * 4 > 3600000) return grid
  const cached = grids.get(grid)
  if (cached?.scale === scale) return cached.fine
  const width = (grid.width - 1) * 2 + 1, height = (grid.height - 1) * 2 + 1, size = width * height
  const wall = new Uint8Array(size), door = new Uint8Array(size), obstacle = new Uint8Array(size), room = new Int32Array(size)
  for (let y = 0; y < height; y++) {
    if (y % 64 === 0) checkpoint()
    const yy = heatingGridRound(y / 2)
    for (let x = 0; x < width; x++) {
      const source = yy * grid.width + heatingGridRound(x / 2), cell = y * width + x
      wall[cell] = grid.wall[source]; door[cell] = grid.door[source]; obstacle[cell] = grid.obstacle[source]; room[cell] = grid.room[source]
    }
  }
  const step = grid.step / 2, origin = grid.origin
  const fine: HeatingGrid = { ...grid, width, height, step, wall, door, obstacle, loopObstacle: obstacle, room,
    point: (cell) => ({ x: origin.x + cell % width * step, y: origin.y + Math.floor(cell / width) * step }),
    index: (p) => { const x = heatingGridRound((p.x - origin.x) / step), y = heatingGridRound((p.y - origin.y) / step)
      return x < 0 || x >= width || y < 0 || y >= height ? -1 : y * width + x } }
  grids.set(grid, { scale, fine })
  return fine
}
