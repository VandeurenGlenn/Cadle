// Wall + opening geometry helpers extracted from `src/fields/draw.ts`.
//
// All functions in this module are pure: they take the canvas / configuration
// values they need as parameters and produce values without touching any
// instance state. `DrawField` keeps thin private wrappers that pass
// `this.canvas`, `this.gridSize`, `this.freeDraw`, etc. so call sites inside
// the Lit element are unchanged.
//
// Behavior MUST stay identical to the original inlined implementations —
// changing geometry semantics here is out of scope for the refactor pass.
import type { FabricObject } from 'fabric'
import type { Canvas } from '../../fabric-imports.js'
import CadleWall from '../../symbols/wall.js'
import CadleDoor from '../../symbols/door.js'
import CadleWindow from '../../symbols/window.js'
import CadleGate from '../../symbols/gate.js'
import { getWallEndpoints, type Point, type WallObject } from './wall-geometry.js'

export { getWallEndpoints }
export type { Point, WallObject }

type OpeningTarget = FabricObject & {
  type?: string
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  doorSwingDirection?: string
  doorHingeSide?: string
}

function snapToGrid(point: LeftTop, gridSize: number): LeftTop {
  return {
    left: Math.round(point.left / gridSize) * gridSize,
    top: Math.round(point.top / gridSize) * gridSize
  }
}

export type LeftTop = { left: number; top: number }
export type WallBounds = {
  left: number
  top: number
  width: number
  height: number
  horizontal: boolean
}
export type WallSnap = {
  wall: WallObject
  bounds: WallBounds
  distance: number
  score: number
}

export type WallAxisFrame = {
  p0: Point
  p1: Point
  length: number
  angleDeg: number
  thickness: number
  isFreeAngle: boolean
}

export function getWallAxisFrame(wall: WallObject): WallAxisFrame {
  const [p0, p1] = getWallEndpoints(wall)
  const vx = p1.x - p0.x
  const vy = p1.y - p0.y
  const length = Math.max(1, Math.hypot(vx, vy))
  const angleDeg = (Math.atan2(vy, vx) * 180) / Math.PI
  const w = Math.abs(Number(wall.width ?? 0)) * Number(wall.scaleX ?? 1)
  const h = Math.abs(Number(wall.height ?? 0)) * Number(wall.scaleY ?? 1)
  const fabricAngle = Number(wall.angle ?? 0)
  const originY = wall.originY ?? 'top'
  const isFreeAngle = originY === 'center' || (fabricAngle !== 0 && fabricAngle !== 180)
  const explicitThickness = Number(wall.wallThickness ?? 0)
  // For free-angle walls thickness is `height`. For axis-aligned, the
  // perpendicular dim is the thickness.
  const thickness = explicitThickness > 0 ? explicitThickness : isFreeAngle ? h : w >= h ? h : w
  return { p0, p1, length, angleDeg, thickness, isFreeAngle }
}

function projectPointOnAxis(point: LeftTop, frame: WallAxisFrame): { t: number; cx: number; cy: number } {
  const { p0, p1, length } = frame
  const vx = p1.x - p0.x
  const vy = p1.y - p0.y
  const dx = point.left - p0.x
  const dy = point.top - p0.y
  let t = (dx * vx + dy * vy) / (length * length)
  if (!isFinite(t)) t = 0
  t = Math.min(1, Math.max(0, t))
  return { t, cx: p0.x + t * vx, cy: p0.y + t * vy }
}

export type OpeningLayout = {
  left: number
  top: number
  width: number
  height: number
  horizontal: boolean
  wallThickness: number
  angle?: number
  originX?: 'left' | 'center' | 'right'
  originY?: 'top' | 'center' | 'bottom'
  dx?: number
  dy?: number
}

type OpeningUpdate = {
  left: number
  top: number
  width: number
  height: number
  scaleX: number
  scaleY: number
  angle: number
  originX: 'left' | 'center' | 'right'
  originY: 'top' | 'center' | 'bottom'
  wallThickness?: number
  doorSwingDirection?: 'up' | 'down' | 'left' | 'right'
  doorHingeSide?: 'left' | 'right' | 'top' | 'bottom'
}

