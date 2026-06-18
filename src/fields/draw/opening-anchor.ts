import type { JsonValue } from '../../types.js'
import type { LeftTop, WallObject } from './wall-snap.js'
import { getWallEndpoints } from './wall-snap.js'

export type OpeningAnchor = {
  wallUuid: string
  offsetRatio: number
  openingLength: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export const buildOpeningAnchor = (wall: WallObject, point: LeftTop, openingLength: number): OpeningAnchor | null => {
  const wallUuid = typeof (wall as { uuid?: unknown }).uuid === 'string' ? String((wall as { uuid?: string }).uuid) : ''
  if (!wallUuid) return null

  const [p0, p1] = getWallEndpoints(wall)
  const vx = p1.x - p0.x
  const vy = p1.y - p0.y
  const lengthSquared = vx * vx + vy * vy
  if (!Number.isFinite(lengthSquared) || lengthSquared <= 0.0001) return null

  const dx = point.left - p0.x
  const dy = point.top - p0.y
  const ratio = clamp01((dx * vx + dy * vy) / lengthSquared)
  return {
    wallUuid,
    offsetRatio: ratio,
    openingLength: Math.max(1, Math.round(openingLength))
  }
}

export const readOpeningAnchor = (metadata: JsonValue | undefined): OpeningAnchor | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = metadata as Record<string, JsonValue>
  const wallUuid = typeof record.wallUuid === 'string' ? record.wallUuid : ''
  const offsetRatio = Number(record.offsetRatio)
  const openingLength = Number(record.openingLength)
  if (!wallUuid || !Number.isFinite(offsetRatio) || !Number.isFinite(openingLength)) return null
  return {
    wallUuid,
    offsetRatio: clamp01(offsetRatio),
    openingLength: Math.max(1, openingLength)
  }
}

export const anchorPointOnWall = (wall: WallObject, anchor: OpeningAnchor): LeftTop => {
  const [p0, p1] = getWallEndpoints(wall)
  const t = clamp01(anchor.offsetRatio)
  return {
    left: p0.x + (p1.x - p0.x) * t,
    top: p0.y + (p1.y - p0.y) * t
  }
}
