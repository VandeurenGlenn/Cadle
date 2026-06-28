import { inferSymbolScale, sanitizeShapes } from './model.js'
import type { LineShape, PaperPreset, Point, Shape } from './types.js'
import type { Project, UUID } from '../types.js'

export type LegacyNativeDocumentState = {
  version: 1
  shapes: Shape[]
  paperPreset: PaperPreset
  printMargin: number
  worldWidth: number
  worldHeight: number
}

type LegacyObject = Record<string, unknown>

const DEFAULT_WORLD_WIDTH = 2400
const DEFAULT_WORLD_HEIGHT = 1400
const DEFAULT_PAPER_PRESET: PaperPreset = 'a4-landscape'
const DEFAULT_PRINT_MARGIN = 10

const CADLE_LINE_TYPES = new Set([
  'cadlewall',
  'wall',
  'cadledoor',
  'door',
  'cadlewindow',
  'window',
  'cadlegate',
  'gate'
])
const TEXT_TYPES = new Set(['text', 'i-text', 'itext', 'textbox', 'fabrictext'])

const isRecord = (value: unknown): value is LegacyObject => Boolean(value && typeof value === 'object')

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const pointValue = (value: unknown): Point | null => {
  if (!isRecord(value)) return null
  const x = numberValue(value.x, Number.NaN)
  const y = numberValue(value.y, Number.NaN)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

const pointList = (value: unknown): Point[] => {
  if (!Array.isArray(value)) return []
  const points: Point[] = []
  for (const item of value) {
    const point = pointValue(item)
    if (point) points.push(point)
  }
  return points
}

const bindingId = (object: LegacyObject): string | undefined => stringValue(object.bindingId)?.toUpperCase()

const objectId = (object: LegacyObject, fallback: string): string =>
  stringValue(object.uuid) ?? stringValue(object.id) ?? stringValue(object.sourceObjectUuid) ?? fallback

const isImageType = (type: string): boolean =>
  type === 'image' || type === 'fabricimage' || type === 'fabric-image' || type === 'bitmap'

const lineKind = (object: LegacyObject): LineShape['kind'] => {
  const type = String(object.type ?? '').toLowerCase()
  if (type === 'cadlewall' || type === 'wall') return 'wall'
  if (type === 'cadledoor' || type === 'door') return 'door'
  if (type === 'cadlewindow' || type === 'window') return 'window'
  if (type === 'cadlegate' || type === 'gate') return 'gate'
  return 'line'
}

const rectEndpoints = (object: LegacyObject): [Point, Point] => {
  const left = numberValue(object.left)
  const top = numberValue(object.top)
  const width = Math.abs(numberValue(object.width) * numberValue(object.scaleX, 1))
  const height = Math.abs(numberValue(object.height) * numberValue(object.scaleY, 1))
  const angle = numberValue(object.angle)
  const originY = stringValue(object.originY) ?? 'top'

  if (originY === 'center' || (angle !== 0 && angle !== 180)) {
    const radians = (angle * Math.PI) / 180
    return [
      { x: left, y: top },
      { x: left + Math.cos(radians) * width, y: top + Math.sin(radians) * width }
    ]
  }

  if (width >= height) {
    const y = top + height / 2
    return [
      { x: left, y },
      { x: left + width, y }
    ]
  }

  const x = left + width / 2
  return [
    { x, y: top },
    { x, y: top + height }
  ]
}

const fabricLineEndpoints = (object: LegacyObject): [Point, Point] => {
  const x1 = numberValue(object.x1, Number.NaN)
  const y1 = numberValue(object.y1, Number.NaN)
  const x2 = numberValue(object.x2, Number.NaN)
  const y2 = numberValue(object.y2, Number.NaN)
  const left = numberValue(object.left)
  const top = numberValue(object.top)
  if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
    return [
      { x: left + x1, y: top + y1 },
      { x: left + x2, y: top + y2 }
    ]
  }
  return rectEndpoints(object)
}

const symbolShape = (object: LegacyObject, fallback: string): Shape | null => {
  const path = stringValue(object.symbolPath) ?? stringValue(object.path) ?? stringValue(object.src)
  if (!path) return null
  const name = stringValue(object.symbolName) ?? stringValue(object.name) ?? path.split('/').pop() ?? 'Symbol'
  const symbol: Shape = {
    id: objectId(object, fallback),
    kind: 'symbol',
    position: {
      x: numberValue(object.left),
      y: numberValue(object.top)
    },
    name,
    path,
    scale: Math.max(
      0.05,
      Math.max(numberValue(object.scaleX, 1), numberValue(object.scaleY, 1)) * inferSymbolScale(path)
    )
  }
  const bound = bindingId(object)
  if (bound) symbol.bindingId = bound
  return symbol
}

const imageShape = (object: LegacyObject, fallback: string): Shape | null => {
  const path = stringValue(object.src) ?? stringValue(object.path)
  if (!path) return null
  const width = Math.abs(numberValue(object.width) * numberValue(object.scaleX, 1))
  const height = Math.abs(numberValue(object.height) * numberValue(object.scaleY, 1))
  if (width <= 0 || height <= 0) return null
  const image: Shape = {
    id: objectId(object, fallback),
    kind: 'image',
    position: {
      x: numberValue(object.left) + width / 2,
      y: numberValue(object.top) + height / 2
    },
    name: stringValue(object.name) ?? path.split('/').pop() ?? 'Image',
    path,
    width,
    height
  }
  const bound = bindingId(object)
  if (bound) image.bindingId = bound
  return image
}