// Fabric v6 ignores `set('type', 'CadleWall')` (warns "Setting type has
// no effect") so we cannot rely on obj.type alone — fall back to instanceof
// which is reliable across construction and JSON load paths.
export function isWallObject(obj: FabricObject | null | undefined): obj is WallObject {
  if (!obj) return false
  if (obj instanceof CadleWall) return true
  return obj.type === 'CadleWall'
}

export function isOpeningObject(obj: FabricObject | null | undefined): boolean {
  if (!obj) return false
  if (obj instanceof CadleDoor || obj instanceof CadleWindow || obj instanceof CadleGate) return true
  return obj.type === 'CadleDoor' || obj.type === 'CadleWindow' || obj.type === 'CadleGate'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function alignToPixel(value: number): number {
  return Math.round(value)
}

export function wallThickness(gridSize: number): number {
  const rawThickness = Math.max(2, gridSize)
  // Keep wall thickness even so centering doesn't land on half-pixels.
  return rawThickness % 2 === 0 ? rawThickness : rawThickness + 1
}

/**
 * Return the two endpoints (in canvas coords) of a wall, supporting both
 * axis-aligned legacy walls (origin top-left, no angle) and free-angle walls
 * (origin left/center + angle). Implementation lives in `wall-geometry.ts`
 * (re-exported above) so `symbols/wall.ts` can consume it without an import
 * cycle.
 */

export function getWallBounds(wall: WallObject): WallBounds {
  const bounds = wall?.getBoundingRect?.()
  const left = Number(bounds?.left ?? wall?.left ?? 0)
  const top = Number(bounds?.top ?? wall?.top ?? 0)
  const width = Math.abs(Number(bounds?.width ?? wall?.width ?? 0))
  const height = Math.abs(Number(bounds?.height ?? wall?.height ?? 0))
  return {
    left,
    top,
    width,
    height,
    horizontal: width >= height
  }
}

/**
 * Move one endpoint of a wall to a target point, keeping the opposite
 * endpoint fixed and preserving thickness. Supports angled walls (origin
 * left/center + angle); axis-aligned walls keep their legacy shape.
 */
export function applyWallEndpoint(wall: WallObject, endIndex: 0 | 1, point: Point, gridSize: number): void {
  // Poly wall: move the specific wallPoints vertex, then recompute bounding box.
  const wallPoints = Array.isArray((wall as { wallPoints?: unknown }).wallPoints)
    ? (wall as { wallPoints: { x: number; y: number }[] }).wallPoints
    : null
  if (wallPoints && wallPoints.length >= 2 && endIndex < wallPoints.length) {
    const wallLeft = Number(wall.left ?? 0)
    const wallTop = Number(wall.top ?? 0)
    // Move this vertex in canvas coords.
    wallPoints[endIndex] = { x: alignToPixel(point.x - wallLeft), y: alignToPixel(point.y - wallTop) }
    // Recompute bounding box from all vertices so Fabric hit-testing stays correct.
    const xs = wallPoints.map((p) => wallLeft + p.x)
    const ys = wallPoints.map((p) => wallTop + p.y)
    const newLeft = Math.min(...xs)
    const newTop = Math.min(...ys)
    const newWidth = Math.max(1, Math.max(...xs) - newLeft)
    const newHeight = Math.max(1, Math.max(...ys) - newTop)
    // Shift wallPoints to new origin.
    const shiftedPoints = wallPoints.map((p) => ({ x: wallLeft + p.x - newLeft, y: wallTop + p.y - newTop }))
    wall.set({ left: newLeft, top: newTop, width: newWidth, height: newHeight, wallPoints: shiftedPoints } as object)
    wall.setCoords?.()
    return
  }

  const endpoints = getWallEndpoints(wall)
  const fixed = endpoints[1 - endIndex]
  const angle = Number(wall.angle ?? 0)
  const originY = wall.originY ?? 'top'
  const isFreeAngle = originY === 'center' || (angle !== 0 && angle !== 180)
  const width = Math.abs(Number(wall.width ?? 0)) * Number(wall.scaleX ?? 1)
  const height = Math.abs(Number(wall.height ?? 0)) * Number(wall.scaleY ?? 1)
  const thickness = isFreeAngle ? height : width >= height ? height : width

  // If the resulting segment would not be axis-aligned with the fixed
  // endpoint (within a small tolerance), promote the wall to free-angle so
  // it rotates to follow the connected join. Otherwise the legacy
  // horizontal/vertical branches would flatten the wall onto the dominant
  // axis, place it through the fixed endpoint at a wrong offset, and visually
  // "disappear" the connection.
  const dxToFixed = point.x - fixed.x
  const dyToFixed = point.y - fixed.y
  const axisTol = 1
  const wouldBeAxisAligned = Math.abs(dxToFixed) <= axisTol || Math.abs(dyToFixed) <= axisTol
  const useFreeAngle = isFreeAngle || !wouldBeAxisAligned

  if (useFreeAngle) {
    const length = Math.max(gridSize, Math.hypot(dxToFixed, dyToFixed))
    const newAngleDeg = (Math.atan2(dyToFixed, dxToFixed) * 180) / Math.PI
    wall.set({
      left: alignToPixel(fixed.x),
      top: alignToPixel(fixed.y),
      width: alignToPixel(length),
      height: thickness,
      angle: newAngleDeg,
      originX: 'left',
      originY: 'center',
      scaleX: 1,
      scaleY: 1
    })
    wall.setCoords?.()
    return
  }

  const horizontal = Math.abs(dxToFixed) >= Math.abs(dyToFixed)
  if (horizontal) {
    const minX = Math.min(point.x, fixed.x)
    const maxX = Math.max(point.x, fixed.x)
    const newWidth = Math.max(gridSize, maxX - minX)
    wall.set({
      left: alignToPixel(minX),
      top: alignToPixel(fixed.y),
      width: alignToPixel(newWidth),
      height: thickness,
      scaleX: 1,
      scaleY: 1
    })
  } else {
    const minY = Math.min(point.y, fixed.y)
    const maxY = Math.max(point.y, fixed.y)
    const newHeight = Math.max(gridSize, maxY - minY)
    wall.set({
      left: alignToPixel(fixed.x),
      top: alignToPixel(minY),
      width: thickness,
      height: alignToPixel(newHeight),
      scaleX: 1,
      scaleY: 1
    })
  }

  wall.setCoords?.()
}

/**
 * Snapshot which other walls share an endpoint with the wall the user just
 * grabbed. The returned connections are replayed during object:moving so the
 * connected walls stretch along with the move.
 */
export function collectWallConnections(
  canvas: Canvas,
  wall: WallObject
): Array<{ wall: WallObject; movedEndIndex: 0 | 1; connectedEndIndex: 0 | 1 }> {
  const movedEndpoints = getWallEndpoints(wall)
  // Tight tolerance: drawing snaps endpoints to pixel-aligned coordinates, so
  // truly connected walls match within a couple of pixels. A loose tolerance
  // (e.g. gridSize/2) caused unrelated walls that just happened to sit near
  // each other to be dragged along.
  const tol = 3
  const connections: Array<{ wall: WallObject; movedEndIndex: 0 | 1; connectedEndIndex: 0 | 1 }> = []
  for (const other of canvas.getObjects()) {
    if (other === wall || !isWallObject(other)) continue
    const otherEndpoints = getWallEndpoints(other)
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const dx = movedEndpoints[i].x - otherEndpoints[j].x
        const dy = movedEndpoints[i].y - otherEndpoints[j].y
        if (Math.hypot(dx, dy) <= tol) {
          connections.push({ wall: other, movedEndIndex: i as 0 | 1, connectedEndIndex: j as 0 | 1 })
        }
      }
    }
  }
  return connections
}

