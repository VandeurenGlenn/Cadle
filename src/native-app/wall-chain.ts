import type { LineShape, Point } from '../native-draw/types.js'

export type WallChain = { startPoint: Point } | null

export type ResolveWallClickInput = {
  point: Point
  snapped: boolean
  now: number
  lastWallClickTime: number
  lastWallClickPoint: Point | null
  wallChain: WallChain
  nextId: () => string
}

export type ResolveWallClickResult = {
  snapTarget: Point | null
  lastWallClickTime: number
  lastWallClickPoint: Point | null
  wallChain: WallChain
  chainPreviewEnd: Point | null
  committedWall: LineShape | null
  ended: boolean
}

export const resolveWallChainClick = (input: ResolveWallClickInput): ResolveWallClickResult => {
  const snapTarget = input.snapped ? input.point : null
  const prevPt = input.lastWallClickPoint
  const isDouble =
    prevPt !== null &&
    input.now - input.lastWallClickTime < 400 &&
    Math.hypot(input.point.x - prevPt.x, input.point.y - prevPt.y) < 20

  if (isDouble) {
    return {
      snapTarget: null,
      lastWallClickTime: 0,
      lastWallClickPoint: null,
      wallChain: null,
      chainPreviewEnd: null,
      committedWall: null,
      ended: true
    }
  }

  if (input.wallChain === null) {
    return {
      snapTarget,
      lastWallClickTime: input.now,
      lastWallClickPoint: input.point,
      wallChain: { startPoint: input.point },
      chainPreviewEnd: input.point,
      committedWall: null,
      ended: false
    }
  }

  const candidateWall: LineShape = {
    id: input.nextId(),
    kind: 'wall',
    start: input.wallChain.startPoint,
    end: input.point
  }

  const committedWall =
    Math.hypot(candidateWall.end.x - candidateWall.start.x, candidateWall.end.y - candidateWall.start.y) >= 4
      ? candidateWall
      : null

  return {
    snapTarget,
    lastWallClickTime: input.now,
    lastWallClickPoint: input.point,
    wallChain: { startPoint: input.point },
    chainPreviewEnd: input.point,
    committedWall,
    ended: false
  }
}
