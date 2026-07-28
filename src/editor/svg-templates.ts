import { nothing, svg } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import { lineMetrics, shapeBounds } from '../editor/model/model.js'
import { applySymbolTextOverrides, getCachedSymbolSvg } from './symbol-svg-cache.js'
import { symbolTextLayer } from './symbol-metadata.js'
import type { LineShape, Point, Shape } from '../editor/model/types.js'

type OpticalInsets = { left: number; right: number; top: number; bottom: number }

const symbolOpticalInsetsCache = new Map<string, OpticalInsets | null>()
const symbolMeasurementHostId = 'cadle-symbol-measurement-host'

const getSymbolMeasurementHost = (): SVGSVGElement | null => {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(symbolMeasurementHostId)
  if (existing && existing instanceof SVGSVGElement) return existing

  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  host.id = symbolMeasurementHostId
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'absolute'
  host.style.left = '-10000px'
  host.style.top = '-10000px'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.overflow = 'hidden'
  const mountTarget = document.body ?? document.documentElement
  mountTarget.appendChild(host)
  return host
}

const parseViewBox = (viewBox: string): { minX: number; minY: number; width: number; height: number } | null => {
  const parts = viewBox
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null
  const [minX, minY, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

const symbolOpticalInsets = (path: string): OpticalInsets | null => {
  const cached = symbolOpticalInsetsCache.get(path)
  if (cached !== undefined) return cached

  const symbolSvg = getCachedSymbolSvg(path)
  if (!symbolSvg) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const viewBox = parseViewBox(symbolSvg.viewBox)
  const host = getSymbolMeasurementHost()
  if (!viewBox || !host) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const previousViewBox = host.getAttribute('viewBox')
  const previousWidth = host.getAttribute('width')
  const previousHeight = host.getAttribute('height')
  const previousContent = host.innerHTML
  host.setAttribute('viewBox', symbolSvg.viewBox)
  host.setAttribute('width', `${viewBox.width}`)
  host.setAttribute('height', `${viewBox.height}`)
  host.innerHTML = `${symbolSvg.inner}${symbolTextLayer(path)}`

  let box: DOMRect | null = null
  try {
    box = host.getBBox()
  } catch {
    box = null
  }

  host.innerHTML = previousContent
  if (previousViewBox == null) host.removeAttribute('viewBox')
  else host.setAttribute('viewBox', previousViewBox)
  if (previousWidth == null) host.removeAttribute('width')
  else host.setAttribute('width', previousWidth)
  if (previousHeight == null) host.removeAttribute('height')
  else host.setAttribute('height', previousHeight)

  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || box.width <= 0 || box.height <= 0) {
    symbolOpticalInsetsCache.set(path, null)
    return null
  }

  const left = Math.max(0, Math.min(0.49, (box.x - viewBox.minX) / viewBox.width))
  const right = Math.max(0, Math.min(0.49, (viewBox.minX + viewBox.width - (box.x + box.width)) / viewBox.width))
  const top = Math.max(0, Math.min(0.49, (box.y - viewBox.minY) / viewBox.height))
  const bottom = Math.max(0, Math.min(0.49, (viewBox.minY + viewBox.height - (box.y + box.height)) / viewBox.height))
  const insets = { left, right, top, bottom }
  symbolOpticalInsetsCache.set(path, insets)
  return insets
}

// Visible content box of a symbol in world coordinates, derived from measured whitespace.
// Falls back to the full 24px box for rotated/flipped symbols where insets don't map cleanly.
const symbolContentBounds = (shape: Extract<Shape, { kind: 'symbol' }>) => {
  const size = 24 * Math.max(0.4, shape.scale)
  const x = shape.position.x - size / 2
  const y = shape.position.y - size / 2
  const fullBox = { x, y, width: size, height: size }
  const expandBreakerLabel = (bounds: typeof fullBox) => {
    if (!/automaat|breaker/i.test(`${shape.name} ${shape.path}`)) return bounds
    const label = shape.symbolTextOverrides?.['desc:20A'] ?? ''
    const extraRight = Math.max(0, label.length - 3) * 7 * Math.max(0.4, shape.scale)
    return extraRight > 0 ? { ...bounds, width: bounds.width + extraRight } : bounds
  }
  if (shape.rotation || shape.flipX || shape.flipY) return expandBreakerLabel(fullBox)
  const insets = symbolOpticalInsets(shape.path)
  if (!insets) return expandBreakerLabel(fullBox)
  return expandBreakerLabel({
    x: x + size * insets.left,
    y: y + size * insets.top,
    width: Math.max(1, size * (1 - insets.left - insets.right)),
    height: Math.max(1, size * (1 - insets.top - insets.bottom))
  })
}

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  const projectionX = start.x + t * dx
  const projectionY = start.y + t * dy
  return Math.hypot(point.x - projectionX, point.y - projectionY)
}