export function findNearestWall(canvas: Canvas, point: LeftTop, maxDistance: number): WallSnap | null {
  const walls = canvas.getObjects().filter((obj): obj is WallObject => !!obj && isWallObject(obj))
  let best: WallSnap | null = null

  for (const wall of walls) {
    const bounds = getWallBounds(wall)
    if (!bounds.width || !bounds.height) continue

    const frame = getWallAxisFrame(wall)
    const projection = projectPointOnAxis(point, frame)
    const onSegment = projection.t >= 0 && projection.t <= 1
    const segmentPoint = onSegment ? { x: projection.cx, y: projection.cy } : projection.t < 0 ? frame.p0 : frame.p1

    const distance = Math.hypot(point.left - segmentPoint.x, point.top - segmentPoint.y)
    if (distance > maxDistance) continue

    const insideBody = onSegment
    const insidePenalty = insideBody ? 0 : 1
    const score = insidePenalty * 1000 + distance

    if (!best || score < best.score) {
      best = { wall, bounds, distance, score }
    }
  }
  return best
}

export type SnapType = 'endpoint' | 'preview-endpoint' | 'midpoint' | 'axis'
export type SnapResult = LeftTop & { type: SnapType }

// Snap a point to the nearest existing wall endpoint, midpoint, or axis line
// so that connected walls form clean corners and T-junctions. Snap radius is
// expressed in SCREEN pixels (industry standard ~10-12px) and converted to
// world coordinates via the canvas zoom, so the cursor doesn't have to be
// pixel-perfect when zoomed out, and doesn't grab unrelated walls when
// zoomed in.
// Endpoint and axis snapping intentionally use different radii:
// - Endpoints: a bit more forgiving so wall joins are easy to hit.
// - Axis/midpoint: tighter so preview/cursor doesn't feel overly sticky.
export function snapWallEndpoint(
  canvas: Canvas,
  point: LeftTop,
  ignore: WallObject | null,
  gridSize: number,
  isPreview: boolean = false,
  freeDraw: boolean = false
): SnapResult | null {
  const walls = canvas.getObjects().filter((obj): obj is WallObject => !!obj && isWallObject(obj) && obj !== ignore)
  const zoom = typeof canvas.getZoom === 'function' ? canvas.getZoom() : 1
  const zoomSafe = Math.max(zoom, 0.01)
  const endpointScreenRadius = isPreview ? 5 : 10
  const axisScreenRadius = isPreview ? 4 : 8
  const endpointMinRadius = isPreview ? Math.max(4, gridSize * 0.45) : Math.max(6, gridSize * 0.75)
  const axisMinRadius = isPreview ? Math.max(3, gridSize * 0.35) : Math.max(4, gridSize * 0.55)
  const endpointRadius = Math.max(endpointScreenRadius / zoomSafe, endpointMinRadius)
  const axisRadius = Math.max(axisScreenRadius / zoomSafe, axisMinRadius)

  let closestEndpoint: SnapResult | null = null
  let minEndpointDistance = Infinity
  for (const wall of walls) {
    const endpoints = getWallEndpoints(wall)
    for (const endpoint of endpoints) {
      const distance = Math.hypot(point.left - endpoint.x, point.top - endpoint.y)
      if (distance <= endpointRadius && distance < minEndpointDistance) {
        closestEndpoint = {
          left: endpoint.x,
          top: endpoint.y,
          type: isPreview ? 'preview-endpoint' : 'endpoint'
        }
        minEndpointDistance = distance
      }
    }
  }

  if (closestEndpoint) return closestEndpoint

  let closest: SnapResult | null = null
  let minDistance = Infinity
  for (const wall of walls) {
    const frame = getWallAxisFrame(wall)
    const proj = projectPointOnAxis(point, frame)
    const distance = Math.hypot(point.left - proj.cx, point.top - proj.cy)
    if (distance <= axisRadius && distance < minDistance) {
      const midpointTolerance = 0.12
      const snapType: SnapType = Math.abs(proj.t - 0.5) <= midpointTolerance ? 'midpoint' : 'axis'
      closest = {
        left: proj.cx,
        top: proj.cy,
        type: snapType
      }
      minDistance = distance
    }
  }

  if (closest) return closest

  if (freeDraw) return { left: point.left, top: point.top, type: 'axis' }

  const gridSnap = snapToGrid(point, gridSize)
  return { ...gridSnap, type: 'axis' }
}