const convertLegacyObject = (object: LegacyObject, index: number): Shape[] => {
  const fallback = `legacy-${index}`
  const type = String(object.type ?? '').toLowerCase()
  if (isImageType(type)) {
    const image = imageShape(object, fallback)
    if (image) return [image]
  }
  const symbol = symbolShape(object, fallback)
  if (symbol) return [symbol]

  if (type === 'cadlewall' || type === 'wall') {
    const points = pointList(object.wallPoints)
    if (points.length >= 2) {
      const left = numberValue(object.left)
      const top = numberValue(object.top)
      return points.slice(0, -1).map((point, segmentIndex) => ({
        id: `${objectId(object, fallback)}-${segmentIndex + 1}`,
        kind: 'wall',
        start: { x: left + point.x, y: top + point.y },
        end: { x: left + points[segmentIndex + 1].x, y: top + points[segmentIndex + 1].y },
        ...(bindingId(object) ? { bindingId: bindingId(object) } : {})
      }))
    }
  }

  if (CADLE_LINE_TYPES.has(type) || type === 'line') {
    const [start, end] = type === 'line' ? fabricLineEndpoints(object) : rectEndpoints(object)
    const shape: LineShape = {
      id: objectId(object, fallback),
      kind: lineKind(object),
      start,
      end
    }
    const bound = bindingId(object)
    if (bound) shape.bindingId = bound
    if (object.flipSide === true) shape.flipSide = true
    return [shape]
  }

  if (type === 'rect') {
    const left = numberValue(object.left)
    const top = numberValue(object.top)
    const width = Math.abs(numberValue(object.width) * numberValue(object.scaleX, 1))
    const height = Math.abs(numberValue(object.height) * numberValue(object.scaleY, 1))
    const shape: Shape = {
      id: objectId(object, fallback),
      kind: 'rect',
      start: { x: left, y: top },
      end: { x: left + width, y: top + height }
    }
    const bound = bindingId(object)
    if (bound) shape.bindingId = bound
    return [shape]
  }

  if (TEXT_TYPES.has(type)) {
    const text = stringValue(object.text)
    if (!text) return []
    const shape: Shape = {
      id: objectId(object, fallback),
      kind: 'text',
      position: { x: numberValue(object.left), y: numberValue(object.top) },
      text
    }
    const bound = bindingId(object)
    if (bound) shape.bindingId = bound
    return [shape]
  }

  return []
}

const collectLegacyObjects = (objects: unknown[]): LegacyObject[] => {
  const collected: LegacyObject[] = []
  for (const object of objects) {
    if (!isRecord(object)) continue
    collected.push(object)
    const nested = Array.isArray(object.objects)
      ? object.objects
      : Array.isArray(object._objects)
        ? object._objects
        : null
    if (nested && !symbolShape(object, 'nested-symbol')) collected.push(...collectLegacyObjects(nested))
  }
  return collected
}

const worldSizeForShapes = (shapes: Shape[]): { worldWidth: number; worldHeight: number } => {
  let maxX = DEFAULT_WORLD_WIDTH
  let maxY = DEFAULT_WORLD_HEIGHT
  for (const shape of shapes) {
    if (shape.kind === 'symbol' || shape.kind === 'text') {
      maxX = Math.max(maxX, shape.position.x + 200)
      maxY = Math.max(maxY, shape.position.y + 200)
      continue
    }
    maxX = Math.max(maxX, shape.start.x, shape.end.x)
    maxY = Math.max(maxY, shape.start.y, shape.end.y)
  }
  return { worldWidth: Math.ceil(maxX + 200), worldHeight: Math.ceil(maxY + 200) }
}

export const migrateLegacySchemaToNativeState = (schema: unknown): LegacyNativeDocumentState | null => {
  if (!isRecord(schema) || !Array.isArray(schema.objects)) return null
  const legacyObjects = collectLegacyObjects(schema.objects)
  const shapes = sanitizeShapes(legacyObjects.flatMap((object, index) => convertLegacyObject(object, index)))
  if (!shapes.length) return null
  return {
    version: 1,
    shapes,
    paperPreset: DEFAULT_PAPER_PRESET,
    printMargin: DEFAULT_PRINT_MARGIN,
    ...worldSizeForShapes(shapes)
  }
}

const projectPages = (value: unknown): Project['pages'] | null => {
  if (!isRecord(value) || !isRecord(value.pages)) return null
  return value.pages as Project['pages']
}

export const migrateLegacyProjectToNativeState = (
  value: unknown,
  preferredPageKey?: UUID
): LegacyNativeDocumentState | null => {
  const pages = projectPages(value)
  if (!pages) return null
  const preferredPage = preferredPageKey ? pages[preferredPageKey] : undefined
  const page = preferredPage ?? Object.values(pages).sort((a, b) => numberValue(a.order) - numberValue(b.order))[0]
  return page ? migrateLegacySchemaToNativeState(page.schema) : null
}
