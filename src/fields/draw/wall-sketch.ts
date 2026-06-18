import type { FabricObject } from 'fabric'
import type { Canvas } from '../../fabric-imports.js'
import type { LeftTop, WallObject } from './wall-snap.js'

type WallSketchNode = {
  id: string
  x: number
  y: number
}

type WallSketchEdge = {
  id: string
  startNodeId: string
  endNodeId: string
  wallUuid?: string
}

type WallSketchSegmentEntry = {
  edgeId: string
  wall: WallObject
  start: LeftTop
  end: LeftTop
}

const wallSketchPointKey = (point: LeftTop) => `${Math.round(point.left)}:${Math.round(point.top)}`

export class WallSketchSession {
  #active = false
  #startPoint: LeftTop | null = null
  #nodes = new Map<string, WallSketchNode>()
  #edges: WallSketchEdge[] = []
  #segments: WallSketchSegmentEntry[] = []

  get isActive() {
    return this.#active
  }

  currentStart() {
    return this.#startPoint ? { left: this.#startPoint.left, top: this.#startPoint.top } : null
  }

  start(point: LeftTop) {
    if (!this.#active) {
      this.#nodes.clear()
      this.#edges = []
      this.#segments = []
    }

    this.#active = true
    this.#startPoint = { left: point.left, top: point.top }
    this.#ensureNode(point)
  }

  finish() {
    this.#active = false
    this.#startPoint = null
  }

  getCommittedSegments() {
    return this.#segments.map((segment) => ({
      edgeId: segment.edgeId,
      wall: segment.wall,
      start: { left: segment.start.left, top: segment.start.top },
      end: { left: segment.end.left, top: segment.end.top }
    }))
  }

  getChainPoints(): LeftTop[] {
    if (this.#segments.length === 0) return []

    const points: LeftTop[] = [{ left: this.#segments[0].start.left, top: this.#segments[0].start.top }]
    for (const segment of this.#segments) {
      const lastPoint = points[points.length - 1]
      if (lastPoint.left !== segment.end.left || lastPoint.top !== segment.end.top) {
        points.push({ left: segment.end.left, top: segment.end.top })
      }
    }
    return points
  }

  getPreviewPoints(currentPoint: LeftTop): LeftTop[] {
    const committedPoints = this.getChainPoints()
    if (committedPoints.length === 0) return [currentPoint]

    const points = committedPoints.map((point) => ({ left: point.left, top: point.top }))
    const lastPoint = points[points.length - 1]
    if (lastPoint.left !== currentPoint.left || lastPoint.top !== currentPoint.top) {
      points.push({ left: currentPoint.left, top: currentPoint.top })
    }
    return points
  }

  registerSegment(start: LeftTop, end: LeftTop, wall: WallObject) {
    const startNode = this.#ensureNode(start)
    const endNode = this.#ensureNode(end)
    const edge: WallSketchEdge = {
      id: crypto.randomUUID(),
      startNodeId: startNode.id,
      endNodeId: endNode.id,
      wallUuid:
        typeof (wall as { uuid?: unknown }).uuid === 'string' ? String((wall as { uuid?: string }).uuid) : undefined
    }

    this.#edges.push(edge)
    this.#segments.push({
      edgeId: edge.id,
      wall,
      start: { left: start.left, top: start.top },
      end: { left: end.left, top: end.top }
    })
    this.#active = true
    this.#startPoint = { left: end.left, top: end.top }
  }

  undoLastSegment(canvas: Canvas): boolean {
    const entry = this.#segments.pop()
    if (!entry) return false

    canvas.remove(entry.wall as unknown as FabricObject)
    this.#edges = this.#edges.filter((edge) => edge.id !== entry.edgeId)

    if (this.#segments.length > 0) {
      const previous = this.#segments[this.#segments.length - 1]
      this.#startPoint = { left: previous.end.left, top: previous.end.top }
      this.#active = true
      return true
    }

    this.#startPoint = { left: entry.start.left, top: entry.start.top }
    this.#active = true
    return true
  }

  #ensureNode(point: LeftTop): WallSketchNode {
    const key = wallSketchPointKey(point)
    const existing = this.#nodes.get(key)
    if (existing) return existing

    const node: WallSketchNode = {
      id: crypto.randomUUID(),
      x: point.left,
      y: point.top
    }
    this.#nodes.set(key, node)
    return node
  }
}
