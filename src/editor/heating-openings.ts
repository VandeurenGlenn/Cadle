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
  !shape.hidden && (shape.heating?.kind === 'exclusion' || (shape.kind === 'symbol' && !shape.heating && !isHeatingDoorSymbol(shape)))

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