// Default opening sizes (in canvas pixels). 50px ≈ 1m at the standard scale.
export function getOpeningDefaultLength(action: string | undefined, gridSize: number): number {
  if (action === 'draw-door') return Math.max(gridSize * 2, 40) // ~80cm
  if (action === 'draw-window') return Math.max(gridSize * 2, 50) // ~100cm
  if (action === 'draw-gate') return Math.max(gridSize * 4, 100) // ~200cm
  return gridSize * 2
}

export type ProjectOptions = {
  freeDraw: boolean
  snap: (value: number) => number
}

export function projectPointToWall(
  point: LeftTop,
  wallSnap: { bounds: WallBounds; wall?: WallObject },
  opts: ProjectOptions
): LeftTop {
  const { bounds } = wallSnap
  const snapAxis = (value: number) => {
    if (opts.freeDraw) return value
    return opts.snap(value)
  }

  // Free-angle walls: project along the actual wall axis.
  if (wallSnap.wall) {
    const frame = getWallAxisFrame(wallSnap.wall)
    if (frame.isFreeAngle) {
      const proj = projectPointOnAxis(point, frame)
      return { left: proj.cx, top: proj.cy }
    }
  }

  if (bounds.horizontal) {
    const projectedLeft = clamp(point.left, bounds.left, bounds.left + bounds.width)
    return {
      left: snapAxis(projectedLeft),
      top: bounds.top
    }
  }

  const projectedTop = clamp(point.top, bounds.top, bounds.top + bounds.height)
  return {
    left: bounds.left,
    top: snapAxis(projectedTop)
  }
}