const openingOnWall = (opening: LineShape, wall: LineShape, tolerance: number): boolean => {
  const midpoint: Point = {
    x: (opening.start.x + opening.end.x) / 2,
    y: (opening.start.y + opening.end.y) / 2
  }
  const startDistance = pointToSegmentDistance(opening.start, wall.start, wall.end)
  const endDistance = pointToSegmentDistance(opening.end, wall.start, wall.end)
  const middleDistance = pointToSegmentDistance(midpoint, wall.start, wall.end)
  return startDistance <= tolerance && endDistance <= tolerance && middleDistance <= tolerance
}

const openingMatchesWall = (opening: LineShape, walls: LineShape[], tolerance = 4): boolean => {
  if (!opening.wallId) return false
  const boundWall = walls.find((wall) => wall.id === opening.wallId)
  return Boolean(boundWall && openingOnWall(opening, boundWall, tolerance))
}

const shapeTransform = (shape: Extract<Shape, { position: Point }>): string => {
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale
    ? `translate(${shape.position.x} ${shape.position.y})${rotate}${scale} translate(${-shape.position.x} ${-shape.position.y})`
    : ''
}

const rectTransform = (
  shape: Extract<Shape, { kind: 'rect' }>,
  bounds: { x: number; y: number; width: number; height: number }
): string => {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const rotate = shape.rotation ? ` rotate(${shape.rotation})` : ''
  const scale = shape.flipX || shape.flipY ? ` scale(${shape.flipX ? -1 : 1} ${shape.flipY ? -1 : 1})` : ''
  return rotate || scale ? `translate(${cx} ${cy})${rotate}${scale} translate(${-cx} ${-cy})` : ''
}

