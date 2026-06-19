import type { FabricObject } from 'fabric'
import { canvas, getActiveObjects, history } from '../../../utils.js'
import { isMac } from '../utils.js'
import CadleWall from '../../../symbols/wall.js'

type FabricObjectWithChildren = FabricObject & { getObjects?: () => FabricObject[] }
type Point = { x: number; y: number }
type PolyWallObject = FabricObject & {
  type?: string
  left?: number
  top?: number
  width?: number
  height?: number
  wallThickness?: number
  wallPoints?: Point[]
  wallSelectedSegmentStartIndex?: number
  set: (props: Record<string, unknown>) => void
  setCoords?: () => void
  toObject?: () => Record<string, unknown>
}

type NormalizedChain = {
  left: number
  top: number
  width: number
  height: number
  points: Point[]
}

const normalizeWallChain = (absolutePoints: Point[]): NormalizedChain => {
  const xs = absolutePoints.map((point) => point.x)
  const ys = absolutePoints.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const width = Math.max(1, Math.max(...xs) - left)
  const height = Math.max(1, Math.max(...ys) - top)
  const points = absolutePoints.map((point) => ({ x: point.x - left, y: point.y - top }))
  return { left, top, width, height, points }
}

const isPolyWallObject = (object: FabricObject): object is PolyWallObject => {
  if (object.type !== 'CadleWall') return false
  const wall = object as PolyWallObject
  return Array.isArray(wall.wallPoints) && wall.wallPoints.length >= 2
}

const isMultiSegmentPolyWall = (object: PolyWallObject): boolean => {
  const wallPoints = Array.isArray(object.wallPoints) ? object.wallPoints : null
  return Boolean(wallPoints && wallPoints.length > 2)
}

const removeSelectedWallSegment = (object: PolyWallObject): boolean => {
  const selectedStart = Number(object.wallSelectedSegmentStartIndex)
  if (!Number.isInteger(selectedStart)) return false

  const wallPoints = Array.isArray(object.wallPoints) ? object.wallPoints : null
  if (!wallPoints || wallPoints.length < 2) return false
  if (selectedStart < 0 || selectedStart >= wallPoints.length - 1) return false

  const wallLeft = Number(object.left ?? 0)
  const wallTop = Number(object.top ?? 0)
  const absolutePoints = wallPoints.map((point) => ({ x: wallLeft + point.x, y: wallTop + point.y }))

  const firstChain = absolutePoints.slice(0, selectedStart + 1)
  const secondChain = absolutePoints.slice(selectedStart + 1)
  const remainingChains = [firstChain, secondChain].filter((chain) => chain.length >= 2)

  if (remainingChains.length === 0) {
    history.push({ type: 'remove', object, objects: [object] })
    canvas.remove(object)
    return true
  }

  const beforeState = typeof object.toObject === 'function' ? object.toObject() : undefined
  const normalizedPrimary = normalizeWallChain(remainingChains[0])
  object.set({
    left: normalizedPrimary.left,
    top: normalizedPrimary.top,
    width: normalizedPrimary.width,
    height: normalizedPrimary.height,
    wallPoints: normalizedPrimary.points,
    wallSelectedSegmentStartIndex: undefined
  })
  object.setCoords?.()
  history.push({ type: 'modify', object, prevState: beforeState, newState: object.toObject?.() })

  if (remainingChains.length === 2) {
    const normalizedSecondary = normalizeWallChain(remainingChains[1])
    const objectState = object.toObject?.() ?? {}
    const {
      uuid: _uuid,
      wallPoints: _wallPoints,
      left: _left,
      top: _top,
      width: _width,
      height: _height,
      ...rest
    } = objectState
    void _uuid
    void _wallPoints
    void _left
    void _top
    void _width
    void _height

    const extraWall = new CadleWall({
      ...rest,
      left: normalizedSecondary.left,
      top: normalizedSecondary.top,
      width: normalizedSecondary.width,
      height: normalizedSecondary.height,
      wallPoints: normalizedSecondary.points,
      wallThickness: Number(object.wallThickness ?? 0) || undefined
    })
    canvas.add(extraWall)
    history.push({ type: 'add', object: extraWall, objects: [extraWall] })
  }

  canvas.requestRenderAll()
  return true
}

export const isRemove = ({ metaKey, ctrlKey, key }: KeyboardEvent) =>
  key === 'Delete' ? true : key === 'Backspace' && (isMac ? metaKey : ctrlKey)

export const remove = () => {
  canvas.shouldRender = true

  const objects = getActiveObjects()
  canvas.discardActiveObject()
  // todo is this really needed?
  for (const object of objects) {
    if (object.type === 'activeSelection') {
      const selectionObjects = (object as FabricObjectWithChildren).getObjects?.() ?? []
      for (const _object of selectionObjects) {
        canvas.remove(_object)
      }

      continue
    }

    if (isPolyWallObject(object)) {
      if (removeSelectedWallSegment(object)) continue
      if (isMultiSegmentPolyWall(object)) continue
    }

    history.push({ type: 'remove', object, objects: [object] })
    canvas.remove(object)
  }
}

export const keyCombination = { key: 'Delete / Backspace', metaKey: isMac, ctrlKey: !isMac }
export const keys = [isMac ? ['meta', 'Backspace'] : ['Delete'], !isMac ? ['ctrl', 'Backspace'] : []]