// Compute the opening rectangle for a click-to-place opening centered on
// the projected click point along the snapped wall.
export function getCenteredOpeningLayout(
  action: string | undefined,
  clickPoint: LeftTop,
  wallSnap: { bounds: WallBounds; wall?: WallObject },
  gridSize: number,
  opts: ProjectOptions
): OpeningLayout {
  const { bounds } = wallSnap
  const length = getOpeningDefaultLength(action, gridSize)

  if (wallSnap.wall) {
    const frame = getWallAxisFrame(wallSnap.wall)
    if (frame.isFreeAngle) {
      // Project click onto wall axis, clamp the opening so its full width
      // stays inside the wall length.
      const proj = projectPointOnAxis(clickPoint, frame)
      const halfL = length / 2 / frame.length // in t units
      const tCenter = clamp(proj.t, halfL, 1 - halfL)
      const cx = frame.p0.x + tCenter * (frame.p1.x - frame.p0.x)
      const cy = frame.p0.y + tCenter * (frame.p1.y - frame.p0.y)
      return {
        left: alignToPixel(cx),
        top: alignToPixel(cy),
        width: alignToPixel(length),
        height: alignToPixel(frame.thickness),
        horizontal: true,
        wallThickness: frame.thickness,
        angle: frame.angleDeg,
        originX: 'center',
        originY: 'center'
      }
    }
  }

  const projected = projectPointToWall(clickPoint, wallSnap, opts)

  if (bounds.horizontal) {
    const left = clamp(projected.left - length / 2, bounds.left, bounds.left + bounds.width - length)
    return {
      left: alignToPixel(left),
      top: alignToPixel(bounds.top),
      width: alignToPixel(length),
      height: alignToPixel(bounds.height),
      horizontal: true,
      wallThickness: bounds.height
    }
  }

  const top = clamp(projected.top - length / 2, bounds.top, bounds.top + bounds.height - length)
  return {
    left: alignToPixel(bounds.left),
    top: alignToPixel(top),
    width: alignToPixel(bounds.width),
    height: alignToPixel(length),
    horizontal: false,
    wallThickness: bounds.width
  }
}

