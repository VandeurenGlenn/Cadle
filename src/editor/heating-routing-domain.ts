import Clipper from 'clipper-lib'
import type { RectShape } from './model/types.js'
import type { HeatingGrid } from './heating-routing.js'
import { heatingPipeGeometry } from './heating-geometry.js'

type Vertex = { X: number; Y: number }
const precision = 1000
const outlines = new WeakMap<RectShape, { signature: string; paths: Vertex[][] }>()

/** Close the narrow gaps between a field's parallel heating runs, then restore
 * its outer edge. Feed searches stay outside other heating fields instead of
 * exploring their long, dead-end spiral channels. Concavities and room holes
 * remain; a thin connector between two fields collapses during the inset. */
const footprint = (pipe: RectShape) => {
  const data = pipe.heating!, signature = JSON.stringify([pipe.start, pipe.end, pipe.rotation, pipe.flipX, pipe.flipY,
    data.points, data.spacingMm, data.diameterMm, data.design?.minBendRadiusMm, data.bendRadiusMm, data.drawingScale])
  const cached = outlines.get(pipe)
  if (cached?.signature === signature) return cached.paths
  const geometry = heatingPipeGeometry(pipe), path = geometry.pieces.map((piece) => piece.a)
  if (geometry.pieces.length) path.push(geometry.pieces.at(-1)!.b)
  if (path.length < 2) return []
  const distance = (data.spacingMm + data.diameterMm) * 4 / data.drawingScale * precision
  const grow = new Clipper.ClipperOffset(2, .02 * precision), filled: Vertex[][] = []
  grow.AddPath(path.map((p) => ({ X: Math.round(p.x * precision), Y: Math.round(p.y * precision) })), Clipper.JoinType.jtRound, Clipper.EndType.etOpenRound)
  grow.Execute(filled, distance)
  const shrink = new Clipper.ClipperOffset(2, .02 * precision), result: Vertex[][] = []
  shrink.AddPaths(filled, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon)
  shrink.Execute(result, -distance)
  const paths = Clipper.Clipper.CleanPolygons(result, .02 * precision) as Vertex[][]
  outlines.set(pipe, { signature, paths }); return paths
}

export const heatingFieldFootprintMask = (grid: HeatingGrid, pipes: readonly RectShape[]) => {
  if (pipes.length > 31) return undefined
  const mask = new Uint32Array(grid.width * grid.height)
  for (const [index, pipe] of pipes.entries()) {
    const paths = footprint(pipe)
    if (!paths.length) continue
    let minY = Infinity, maxY = -Infinity
    for (const ring of paths) for (const p of ring) { minY = Math.min(minY, p.Y / precision); maxY = Math.max(maxY, p.Y / precision) }
    const first = Math.max(0, Math.ceil((minY - grid.origin.y) / grid.step)), last = Math.min(grid.height - 1, Math.floor((maxY - grid.origin.y) / grid.step))
    for (let row = first; row <= last; row++) {
      const y = (grid.origin.y + row * grid.step) * precision, xs: number[] = []
      for (const ring of paths) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        if ((a.Y > y) !== (b.Y > y)) xs.push((a.X + (b.X - a.X) * (y - a.Y) / (b.Y - a.Y)) / precision)
      }
      xs.sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i += 2) {
        const left = Math.max(0, Math.ceil((xs[i - 1] - grid.origin.x) / grid.step)), right = Math.min(grid.width - 1, Math.floor((xs[i] - grid.origin.x) / grid.step))
        for (let col = left; col <= right; col++) mask[row * grid.width + col] |= 1 << index
      }
    }
  }
  return mask
}