export const shapeTemplate = (shape: Shape, selected: boolean, extraClass = '') => {
  if (shape.hidden) return nothing
  const selectedAttr = selected ? 'true' : 'false'
  const generatedLabelClass =
    shape.kind === 'text' && shape.generationKey && shape.sourceLink ? 'onewire-generated-label' : ''
  const shapeClass = `shape shape-${shape.kind} ${generatedLabelClass} ${extraClass}`
  const isDraft = extraClass.includes('draft')
  const strokeWidthStyle =
    'strokeWidth' in shape && typeof shape.strokeWidth === 'number' ? `stroke-width: ${shape.strokeWidth}px;` : nothing
  switch (shape.kind) {
    case 'wall':
    case 'line':
      return svg`
        <line
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          stroke=${shape.stroke ?? (shape.kind === 'wall' ? '#000000' : 'var(--cadle-accent)')}
          style=${strokeWidthStyle}
          x1=${shape.start.x}
          y1=${shape.start.y}
          x2=${shape.end.x}
          y2=${shape.end.y}></line>
      `
    case 'door': {
      const { length, nx, ny } = lineMetrics(shape)
      const side = shape.flipSide ? -1 : 1
      const fnx = nx * side
      const fny = ny * side
      const tipX = shape.start.x + fnx * length
      const tipY = shape.start.y + fny * length
      const sweepFlag = shape.flipSide ? 1 : 0
      const arcD = `M ${tipX} ${tipY} A ${length} ${length} 0 0 ${sweepFlag} ${shape.end.x} ${shape.end.y}`
      const strokeWidthStyle = typeof shape.strokeWidth === 'number' ? `stroke-width: ${shape.strokeWidth}px;` : nothing
      return svg`
        ${
          isDraft
            ? svg`<line class=${`shape shape-door-opening ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>`
            : nothing
        }
        <line class=${`shape shape-door-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} x1=${shape.start.x} y1=${shape.start.y} x2=${tipX} y2=${tipY}></line>
        <path class=${`shape shape-door-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} d=${arcD}></path>
        ${
          isDraft
            ? svg`<circle class=${`shape shape-door-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.start.x} cy=${shape.start.y} r="4"></circle>`
            : nothing
        }
      `
    }
    case 'window': {
      const { nx, ny } = lineMetrics(shape)
      const jambLength = 12
      const strokeWidthStyle = typeof shape.strokeWidth === 'number' ? `stroke-width: ${shape.strokeWidth}px;` : nothing
      return svg`
        <line class=${`shape shape-window-glass ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>
        <line class=${`shape shape-window-jamb ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x - nx * jambLength} y1=${shape.start.y - ny * jambLength} x2=${shape.start.x + nx * jambLength} y2=${shape.start.y + ny * jambLength}></line>
        <line class=${`shape shape-window-jamb ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.end.x - nx * jambLength} y1=${shape.end.y - ny * jambLength} x2=${shape.end.x + nx * jambLength} y2=${shape.end.y + ny * jambLength}></line>
      `
    }
    case 'gate': {
      const { length, nx, ny } = lineMetrics(shape)
      const side = shape.flipSide ? -1 : 1
      const fnx = nx * side
      const fny = ny * side
      const half = length / 2
      const mx = (shape.start.x + shape.end.x) / 2
      const my = (shape.start.y + shape.end.y) / 2
      const tip1x = shape.start.x + fnx * half
      const tip1y = shape.start.y + fny * half
      const tip2x = shape.end.x + fnx * half
      const tip2y = shape.end.y + fny * half
      const sweepFlag = shape.flipSide ? 1 : 0
      const sweepFlag2 = shape.flipSide ? 0 : 1
      const arc1D = `M ${tip1x} ${tip1y} A ${half} ${half} 0 0 ${sweepFlag} ${mx} ${my}`
      const arc2D = `M ${tip2x} ${tip2y} A ${half} ${half} 0 0 ${sweepFlag2} ${mx} ${my}`
      const strokeWidthStyle = typeof shape.strokeWidth === 'number' ? `stroke-width: ${shape.strokeWidth}px;` : nothing
      return svg`
        <line class=${`shape shape-gate-opening ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} x1=${shape.start.x} y1=${shape.start.y} x2=${shape.end.x} y2=${shape.end.y}></line>
        <line class=${`shape shape-gate-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} x1=${shape.start.x} y1=${shape.start.y} x2=${tip1x} y2=${tip1y}></line>
        <line class=${`shape shape-gate-leaf ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} x1=${shape.end.x} y1=${shape.end.y} x2=${tip2x} y2=${tip2y}></line>
        <path class=${`shape shape-gate-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} d=${arc1D}></path>
        <path class=${`shape shape-gate-arc ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} style=${strokeWidthStyle} d=${arc2D}></path>
        ${
          isDraft
            ? svg`<circle class=${`shape shape-gate-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.start.x} cy=${shape.start.y} r="3"></circle>`
            : nothing
        }
        ${
          isDraft
            ? svg`<circle class=${`shape shape-gate-hinge ${extraClass}`} data-shape-id=${shape.id} data-selected=${selectedAttr} cx=${shape.end.x} cy=${shape.end.y} r="3"></circle>`
            : nothing
        }
      `
    }
    case 'rect': {
      const bounds = shapeBounds(shape)
      const fill = shape.fill ?? 'transparent'
      const stroke = shape.stroke ?? '#000000'
      if (shape.variant === 'circle') {
        const cx = bounds.x + bounds.width / 2
        const cy = bounds.y + bounds.height / 2
        const transform = rectTransform(shape, bounds)
        return svg`
          <ellipse
            class=${shapeClass}
            data-shape-id=${shape.id}
            data-selected=${selectedAttr}
            transform=${transform || nothing}
            style=${strokeWidthStyle}
            cx=${cx}
            cy=${cy}
            rx=${Math.max(0.5, bounds.width / 2)}
            ry=${Math.max(0.5, bounds.height / 2)}
            fill=${fill}
            stroke=${stroke}></ellipse>
        `
      }
      if (shape.variant === 'arc') {
        const startX = bounds.x
        const startY = bounds.y + bounds.height
        const endX = bounds.x + bounds.width
        const endY = startY
        const rx = Math.max(0.5, bounds.width / 2)
        const ry = Math.max(0.5, bounds.height)
        const transform = rectTransform(shape, bounds)
        const path = `M ${startX} ${startY} A ${rx} ${ry} 0 0 1 ${endX} ${endY}`
        return svg`
          <path
            class=${shapeClass}
            data-shape-id=${shape.id}
            data-selected=${selectedAttr}
            transform=${transform || nothing}
            style=${strokeWidthStyle}
            d=${path}
            fill="none"
            stroke=${stroke}></path>
        `
      }
      const transform = rectTransform(shape, bounds)
      return svg`
        <rect
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${transform || nothing}
          style=${strokeWidthStyle}
          x=${bounds.x}
          y=${bounds.y}
          width=${Math.max(1, bounds.width)}
          height=${Math.max(1, bounds.height)}
          fill=${fill}
          stroke=${stroke}></rect>
      `
    }
    case 'text':
      const textStrokeWidthStyle = typeof shape.strokeWidth === 'number' ? `stroke-width: ${shape.strokeWidth}px;` : ''
      return svg`
        <text
          class=${shapeClass}
          data-shape-id=${shape.id}
          data-selected=${selectedAttr}
          transform=${shapeTransform(shape)}
          style=${`font-size: ${18 * (shape.scale ?? 1)}px; ${textStrokeWidthStyle}`}
          fill=${shape.fill ?? 'var(--cadle-ink)'}
          stroke=${shape.stroke ?? nothing}
          text-anchor=${shape.textAnchor ?? 'start'}
          x=${shape.position.x}
          y=${shape.position.y}>${shape.text}</text>
      `
    case 'symbol': {
      const size = 24 * Math.max(0.4, shape.scale)
      const x = shape.position.x - size / 2
      const y = shape.position.y - size / 2
      const symbolSvg = getCachedSymbolSvg(shape.path)
      const symbolInner = symbolSvg
        ? applySymbolTextOverrides(shape.path, symbolSvg.inner, shape.symbolTextOverrides)
        : ''
      const metadataText = symbolTextLayer(shape.path, shape.symbolTextOverrides)
      const symbolStyle =
        `${shape.fill ? `--symbol-fill:${shape.fill};` : ''}` +
        `${shape.stroke ? `--symbol-stroke:${shape.stroke};` : ''}` +
        `${typeof shape.strokeWidth === 'number' ? `--symbol-stroke-width:${shape.strokeWidth};` : ''}`
      return svg`
        <g class=${shapeClass} data-shape-id=${shape.id} data-selected=${selectedAttr} transform=${shapeTransform(shape) || nothing}>
          ${
            symbolSvg
              ? svg`<svg x=${x} y=${y} width=${size} height=${size} viewBox=${symbolSvg.viewBox} overflow="visible" style=${`${symbolStyle}overflow:visible;`}>${unsafeSVG(symbolInner)}${unsafeSVG(metadataText)}</svg>`
              : nothing
          }
        </g>
      `
    }
    case 'image': {
      const x = shape.position.x - shape.width / 2
      const y = shape.position.y - shape.height / 2
      const imageStrokeWidth = typeof shape.strokeWidth === 'number' ? shape.strokeWidth : 1
      const imageHasDecoration = Boolean(shape.fill || shape.stroke)
      return svg`
        <g transform=${shapeTransform(shape) || nothing}>
          ${
            imageHasDecoration
              ? svg`<rect
                class=${`shape shape-image-decoration ${extraClass}`}
                data-shape-id=${shape.id}
                data-selected=${selectedAttr}
                x=${x}
                y=${y}
                width=${shape.width}
                height=${shape.height}
                fill=${shape.fill || 'none'}
                stroke=${shape.stroke || 'none'}
                style=${`stroke-width: ${imageStrokeWidth}px;`}></rect>`
              : nothing
          }
          <image
            class=${shapeClass}
            data-shape-id=${shape.id}
            data-selected=${selectedAttr}
            href=${shape.path}
            x=${x}
            y=${y}
            width=${shape.width}
            height=${shape.height}></image>
        </g>
      `
    }
  }
}

export const bindingLabelsTemplate = (shapes: Shape[]) => {
  const placements = resolveBindingLabelPlacements(shapes)
  return placements.map(
    (placement) => svg`
    <g class="binding-label" data-shape-id=${placement.shapeId}>
      <text class="binding-label-text" x=${placement.x} y=${placement.y} text-anchor="middle">${placement.bindingId}</text>
    </g>
  `
  )
}

const escapeBindingLabelText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const resolveBindingLabelPlacements = (shapes: Shape[]) => {
  const normalizeBindingId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().toUpperCase()
    if (!normalized || normalized === 'UNDEFINED' || normalized === 'NULL') return undefined
    return normalized
  }

  const intersects = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

  const expandRect = (rect: { x: number; y: number; width: number; height: number }, by: number) => ({
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2
  })

  const shapeCollisionBounds = (shape: Shape) => {
    const bounds = shapeBounds(shape)
    if (shape.kind === 'symbol') {
      const lowerPath = shape.path.toLowerCase()
      const insetRatio =
        lowerPath.includes('/spots/') || lowerPath.includes('spot')
          ? 0.34
          : lowerPath.includes('/socket outlets/') ||
              lowerPath.includes('socket outlet') ||
              lowerPath.includes('wall outlet') ||
              lowerPath.includes('/consumption appliances/')
            ? 0.26
            : 0.18
      const inset = Math.max(1, Math.min(bounds.width, bounds.height) * insetRatio)
      return {
        x: bounds.x + inset,
        y: bounds.y + inset,
        width: Math.max(1, bounds.width - inset * 2),
        height: Math.max(1, bounds.height - inset * 2)
      }
    }
    if (
      shape.kind === 'wall' ||
      shape.kind === 'line' ||
      shape.kind === 'door' ||
      shape.kind === 'window' ||
      shape.kind === 'gate'
    ) {
      const halfThickness = 8
      return {
        x: bounds.x - halfThickness,
        y: bounds.y - halfThickness,
        width: Math.max(bounds.width, 1) + halfThickness * 2,
        height: Math.max(bounds.height, 1) + halfThickness * 2
      }
    }
    return bounds
  }

  const labeledShapes = new Map<string, Shape[]>()
  for (const shape of shapes) {
    const bindingId = 'bindingId' in shape ? normalizeBindingId(shape.bindingId) : undefined
    if (!bindingId) continue
    // One-wire circuits render their own text labels — skip them here.
    if (typeof shape.groupId === 'string' && shape.groupId.startsWith('onewire-')) continue
    const key = shape.groupId ?? shape.id
    const grouped = labeledShapes.get(key)
    if (grouped) grouped.push(shape)
    else labeledShapes.set(key, [shape])
  }

  const occupied = shapes.map((shape) =>
    shape.kind === 'symbol' ? symbolContentBounds(shape) : shapeCollisionBounds(shape)
  )
  const placedLabelRects: Array<{ x: number; y: number; width: number; height: number }> = []
  const placements: Array<{ shapeId: string; bindingId: string; x: number; y: number }> = []

  for (const groupedShapes of [...labeledShapes.values()]) {
    const base = groupedShapes[0]
    if (!base) continue

    const bindingId = 'bindingId' in base ? normalizeBindingId(base.bindingId) : undefined
    if (!bindingId) continue

    const labelWidth = Math.max(14, bindingId.length * 7.2)
    const labelHeight = 12
    const margin = 5
    const anchorShape =
      groupedShapes.find((shape) => shape.kind === 'symbol') ??
      groupedShapes.find((shape) => shape.kind === 'text') ??
      base
    const manualOffset =
      groupedShapes.find(
        (shape): shape is Shape & { bindingLabelOffset: { x: number; y: number } } =>
          'bindingLabelOffset' in shape && Boolean(shape.bindingLabelOffset)
      )?.bindingLabelOffset ?? null

    if (manualOffset) {
      const ab = shapeCollisionBounds(anchorShape)
      const cx = ab.x + ab.width / 2
      const cy = ab.y + ab.height / 2
      const lx = cx + manualOffset.x
      const ly = cy + manualOffset.y
      const labelHalf = labelHeight / 2
      placedLabelRects.push({ x: lx - labelWidth / 2, y: ly - labelHalf, width: labelWidth, height: labelHeight })
      placements.push({ shapeId: anchorShape.id, bindingId, x: lx, y: ly })
    } else {
      const isSymbolAnchor = anchorShape.kind === 'symbol'
      const isSpotAnchor =
        isSymbolAnchor &&
        (anchorShape.path.toLowerCase().includes('/spots/') || anchorShape.path.toLowerCase().includes('spot'))
      const anchorBounds = shapeCollisionBounds(anchorShape)
      const anchorVisualBounds =
        anchorShape.kind === 'symbol' ? symbolContentBounds(anchorShape) : shapeBounds(anchorShape)
      const symbolInsets = isSymbolAnchor ? symbolOpticalInsets(anchorShape.path) : null
      const anchorKeepOut = {
        x: anchorVisualBounds.x - (isSpotAnchor ? 0.5 : isSymbolAnchor ? 1.5 : 4),
        y: anchorVisualBounds.y - (isSpotAnchor ? 0.5 : isSymbolAnchor ? 1.5 : 4),
        width: anchorVisualBounds.width + (isSpotAnchor ? 1 : isSymbolAnchor ? 3 : 8),
        height: anchorVisualBounds.height + (isSpotAnchor ? 1 : isSymbolAnchor ? 3 : 8)
      }
      const placementBounds = anchorShape.kind === 'symbol' ? symbolContentBounds(anchorShape) : anchorBounds
      const centerX = placementBounds.x + placementBounds.width / 2
      const centerY = placementBounds.y + placementBounds.height / 2
      const halfW = placementBounds.width / 2
      const halfH = placementBounds.height / 2
      const nearMargin = isSpotAnchor ? 0.75 : isSymbolAnchor ? 2 : margin
      const sideClearance = symbolInsets ?? { left: 0, right: 0, top: 0, bottom: 0 }
      const labelHalf = labelHeight / 2
      const gapX = halfW + nearMargin + labelWidth / 2
      const gapYCenter = halfH + nearMargin + labelHalf
      const leftX = centerX - gapX
      const rightX = centerX + gapX
      const topY = centerY - gapYCenter
      const bottomY = centerY + gapYCenter

      const candidates: Array<{ x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' }> = [
        { x: leftX, y: centerY, side: 'left' },
        { x: leftX, y: topY, side: 'left' },
        { x: leftX, y: bottomY, side: 'left' },
        { x: rightX, y: centerY, side: 'right' },
        { x: rightX, y: topY, side: 'right' },
        { x: rightX, y: bottomY, side: 'right' },
        { x: centerX, y: topY, side: 'top' },
        { x: centerX, y: bottomY, side: 'bottom' }
      ]

      const sideBias: Record<'left' | 'right' | 'top' | 'bottom', number> = {
        left: 1 - sideClearance.left,
        right: 1 - sideClearance.right,
        top: 1 - sideClearance.top,
        bottom: 1 - sideClearance.bottom
      }

      const sidePriority: Record<'left' | 'right' | 'top' | 'bottom', number> = {
        top: 0,
        bottom: 0,
        left: 16,
        right: 16
      }

      const collisionPadding = isSpotAnchor ? 0.25 : isSymbolAnchor ? 0.5 : 2
      const isCandidateFree = (candidate: { x: number; y: number }) => {
        const labelRect = {
          x: candidate.x - labelWidth / 2,
          y: candidate.y - labelHalf,
          width: labelWidth,
          height: labelHeight
        }
        const collisionRect = expandRect(labelRect, collisionPadding)
        return !(
          occupied.some((rect) => intersects(collisionRect, rect)) ||
          placedLabelRects.some((rect) => intersects(collisionRect, rect)) ||
          intersects(labelRect, anchorKeepOut)
        )
      }

      let best: { x: number; y: number; cost: number } | null = null
      for (const candidate of candidates) {
        if (!isCandidateFree(candidate)) continue
        const distance = Math.hypot(candidate.x - centerX, candidate.y - centerY)
        const cost = distance + sidePriority[candidate.side] + sideBias[candidate.side] * 4
        if (!best || cost < best.cost) best = { x: candidate.x, y: candidate.y, cost }
      }

      if (!best) continue
      const x = best.x
      const y = best.y

      placedLabelRects.push({ x: x - labelWidth / 2, y: y - labelHalf, width: labelWidth, height: labelHeight })
      placements.push({ shapeId: anchorShape.id, bindingId, x, y })
    }
  }

  return placements
}

export const bindingLabelsMarkup = (shapes: Shape[]): string =>
  resolveBindingLabelPlacements(shapes)
    .map(
      (placement) =>
        `<g class="binding-label" data-shape-id="${placement.shapeId}"><text class="binding-label-text" x="${placement.x}" y="${placement.y}" text-anchor="middle">${escapeBindingLabelText(placement.bindingId)}</text></g>`
    )
    .join('')

const selectedOutlineBounds = (shape: Shape) => {
  if (shape.kind === 'text') {
    const scale = shape.scale ?? 1
    const text = shape.text.trim()
    const width = Math.max(10, text.length * 7.2 * scale)
    const height = Math.max(10, 14 * scale)
    return {
      x: shape.position.x,
      y: shape.position.y - height,
      width,
      height,
      padding: 2,
      minSize: 8
    }
  }

  const bounds = shapeBounds(shape)
  if (shape.kind === 'symbol') {
    const inset = Math.max(0.75, Math.min(3.5, Math.min(bounds.width, bounds.height) * 0.16))
    return {
      x: bounds.x + inset,
      y: bounds.y + inset,
      width: Math.max(1, bounds.width - inset * 2),
      height: Math.max(1, bounds.height - inset * 2),
      padding: 2.5,
      minSize: 8
    }
  }

  const padding =
    shape.kind === 'wall'
      ? 8
      : shape.kind === 'line' || shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate'
        ? 4
        : 6
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, padding, minSize: 10 }
}

export const selectedOutlineTemplate = (shape: Shape | null) => {
  if (!shape) return nothing
  const bounds = selectedOutlineBounds(shape)
  return svg`
    <rect
      class="selected-outline"
      x=${bounds.x - bounds.padding}
      y=${bounds.y - bounds.padding}
      width=${Math.max(bounds.minSize, bounds.width + bounds.padding * 2)}
      height=${Math.max(bounds.minSize, bounds.height + bounds.padding * 2)}></rect>
  `
}

export const safeAreaTemplate = (rect: { x: number; y: number; width: number; height: number }) => svg`
  <rect
    class="print-safe-area"
    x=${rect.x}
    y=${rect.y}
    width=${rect.width}
    height=${rect.height}></rect>
`

export const rubberBandTemplate = (start: Point | null, end: Point | null) => {
  if (!start || !end) return nothing
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return svg`<rect class="rubber-band" x=${x} y=${y} width=${width} height=${height}></rect>`
}

export const wallChainPreviewTemplate = (wallChain: { startPoint: Point } | null, chainPreviewEnd: Point | null) => {
  if (!wallChain || !chainPreviewEnd) return nothing
  const { startPoint } = wallChain
  return svg`
    <line class="shape shape-wall draft" x1=${startPoint.x} y1=${startPoint.y} x2=${chainPreviewEnd.x} y2=${chainPreviewEnd.y}></line>
  `
}

export const measurementTemplate = (from: Point | null, to: Point | null) => {
  if (!from || !to) return nothing
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 2) return nothing
  const meters = length / 50
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  return svg`
    <g class="measurement-overlay">
      <rect class="measurement-label-bg" x=${midX - 44} y=${midY - 26} width="88" height="20" rx="6"></rect>
      <text class="measurement-label" x=${midX} y=${midY - 12} text-anchor="middle">${meters.toFixed(2)}m · ${angle.toFixed(0)}°</text>
    </g>
  `
}

export const wallMaskTemplate = (shapes: Shape[], worldWidth: number, worldHeight: number) => {
  const openingMaskWidth = 12
  const walls = shapes.filter((shape): shape is LineShape => shape.kind === 'wall')
  const openings = shapes
    .filter((shape): shape is LineShape => shape.kind === 'door' || shape.kind === 'window' || shape.kind === 'gate')
    .filter((opening) => openingMatchesWall(opening, walls))
  if (!openings.length) return nothing

  const maskShapes = [...walls, ...openings]
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const shape of maskShapes) {
    const bounds = shapeBounds(shape)
    minX = Math.min(minX, bounds.x)
    minY = Math.min(minY, bounds.y)
    maxX = Math.max(maxX, bounds.x + bounds.width)
    maxY = Math.max(maxY, bounds.y + bounds.height)
  }
  const padding = 128
  const maskX = Number.isFinite(minX) ? minX - padding : -padding
  const maskY = Number.isFinite(minY) ? minY - padding : -padding
  const maskWidth = Number.isFinite(maxX - minX) ? Math.max(worldWidth, maxX - minX + padding * 2) : worldWidth
  const maskHeight = Number.isFinite(maxY - minY) ? Math.max(worldHeight, maxY - minY + padding * 2) : worldHeight

  return svg`
    <mask id="wall-opening-mask" maskUnits="userSpaceOnUse">
      <rect x=${maskX} y=${maskY} width=${maskWidth} height=${maskHeight} fill="white"></rect>
      ${openings.map(
        (shape) => svg`
          <line
            x1=${shape.start.x}
            y1=${shape.start.y}
            x2=${shape.end.x}
            y2=${shape.end.y}
            stroke="black"
            stroke-width=${openingMaskWidth}
            stroke-linecap="butt"
            vector-effect="non-scaling-stroke"></line>
        `
      )}
    </mask>
  `
}