export function getWallDrawLayout(
  canvas: Canvas,
  startPoint: LeftTop,
  currentPoint: LeftTop,
  gridSize: number,
  ignore?: WallObject | null
) {
  // Snap both endpoints to existing walls for clean joins.
  const startSnap = snapWallEndpoint(canvas, startPoint, ignore, gridSize)
  const endSnap = snapWallEndpoint(canvas, currentPoint, ignore, gridSize)
  const start = startSnap ?? startPoint
  const snappedEnd = endSnap ?? currentPoint
  const dx = snappedEnd.left - start.left
  const dy = snappedEnd.top - start.top
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)
  const thickness = wallThickness(gridSize)

  // NOTE: We deliberately do NOT extend the wall body past the snapped
  // endpoints. Doing so was tried before and caused the geometric endpoint
  // to drift away from the snap point by t/2, which broke
  // `collectWallConnections` (3px tolerance) and the bound-wall move/resize
  // behavior.

  if (absDx >= absDy) {
    // Horizontal wall.
    const minX = Math.min(start.left, snappedEnd.left)
    const maxX = Math.max(start.left, snappedEnd.left)
    return {
      left: alignToPixel(minX),
      top: alignToPixel(start.top),
      width: alignToPixel(Math.max(gridSize, maxX - minX)),
      height: thickness,
      rx: Math.min(4, thickness / 2),
      ry: Math.min(4, thickness / 2),
      angle: 0,
      originX: 'left' as const,
      originY: 'top' as const
    }
  }

  // Vertical wall.
  const minY = Math.min(start.top, snappedEnd.top)
  const maxY = Math.max(start.top, snappedEnd.top)
  return {
    left: alignToPixel(start.left),
    top: alignToPixel(minY),
    width: thickness,
    height: alignToPixel(Math.max(gridSize, maxY - minY)),
    rx: Math.min(4, thickness / 2),
    ry: Math.min(4, thickness / 2),
    angle: 0,
    originX: 'left' as const,
    originY: 'top' as const
  }
}

/**
 * Free-angle wall layout used when the user holds Shift while drawing.
 * Origin stays left/top (non-centered) and width equals the true wall length,
 * so (left, top) is the exact start endpoint and connection math stays exact.
 * Diagonal corner gaps are closed at render time in `CadleWall._render`, which
 * projects the body half a thickness along the axis at joined ends only.
 * Auto-snaps to the nearest 15° within a 7° tolerance, AND hard-snaps to
 * 0/90/180/270 within 4° so straight walls stay easy.
 */
export function getWallDrawLayoutFree(
  canvas: Canvas,
  startPoint: LeftTop,
  currentPoint: LeftTop,
  gridSize: number,
  ignore?: WallObject | null
) {
  // Allow snapping both endpoints to nearby existing wall endpoints.
  const startSnap = snapWallEndpoint(canvas, startPoint, ignore, gridSize, false, true)
  const endSnap = snapWallEndpoint(canvas, currentPoint, ignore, gridSize, false, true)
  const start = startSnap ?? startPoint
  const snappedEnd = endSnap ?? currentPoint
  const dx = snappedEnd.left - start.left
  const dy = snappedEnd.top - start.top
  const rawLength = Math.hypot(dx, dy)
  const thickness = wallThickness(gridSize)

  // Compute angle in degrees, normalize to [-180, 180].
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  let length = Math.max(gridSize, rawLength)

  // When the far end snapped onto an existing wall endpoint the join is real,
  // so keep the exact angle/length and the wall terminates precisely on that
  // endpoint. Angle-snapping here would rotate the far end OFF the target,
  // reopening the corner gap and defeating join detection at render time.
  if (endSnap?.type === 'endpoint') {
    length = rawLength
  } else {
    // Snap to nearest 15° increment.
    const stepDeg = 15
    const nearestStep = Math.round(angleDeg / stepDeg) * stepDeg
    if (Math.abs(angleDeg - nearestStep) <= 7) angleDeg = nearestStep

    // Hard-snap to cardinal axes within 4° so straight walls are reliable.
    for (const cardinal of [-180, -90, 0, 90, 180]) {
      if (Math.abs(angleDeg - cardinal) <= 4) {
        angleDeg = cardinal
        break
      }
    }
  }
  return {
    left: alignToPixel(start.left),
    top: alignToPixel(start.top),
    width: alignToPixel(length),
    height: thickness,
    rx: Math.min(4, thickness / 2),
    ry: Math.min(4, thickness / 2),
    angle: angleDeg,
    originX: 'left' as const,
    originY: 'center' as const
  }
}

