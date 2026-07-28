import type { DraftShape, ImageShape, LineShape, Point, RectShape, Shape, SymbolShape, TextShape } from './types.js'
import { sanitizeElectricalMetadata } from './electrical.js'

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

const copyGeneratedMetadata = (
  source: { generationKey?: unknown; sourceLink?: unknown; hidden?: unknown },
  target: Shape
): void => {
  if (source.hidden === true) target.hidden = true
  if (typeof source.generationKey === 'string' && source.generationKey.trim()) {
    target.generationKey = source.generationKey.trim()
  }
  if (source.sourceLink && typeof source.sourceLink === 'object') {
    const link = source.sourceLink as { kind?: unknown; id?: unknown; role?: unknown }
    if (
      (link.kind === 'board' || link.kind === 'circuit' || link.kind === 'device') &&
      typeof link.id === 'string' && link.id.trim() && typeof link.role === 'string' && link.role.trim()
    ) {
      target.sourceLink = { kind: link.kind, id: link.id.trim(), role: link.role.trim() }
    }
  }
}

const currentSymbolPath = (path: string, name: string): string => {
  if (/symbols\/one-wire\/custom breaker\.svg$/i.test(path)) {
    return 'symbols/Protection devices/Automaat.svg'
  }
  if (/symbols\/one-wire\/custom residual-current circuit breaker\.svg$/i.test(path)) {
    return 'symbols/Protection devices/Residual-current circuit breaker.svg'
  }
  return /^data:image\/svg\+xml(?:;|,)/i.test(path) && name.trim().toLowerCase() === 'spot'
    ? 'symbols/Consumption appliances/Spot.svg'
    : path
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
      symbolTextOverrides?: unknown
      electrical?: unknown
      scale?: unknown
      width?: unknown
      height?: unknown
      rotation?: unknown
      variant?: unknown
      fill?: unknown
      stroke?: unknown
      strokeWidth?: unknown
      textAnchor?: unknown
      flipX?: unknown
      flipY?: unknown
      wallId?: unknown
      bindingId?: unknown
      groupId?: unknown
      bindingLabelOffset?: unknown
      catalogShapes?: unknown
      generationKey?: unknown
      sourceLink?: unknown
      hidden?: unknown
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
      if (typeof raw.scale === 'number' && Number.isFinite(raw.scale)) line.scale = Math.max(0.1, raw.scale)
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) line.rotation = raw.rotation
      if (raw.flipX === true) line.flipX = true
      if (raw.flipY === true) line.flipY = true
      if (typeof raw.wallId === 'string' && raw.wallId.trim()) line.wallId = raw.wallId.trim()
      if ((raw as { flipSide?: unknown }).flipSide === true) line.flipSide = true
      if (typeof raw.stroke === 'string' && raw.stroke) line.stroke = raw.stroke
      if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth)) {
        line.strokeWidth = Math.max(0.5, raw.strokeWidth)
      }
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) line.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) line.groupId = raw.groupId.trim()
      if (isPoint(raw.bindingLabelOffset)) line.bindingLabelOffset = clonePoint(raw.bindingLabelOffset)
      copyGeneratedMetadata(raw, line)
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
      if (typeof raw.scale === 'number' && Number.isFinite(raw.scale)) rect.scale = Math.max(0.1, raw.scale)
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) rect.rotation = raw.rotation
      if (raw.flipX === true) rect.flipX = true
      if (raw.flipY === true) rect.flipY = true
      const fill = raw.fill
      if (typeof fill === 'string' && fill) rect.fill = fill
      const stroke = raw.stroke
      if (typeof stroke === 'string' && stroke) rect.stroke = stroke
      if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth)) {
        rect.strokeWidth = Math.max(0.5, raw.strokeWidth)
      }
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) rect.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) rect.groupId = raw.groupId.trim()
      if (isPoint(raw.bindingLabelOffset)) rect.bindingLabelOffset = clonePoint(raw.bindingLabelOffset)
      copyGeneratedMetadata(raw, rect)
      shapes.push(rect)
      continue
    }

    if (raw.kind === 'text' && isPoint(raw.position) && typeof raw.text === 'string') {
      const text: TextShape = {
        id: raw.id,
        kind: 'text',
        position: clonePoint(raw.position),
        text: raw.text,
        scale: typeof raw.scale === 'number' && Number.isFinite(raw.scale) && raw.scale > 0 ? raw.scale : 1
      }
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) text.rotation = raw.rotation
      const fill = raw.fill
      if (typeof fill === 'string' && fill) text.fill = fill
      const stroke = raw.stroke
      if (typeof stroke === 'string' && stroke) text.stroke = stroke
      if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth)) {
        text.strokeWidth = Math.max(0.5, raw.strokeWidth)
      }
      if (raw.textAnchor === 'start' || raw.textAnchor === 'middle' || raw.textAnchor === 'end') {
        text.textAnchor = raw.textAnchor
      }
      if (raw.flipX === true) text.flipX = true
      if (raw.flipY === true) text.flipY = true
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim()) text.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) text.groupId = raw.groupId.trim()
      if (isPoint(raw.bindingLabelOffset)) text.bindingLabelOffset = clonePoint(raw.bindingLabelOffset)
      copyGeneratedMetadata(raw, text)
      if (text.sourceLink?.role === 'cable-section') text.rotation = -90
      shapes.push(text)
      continue
    }

    if (
      raw.kind === 'symbol' &&
      isPoint(raw.position) &&
      typeof raw.name === 'string' &&
      typeof raw.path === 'string'
    ) {
      const path = currentSymbolPath(raw.path, raw.name)
      const symbol: SymbolShape = {
        id: raw.id,
        kind: 'symbol',
        position: clonePoint(raw.position),
        name: path !== raw.path ? 'Spot' : raw.name,
        path,
        scale: typeof raw.scale === 'number' && Number.isFinite(raw.scale) && raw.scale > 0 ? raw.scale : 1
      }
      if (typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)) symbol.rotation = raw.rotation
      if (raw.flipX === true) symbol.flipX = true
      if (raw.flipY === true) symbol.flipY = true
      if (typeof raw.fill === 'string' && raw.fill) symbol.fill = raw.fill
      if (typeof raw.stroke === 'string' && raw.stroke) symbol.stroke = raw.stroke
      if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth)) {
        symbol.strokeWidth = Math.max(0.5, raw.strokeWidth)
      }
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim())
        symbol.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) symbol.groupId = raw.groupId.trim()
      if (raw.symbolTextOverrides && typeof raw.symbolTextOverrides === 'object') {
        const entries = Object.entries(raw.symbolTextOverrides)
          .filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === 'string' &&
              Boolean(entry[0].trim()) &&
              typeof entry[1] === 'string'
          )
          .map(([key, text]) => [key.trim(), text] as const)
        if (entries.length) symbol.symbolTextOverrides = Object.fromEntries(entries)
      }
      const electrical = sanitizeElectricalMetadata(raw.electrical)
      if (electrical) symbol.electrical = electrical
      if (isPoint(raw.bindingLabelOffset)) symbol.bindingLabelOffset = clonePoint(raw.bindingLabelOffset)
      if (Array.isArray(raw.catalogShapes)) {
        symbol.catalogShapes = sanitizeShapes(raw.catalogShapes)
      }
      copyGeneratedMetadata(raw, symbol)
      if (
        symbol.sourceLink?.role === 'breaker' &&
        /protection devices\/(?:automaat|residual-current circuit breaker)\.svg$/i.test(symbol.path)
      ) {
        symbol.symbolTextOverrides = {
          ...(symbol.symbolTextOverrides ?? {}),
          poles: '',
          phase: '',
          'rated-current': '',
          ...(symbol.path.toLowerCase().includes('residual-current')
            ? { 'residual-current': '', 'rcd-type': '' }
            : {})
        }
      }
      if (symbol.sourceLink?.role === 'cable-installation' && symbol.scale < 3) {
        symbol.scale = 3
      }
      if (symbol.sourceLink?.role === 'cable-installation') symbol.strokeWidth = 1
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
      if (typeof raw.strokeWidth === 'number' && Number.isFinite(raw.strokeWidth)) {
        image.strokeWidth = Math.max(0.5, raw.strokeWidth)
      }
      if (typeof raw.bindingId === 'string' && raw.bindingId.trim())
        image.bindingId = raw.bindingId.trim().toUpperCase()
      if (typeof raw.groupId === 'string' && raw.groupId.trim()) image.groupId = raw.groupId.trim()
      if (isPoint(raw.bindingLabelOffset)) image.bindingLabelOffset = clonePoint(raw.bindingLabelOffset)
      copyGeneratedMetadata(raw, image)
      shapes.push(image)
    }
  }
  for (const shape of shapes) {
    if (shape.kind !== 'text' || shape.sourceLink?.kind !== 'board' || shape.sourceLink.role !== 'cable-section') {
      continue
    }
    const installation = shapes.find(
      (candidate): candidate is SymbolShape =>
        candidate.kind === 'symbol' &&
        candidate.sourceLink?.kind === 'board' &&
        candidate.sourceLink.id === shape.sourceLink?.id &&
        candidate.sourceLink.role === 'cable-installation'
    )
    if (!installation) continue
    shape.position = {
      x: installation.position.x + 18,
      y: installation.position.y + 30
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
      if (typeof shape.scale === 'number') cloned.scale = shape.scale
      if (typeof shape.rotation === 'number') cloned.rotation = shape.rotation
      if (shape.flipX) cloned.flipX = true
      if (shape.flipY) cloned.flipY = true
      if (shape.wallId) cloned.wallId = shape.wallId
      if (shape.flipSide) cloned.flipSide = true
      if (shape.stroke) cloned.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') cloned.strokeWidth = shape.strokeWidth
      if (shape.bindingId) cloned.bindingId = shape.bindingId
      if (shape.groupId) cloned.groupId = shape.groupId
      if (shape.bindingLabelOffset) cloned.bindingLabelOffset = { ...shape.bindingLabelOffset }
      copyGeneratedMetadata(shape, cloned)
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
      if (typeof shape.scale === 'number') rect.scale = shape.scale
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.flipX) rect.flipX = true
      if (shape.flipY) rect.flipY = true
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') rect.strokeWidth = shape.strokeWidth
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      if (shape.bindingLabelOffset) rect.bindingLabelOffset = { ...shape.bindingLabelOffset }
      copyGeneratedMetadata(shape, rect)
      return rect
    }
    case 'text': {
      const text: TextShape = {
        id: shape.id,
        kind: 'text',
        position: clonePoint(shape.position),
        text: shape.text,
        scale: shape.scale ?? 1
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') text.strokeWidth = shape.strokeWidth
      if (shape.textAnchor) text.textAnchor = shape.textAnchor
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      if (shape.bindingLabelOffset) text.bindingLabelOffset = { ...shape.bindingLabelOffset }
      copyGeneratedMetadata(shape, text)
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
      if (shape.symbolTextOverrides) symbol.symbolTextOverrides = { ...shape.symbolTextOverrides }
      if (shape.electrical) symbol.electrical = { ...shape.electrical }
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') symbol.strokeWidth = shape.strokeWidth
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      if (shape.bindingLabelOffset) symbol.bindingLabelOffset = { ...shape.bindingLabelOffset }
      copyGeneratedMetadata(shape, symbol)
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
      if (typeof shape.strokeWidth === 'number') image.strokeWidth = shape.strokeWidth
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      if (shape.bindingLabelOffset) image.bindingLabelOffset = { ...shape.bindingLabelOffset }
      copyGeneratedMetadata(shape, image)
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
      if (typeof shape.scale === 'number') scaled.scale = shape.scale * (scaleX + scaleY) * 0.5
      if (typeof shape.rotation === 'number') scaled.rotation = shape.rotation
      if (shape.flipX) scaled.flipX = true
      if (shape.flipY) scaled.flipY = true
      if (shape.wallId) scaled.wallId = shape.wallId
      if (shape.flipSide) scaled.flipSide = true
      if (shape.stroke) scaled.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') scaled.strokeWidth = shape.strokeWidth
      if (shape.bindingId) scaled.bindingId = shape.bindingId
      if (shape.groupId) scaled.groupId = shape.groupId
      copyGeneratedMetadata(shape, scaled)
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
      if (typeof shape.scale === 'number') rect.scale = shape.scale * (scaleX + scaleY) * 0.5
      if (shape.rotation) rect.rotation = shape.rotation
      if (shape.flipX) rect.flipX = true
      if (shape.flipY) rect.flipY = true
      if (shape.fill) rect.fill = shape.fill
      if (shape.stroke) rect.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') rect.strokeWidth = shape.strokeWidth
      if (shape.bindingId) rect.bindingId = shape.bindingId
      if (shape.groupId) rect.groupId = shape.groupId
      copyGeneratedMetadata(shape, rect)
      return rect
    }
    case 'text': {
      const text: TextShape = {
        id: shape.id,
        kind: 'text',
        position: scalePoint(shape.position, scaleX, scaleY),
        text: shape.text,
        scale: (shape.scale ?? 1) * (scaleX + scaleY) * 0.5
      }
      if (shape.rotation) text.rotation = shape.rotation
      if (shape.fill) text.fill = shape.fill
      if (shape.stroke) text.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') text.strokeWidth = shape.strokeWidth
      if (shape.textAnchor) text.textAnchor = shape.textAnchor
      if (shape.flipX) text.flipX = true
      if (shape.flipY) text.flipY = true
      if (shape.bindingId) text.bindingId = shape.bindingId
      if (shape.groupId) text.groupId = shape.groupId
      copyGeneratedMetadata(shape, text)
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
      if (shape.symbolTextOverrides) symbol.symbolTextOverrides = { ...shape.symbolTextOverrides }
      if (shape.electrical) symbol.electrical = { ...shape.electrical }
      if (shape.catalogShapes) symbol.catalogShapes = cloneShapes(shape.catalogShapes)
      if (shape.rotation) symbol.rotation = shape.rotation
      if (shape.fill) symbol.fill = shape.fill
      if (shape.stroke) symbol.stroke = shape.stroke
      if (typeof shape.strokeWidth === 'number') symbol.strokeWidth = shape.strokeWidth
      if (shape.flipX) symbol.flipX = true
      if (shape.flipY) symbol.flipY = true
      if (shape.bindingId) symbol.bindingId = shape.bindingId
      if (shape.groupId) symbol.groupId = shape.groupId
      copyGeneratedMetadata(shape, symbol)
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
      if (typeof shape.strokeWidth === 'number') image.strokeWidth = shape.strokeWidth
      if (shape.flipX) image.flipX = true
      if (shape.flipY) image.flipY = true
      if (shape.bindingId) image.bindingId = shape.bindingId
      if (shape.groupId) image.groupId = shape.groupId
      copyGeneratedMetadata(shape, image)
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
    case 'text': {
      const scale = shape.scale ?? 1
      const textWidth = Math.max(36, shape.text.length * 9 * scale)
      const textHeight = 28 * scale
      const x = shape.textAnchor === 'end'
        ? shape.position.x - textWidth
        : shape.textAnchor === 'middle'
          ? shape.position.x - textWidth / 2
          : shape.position.x
      return { x, y: shape.position.y - textHeight, width: textWidth, height: textHeight }
    }
    case 'symbol': {
      const size = 24 * Math.max(0.4, shape.scale)
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
