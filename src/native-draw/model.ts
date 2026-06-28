import type { DraftShape, ImageShape, LineShape, Point, RectShape, Shape, SymbolShape, TextShape } from './types.js'

export const clonePoint = (point: Point): Point => ({ x: point.x, y: point.y })

export const samePoint = (a: Point | null, b: Point | null): boolean => {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y
}

export const lineMetrics = (shape: LineShape) => {
  const dx = shape.end.x - shape.start.x
  const dy = shape.end.y - shape.start.y
  const length = Math.hypot(dx, dy)
  const ux = length > 0 ? dx / length : 1
  const uy = length > 0 ? dy / length : 0
  const nx = -uy
  const ny = ux
  return { dx, dy, length, ux, uy, nx, ny }
}

export const scalePoint = (point: Point, scaleX: number, scaleY: number): Point => ({
  x: point.x * scaleX,
  y: point.y * scaleY
})

export const isPoint = (value: unknown): value is Point => {
  if (!value || typeof value !== 'object') return false
  const point = value as { x?: unknown; y?: unknown }
  return (
    typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
  )
}

export const sanitizeShapes = (values: unknown[]): Shape[] => {
  const shapes: Shape[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    const raw = value as {
      id?: unknown
      kind?: unknown
      start?: unknown
      end?: unknown
      position?: unknown
      text?: unknown
      name?: unknown
      path?: unknown
      scale?: unknown
      width?: unknown
      height?: unknown
      rotation?: unknown
      variant?: unknown
      fill?: unknown
      stroke?: unknown
      flipX?: unknown
      flipY?: unknown
      bindingId?: unknown
      groupId?: unknown
    }
    if (typeof raw.id !== 'string' || !raw.id) continue
    if (typeof raw.kind !== 'string') continue

    if (
      (raw.kind === 'wall' ||
        raw.kind === 'line' ||
        raw.kind === 'door' ||
        raw.kind === 'window' ||
        raw.kind === 'gate') &&
      isPoint(raw.start) &&
      isPoint(raw.end)
    ) {
      const line: LineShape = {
        id: raw.id,
        kind: raw.kind,
        start: clonePoint(raw.start),
        end: clonePoint(raw.end)
      }
      if ((raw as { flipSide?: unknown }).flipSide === true) line.flipSide = true
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) line.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) line.groupId = raw.groupId.trim()
      shapes.push(line)
      continue
    }

    if (raw.kind === 'rect' && isPoint(raw.start) && isPoint(raw.end)) {
      const rect: RectShape = {
        id: raw.id,
        kind: 'rect',
        start: clonePoint(raw.start),
        end: clonePoint(raw.end)
      }
      if (raw.variant === 'circle' || raw.variant === 'arc' || raw.variant === 'rect') rect.variant = raw.variant
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) rect.rotation = raw.rotation
      const fill = raw.fill
      if (typeof fill === 'string' && fill) rect.fill = fill
      const stroke = raw.stroke
      if (typeof stroke === 'string' && stroke) rect.stroke = stroke
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) rect.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) rect.groupId = raw.groupId.trim()
      shapes.push(rect)
      continue
    }

    if (raw.kind === 'text' && isPoint(raw.position) && typeof raw.text === 'string') {
      const text: TextShape = {
        id: raw.id,
        kind: 'text',
        position: clonePoint(raw.position),
        text: raw.text
      }
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) text.rotation = raw.rotation
      if (raw.flipX === true) text.flipX = true
      if (raw.flipY === true) text.flipY = true
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) text.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) text.groupId = raw.groupId.trim()
      shapes.push(text)
      continue
    }

    if (
      raw.kind === 'symbol' &&
      isPoint(raw.position) &&
      typeof raw.name === 'string' &&
      typeof raw.path === 'string'
    ) {
      const symbol: SymbolShape = {
        id: raw.id,
        kind: 'symbol',
        position: clonePoint(raw.position),
        name: raw.name,
        path: raw.path,
        scale: typeof raw.scale === 'number' && Number.isFinite(raw.scale) && raw.scale > 0 ? raw.scale : 1
      }
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) symbol.rotation = raw.rotation
      if (raw.flipX === true) symbol.flipX = true
      if (raw.flipY === true) symbol.flipY = true
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim())
        symbol.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) symbol.groupId = raw.groupId.trim()
      shapes.push(symbol)
      continue
    }

    if (
      raw.kind === 'image' &&
      isPoint(raw.position) &&
      typeof raw.name === 'string' &&
      typeof raw.path === 'string' &&
      typeof raw.width === 'number' &&
      Number.isFinite(raw.width) &&
      raw.width > 0 &&
      typeof raw.height === 'number' &&
      Number.isFinite(raw.height) &&
      raw.height > 0
    ) {
      const image: ImageShape = {
        id: raw.id,
        kind: 'image',
        position: clonePoint(raw.position),
        name: raw.name,
        path: raw.path,
        width: raw.width,
        height: raw.height
      }
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) image.rotation = raw.rotation
      if (raw.flipX === true) image.flipX = true
      if (raw.flipY === true) image.flipY = true
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim())
        image.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) image.groupId = raw.groupId.trim()
      shapes.push(image)
    }
  }
  return shapes
}