export function getOpeningWallLayout(
  startPoint: LeftTop,
  currentPoint: LeftTop,
  wallSnap: { bounds: WallBounds; wall?: WallObject },
  gridSize: number,
  opts: ProjectOptions
): OpeningLayout {
  const { bounds } = wallSnap

  if (wallSnap.wall) {
    const frame = getWallAxisFrame(wallSnap.wall)
    if (frame.isFreeAngle) {
      const projStart = projectPointOnAxis(startPoint, frame)
      const projCur = projectPointOnAxis(currentPoint, frame)
      const dragLen = Math.abs(projCur.t - projStart.t) * frame.length
      const length = Math.max(gridSize, dragLen)
      const halfL = length / 2 / frame.length
      const tMid = clamp((projStart.t + projCur.t) / 2, halfL, 1 - halfL)
      const cx = frame.p0.x + tMid * (frame.p1.x - frame.p0.x)
      const cy = frame.p0.y + tMid * (frame.p1.y - frame.p0.y)
      // Perpendicular sign of the original drag (across the wall). Used by
      // door drag to choose swing side: positive = right of wall axis.
      const ux = (frame.p1.x - frame.p0.x) / frame.length
      const uy = (frame.p1.y - frame.p0.y) / frame.length
      const dragDx = currentPoint.left - startPoint.left
      const dragDy = currentPoint.top - startPoint.top
      const perp = -uy * dragDx + ux * dragDy
      const along = ux * dragDx + uy * dragDy
      return {
        left: alignToPixel(cx),
        top: alignToPixel(cy),
        width: alignToPixel(length),
        height: alignToPixel(frame.thickness),
        horizontal: true,
        wallThickness: frame.thickness,
        angle: frame.angleDeg,
        originX: 'center',
        originY: 'center',
        // Map back to old contract: dx = along-wall, dy = across-wall.
        dx: along,
        dy: perp
      }
    }
  }

  const snappedStart = projectPointToWall(startPoint, wallSnap, opts)
  const snappedCurrent = projectPointToWall(currentPoint, wallSnap, opts)

  if (bounds.horizontal) {
    const startX = clamp(snappedStart.left, bounds.left, bounds.left + bounds.width)
    const currentX = clamp(snappedCurrent.left, bounds.left, bounds.left + bounds.width)
    return {
      left: alignToPixel(Math.min(startX, currentX)),
      top: alignToPixel(bounds.top),
      width: alignToPixel(Math.max(gridSize, Math.abs(currentX - startX))),
      height: alignToPixel(bounds.height),
      horizontal: true,
      wallThickness: bounds.height,
      dx: currentX - startX,
      dy: currentPoint.top - startPoint.top
    }
  }

  const startY = clamp(snappedStart.top, bounds.top, bounds.top + bounds.height)
  const currentY = clamp(snappedCurrent.top, bounds.top, bounds.top + bounds.height)
  return {
    left: alignToPixel(bounds.left),
    top: alignToPixel(Math.min(startY, currentY)),
    width: alignToPixel(bounds.width),
    height: alignToPixel(Math.max(gridSize, Math.abs(currentY - startY))),
    horizontal: false,
    wallThickness: bounds.width,
    dx: currentPoint.left - startPoint.left,
    dy: currentY - startY
  }
}

