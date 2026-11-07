import type { Point, Shape, SymbolShape } from './model/types.js'
import { renderedSymbolScale } from './model/symbol-scale.js'

const heatingSymbolPath = (shape: SymbolShape) =>
  shape.path.replaceAll('%20', ' ').replaceAll('\\', '/').split(/[?#]/)[0]

/** Match the architectural door asset explicitly: a door bell or electric lock
 * is still an appliance, never an opening through a wall. */
export const isHeatingDoorSymbol = (shape: Shape): shape is SymbolShape => shape.kind === 'symbol' &&
  /(?:^|\/)floor plan\/door\.svg$/i.test(heatingSymbolPath(shape))

export const isHeatingStairSymbol = (shape: Shape): shape is SymbolShape => shape.kind === 'symbol' &&
  /(?:^|\/)floor plan\/stairs-[^/]+\.svg$/i.test(heatingSymbolPath(shape))

export const isHeatingSymbolObstacle = (shape: Shape): boolean =>
  !shape.hidden && shape.heatingObstacle !== false && (shape.heatingObstacle === true || shape.heating?.kind === 'exclusion' || (shape.kind === 'symbol' && !shape.heating && !isHeatingDoorSymbol(shape)))

type Footprint = { x: number; y: number; width: number; height: number }
/** Locked source rectangles are fixed furnishings. Grouped stair treads share
 * one footprint, so the spaces between drawn treads are not laying surface.
 * An enclosing floor/frame rectangle is not furniture. Explicit overrides win. */
export const heatingObstacleBounds = (shapes: readonly Shape[], boundsFor: (shape: Shape) => Footprint): Footprint[] => {
  const groups = new Map<string, Footprint>(), result: Footprint[] = []
  for (const shape of shapes) {
    if (shape.hidden || shape.heatingObstacle === false) continue
    const fixedRect = shape.kind === 'rect' && !shape.heating && shape.locked
    if (!isHeatingSymbolObstacle(shape) && !fixedRect) continue
    const b = boundsFor(shape)
    if (fixedRect && shape.heatingObstacle !== true && shapes.some((wall) => wall.kind === 'wall' && !wall.hidden && [wall.start, wall.end].some((p) => p.x > b.x + 4 && p.x < b.x + b.width - 4 && p.y > b.y + 4 && p.y < b.y + b.height - 4))) continue
    if (fixedRect && shape.groupId) {
      const old = groups.get(shape.groupId)
      groups.set(shape.groupId, old ? { x: Math.min(old.x, b.x), y: Math.min(old.y, b.y), width: Math.max(old.x + old.width, b.x + b.width) - Math.min(old.x, b.x), height: Math.max(old.y + old.height, b.y + b.height) - Math.min(old.y, b.y) } : b)
    } else result.push(b)
  }
  return [...result, ...groups.values()]
}

/** The threshold is the bottom straight edge of Floor plan/door.svg. Use that
 * edge, not the whole swing square, and apply the same flip/rotation as the SVG. */
export const heatingDoorSymbolThreshold = (shape: SymbolShape): { start: Point; end: Point } => {
  const size = 24 * renderedSymbolScale(shape.path, shape.scale), svgScale = size / 201.63517060367454
  const radians = (shape.rotation ?? 0) * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  const transform = (x: number): Point => {
    const dx = (x - 200.5748031496063 / 2) * svgScale * (shape.flipX ? -1 : 1)
    const dy = (198.58792 - 201.63517060367454 / 2) * svgScale * (shape.flipY ? -1 : 1)
    return { x: shape.position.x + dx * cos - dy * sin, y: shape.position.y + dx * sin + dy * cos }
  }
  return { start: transform(1.4593176), end: transform(197.93176) }
}