export const cloneShape = (shape: Shape): Shape => {
  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate': {
      const cloned: LineShape = {
        id: shape.id,
        kind: shape.kind,
        start: clonePoint(shape.start),
        end: clonePoint(shape.end)
      }
      if (shape.flipSide) cloned.flipSide = true
      if (shape.stroke) cloned.stroke = shape.stroke
      if (shape.bindingId) cloned.bindingId = shape.bindingId
      if (shape.groupId) cloned.groupId = shape.groupId
      return cloned
    }
    case 'rect': {
      const rect: RectShape = {
        id: shape.id,
        kind: 'rect',
        start: clonePoint(shape.start),
        end: clonePoint(shape.end)
      }
      if (shape.variant) rect.variant = shape.variant
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      return rect
    }
    case 'text': {
      const text: TextShape = {
        id: shape.id,
        kind: 'text',
        position: clonePoint(shape.position),
        text: shape.text
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      return text
    }
    case 'symbol': {
      const symbol: SymbolShape = {
        id: shape.id,
        kind: 'symbol',
        position: clonePoint(shape.position),
        name: shape.name,
        path: shape.path,
        scale: shape.scale
      }
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      return symbol
    }
    case 'image': {
      const image: ImageShape = {
        id: shape.id,
        kind: 'image',
        position: clonePoint(shape.position),
        name: shape.name,
        path: shape.path,
        width: shape.width,
        height: shape.height
      }
      if (shape.rotation) image.rotation = shape.rotation
      if (shape.fill) image.fill = shape.fill
      if (shape.stroke) image.stroke = shape.stroke
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      return image
    }
  }
}

export const cloneShapes = (shapes: Shape[]): Shape[] => shapes.map((shape) => cloneShape(shape))

export const scaleShape = (shape: Shape, scaleX: number, scaleY: number): Shape => {
  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate': {
      const scaled: LineShape = {
        id: shape.id,
        kind: shape.kind,
        start: scalePoint(shape.start, scaleX, scaleY),
        end: scalePoint(shape.end, scaleX, scaleY)
      }
      if (shape.flipSide) scaled.flipSide = true
      if (shape.stroke) scaled.stroke = shape.stroke
      if (shape.bindingId) scaled.bindingId = shape.bindingId
      if (shape.groupId) scaled.groupId = shape.groupId
      return scaled
    }
    case 'rect': {
      const rect: RectShape = {
        id: shape.id,
        kind: 'rect',
        start: scalePoint(shape.start, scaleX, scaleY),
        end: scalePoint(shape.end, scaleX, scaleY)
      }
      if (shape.variant) rect.variant = shape.variant
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      return rect
    }
    case 'text': {
      const text: TextShape = {
        id: shape.id,
        kind: 'text',
        position: scalePoint(shape.position, scaleX, scaleY),
        text: shape.text
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      return text
    }
    case 'symbol': {
      const symbol: SymbolShape = {
        id: shape.id,
        kind: 'symbol',
        position: scalePoint(shape.position, scaleX, scaleY),
        name: shape.name,
        path: shape.path,
        scale: shape.scale * (scaleX + scaleY) * 0.5
      }
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      return symbol
    }
    case 'image': {
      const image: ImageShape = {
        id: shape.id,
        kind: 'image',
        position: scalePoint(shape.position, scaleX, scaleY),
        name: shape.name,
        path: shape.path,
        width: shape.width * scaleX,
        height: shape.height * scaleY
      }
      if (shape.rotation) image.rotation = shape.rotation
      if (shape.fill) image.fill = shape.fill
      if (shape.stroke) image.stroke = shape.stroke
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      return image
    }
  }
}

export const scaleDraftShape = (shape: DraftShape, scaleX: number, scaleY: number): DraftShape => ({
  id: shape.id,
  kind: shape.kind,
  start: scalePoint(shape.start, scaleX, scaleY),
  end: scalePoint(shape.end, scaleX, scaleY)
})

export const inferSymbolScale = (path: string): number => {
  const lower = path.toLowerCase()
  if (
    lower.includes('/protection devices/') ||
    lower.includes('automaat') ||
    lower.includes('circuit breaker') ||
    lower.includes('residual-current circuit breaker') ||
    lower.includes('aardlek')
  )
    return 3
  if (lower.includes('/socket outlets/') || lower.includes('socket outlet') || lower.includes('wall outlet')) return 1
  if (lower.includes('floor plan') || lower.includes('floor-plan')) return 3
  if (
    lower.includes('laadpaal') ||
    lower.includes('snellader') ||
    lower.includes('wallbox') ||
    / ev[^a-z]/.test(lower) ||
    lower.endsWith(' ev.svg')
  )
    return 2
  return 1
}

export const nextShapeId = (): string => {
  const cryptoApi = globalThis.crypto as Crypto | undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }

  return `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const shapeBounds = (shape: Shape) => {
  switch (shape.kind) {
    case 'wall':
    case 'line':
    case 'door':
    case 'window':
    case 'gate': {
      const x = Math.min(shape.start.x, shape.end.x)
      const y = Math.min(shape.start.y, shape.end.y)
      const width = Math.abs(shape.end.x - shape.start.x)
      const height = Math.abs(shape.end.y - shape.start.y)
      return { x, y, width, height }
    }
    case 'rect': {
      const x = Math.min(shape.start.x, shape.end.x)
      const y = Math.min(shape.start.y, shape.end.y)
      const width = Math.abs(shape.end.x - shape.start.x)
      const height = Math.abs(shape.end.y - shape.start.y)
      return { x, y, width, height }
    }
    case 'text':
      return { x: shape.position.x, y: shape.position.y - 20, width: 180, height: 28 }
    case 'symbol': {
      const size = 40 * Math.max(0.4, shape.scale)
      return { x: shape.position.x - size / 2, y: shape.position.y - size / 2, width: size, height: size }
    }
    case 'image':
      return {
        x: shape.position.x - shape.width / 2,
        y: shape.position.y - shape.height / 2,
        width: shape.width,
        height: shape.height
      }
  }
}
