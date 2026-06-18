// Derived node-link model for walls. A "node" is a shared structural vertex:
// the point where one or more wall endpoints coincide. Nodes are NOT persisted
// objects — they are computed on demand from the canvas walls, so dragging a
// node simply moves every wall endpoint that meets there, keeping corners
// joined (a perfect V) without changing the storage model.
import { getWallEndpoints, type Point, type WallObject } from './wall-geometry.js'

export type WallNodeRef = { wall: WallObject; endIndex: 0 | 1 }

export type WallNode = {
  x: number
  y: number
  refs: WallNodeRef[]
}

const END_INDICES: ReadonlyArray<0 | 1> = [0, 1]

/**
 * Cluster the endpoints of all walls into shared vertices. Two endpoints within
 * `tolerance` px collapse into one node, which is what makes a corner a single
 * draggable vertex shared by both wall segments.
 */
export function collectWallNodes(walls: WallObject[], tolerance: number): WallNode[] {
  const nodes: WallNode[] = []
  const toleranceSquared = tolerance * tolerance

  for (const wall of walls) {
    // Poly walls expose every chain vertex as a draggable node, not just the
    // two endpoints. The endIndex encodes the wallPoints array index.
    const wallPoints = Array.isArray((wall as { wallPoints?: unknown }).wallPoints)
      ? (wall as { wallPoints: { x: number; y: number }[] }).wallPoints
      : null
    const wallLeft = Number(wall.left ?? 0)
    const wallTop = Number(wall.top ?? 0)

    if (wallPoints && wallPoints.length >= 2) {
      for (let i = 0; i < wallPoints.length; i++) {
        const point = { x: wallLeft + wallPoints[i].x, y: wallTop + wallPoints[i].y }
        const endIndex = i as 0 | 1
        let matched: WallNode | null = null
        for (const node of nodes) {
          const dx = node.x - point.x
          const dy = node.y - point.y
          if (dx * dx + dy * dy <= toleranceSquared) {
            matched = node
            break
          }
        }

        if (matched) {
          const count = matched.refs.length
          matched.x = (matched.x * count + point.x) / (count + 1)
          matched.y = (matched.y * count + point.y) / (count + 1)
          matched.refs.push({ wall, endIndex })
        } else {
          nodes.push({ x: point.x, y: point.y, refs: [{ wall, endIndex }] })
        }
      }

      continue
    }

    const endpoints = getWallEndpoints(wall)

    for (const endIndex of END_INDICES) {
      const point = endpoints[endIndex]
      let matched: WallNode | null = null

      for (const node of nodes) {
        const dx = node.x - point.x
        const dy = node.y - point.y
        if (dx * dx + dy * dy <= toleranceSquared) {
          matched = node
          break
        }
      }

      if (matched) {
        const count = matched.refs.length
        matched.x = (matched.x * count + point.x) / (count + 1)
        matched.y = (matched.y * count + point.y) / (count + 1)
        matched.refs.push({ wall, endIndex })
      } else {
        nodes.push({ x: point.x, y: point.y, refs: [{ wall, endIndex }] })
      }
    }
  }
  return nodes
}

/** Return the node closest to `point` within `tolerance` px, or null. */
export function findWallNodeAt(nodes: WallNode[], point: Point, tolerance: number): WallNode | null {
  let best: WallNode | null = null
  let bestDistanceSquared = tolerance * tolerance

  for (const node of nodes) {
    const dx = node.x - point.x
    const dy = node.y - point.y
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared <= bestDistanceSquared) {
      best = node
      bestDistanceSquared = distanceSquared
    }
  }
  return best
}

/** Unique walls touched by a node (a node may hold several endpoints). */
export function wallsForNode(node: WallNode): WallObject[] {
  const walls: WallObject[] = []

  for (const ref of node.refs) {
    if (!walls.includes(ref.wall)) walls.push(ref.wall)
  }
  return walls
}
