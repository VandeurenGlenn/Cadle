import { heatingWallAllowed, type HeatingGrid } from './heating-routing.js'

/** Native doors and furnishings determine lead length before fields are split.
 * A straight-line estimate cannot see a shaft or a bank of fixed cupboards. */
export const heatingAccessDistances = (grid: HeatingGrid, sources: readonly number[], permittedWallCells: ReadonlySet<number>, inside: boolean,
  checkpoint: () => void) => {
  const distances = new Int32Array(grid.wall.length).fill(-1), queue = new Int32Array(grid.wall.length)
  const options = { allowWalls: true, permittedWallCells }
  let read = 0, write = 0
  const free = (cell: number) => cell >= 0 && cell < distances.length && !grid.obstacle[cell] && (!inside || grid.room[cell] >= 0) && heatingWallAllowed(grid, cell, options)
  for (const cell of sources) if (free(cell) && distances[cell] < 0) { distances[cell] = 0; queue[write++] = cell }
  while (read < write) {
    if (read % 4096 === 0) checkpoint()
    const cell = queue[read++], x = cell % grid.width, y = Math.floor(cell / grid.width)
    for (const next of [x ? cell - 1 : -1, x + 1 < grid.width ? cell + 1 : -1, y ? cell - grid.width : -1, y + 1 < grid.height ? cell + grid.width : -1]) {
      if (!free(next) || distances[next] >= 0) continue
      distances[next] = distances[cell] + 1; queue[write++] = next
    }
  }
  return distances
}