export function snapOpeningToWall(
  target: OpeningTarget,
  point: LeftTop,
  wallSnap: { bounds: WallBounds; wall?: WallObject },
  gridSize: number,
  opts: ProjectOptions
): boolean {
  const { bounds } = wallSnap
  const currentWidth = Math.abs(Number(target.width ?? 0) * Number(target.scaleX ?? 1)) || gridSize
  const currentHeight = Math.abs(Number(target.height ?? 0) * Number(target.scaleY ?? 1)) || gridSize
  // The "length" of an opening is its long axis; preserve it across wall
  // orientation changes (so dragging a door from a horizontal wall onto a
  // vertical one keeps its size). The short axis becomes the wall thickness.
  const openingLength = Math.max(currentWidth, currentHeight)

  // Free-angle wall: align the opening to the wall axis with center origin.
  if (wallSnap.wall) {
    const frame = getWallAxisFrame(wallSnap.wall)
    if (frame.isFreeAngle) {
      const proj = projectPointOnAxis(point, frame)
      const halfL = openingLength / 2 / frame.length
      const tCenter = clamp(proj.t, halfL, 1 - halfL)
      const cx = frame.p0.x + tCenter * (frame.p1.x - frame.p0.x)
      const cy = frame.p0.y + tCenter * (frame.p1.y - frame.p0.y)
      const updates: OpeningUpdate = {
        left: alignToPixel(cx),
        top: alignToPixel(cy),
        width: alignToPixel(openingLength),
        height: alignToPixel(frame.thickness),
        scaleX: 1,
        scaleY: 1,
        angle: frame.angleDeg,
        originX: 'center',
        originY: 'center'
      }
      if (target.type === 'CadleDoor') {
        updates.wallThickness = frame.thickness
        // Default hinge/swing for a diagonal wall — user can flip later.
        if (target.doorSwingDirection !== 'up' && target.doorSwingDirection !== 'down')
          updates.doorSwingDirection = 'down'
        if (target.doorHingeSide !== 'left' && target.doorHingeSide !== 'right') updates.doorHingeSide = 'left'
      }

      target.set(updates)
      target.setCoords()
      return true
    }
  }

  const projected = projectPointToWall(point, wallSnap, opts)

  if (bounds.horizontal) {
    const left = clamp(projected.left - openingLength / 2, bounds.left, bounds.left + bounds.width - openingLength)
    const updates: OpeningUpdate = {
      left: alignToPixel(left),
      top: alignToPixel(bounds.top),
      width: alignToPixel(openingLength),
      height: alignToPixel(bounds.height),
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      originX: 'left',
      originY: 'top'
    }

    if (target.type === 'CadleDoor') {
      updates.wallThickness = bounds.height
      if (target.doorSwingDirection !== 'up' && target.doorSwingDirection !== 'down')
        updates.doorSwingDirection = 'down'
      if (target.doorHingeSide !== 'left' && target.doorHingeSide !== 'right') updates.doorHingeSide = 'left'
    }

    target.set(updates)
    target.setCoords()
    return true
  }

  const top = clamp(projected.top - openingLength / 2, bounds.top, bounds.top + bounds.height - openingLength)
  const updates: OpeningUpdate = {
    left: alignToPixel(bounds.left),
    top: alignToPixel(top),
    width: alignToPixel(bounds.width),
    height: alignToPixel(openingLength),
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: 'left',
    originY: 'top'
  }

  if (target.type === 'CadleDoor') {
    updates.wallThickness = bounds.width
    if (target.doorSwingDirection !== 'left' && target.doorSwingDirection !== 'right')
      updates.doorSwingDirection = 'right'
    if (target.doorHingeSide !== 'top' && target.doorHingeSide !== 'bottom') updates.doorHingeSide = 'top'
  }

  target.set(updates)
  target.setCoords()
  return true
}
