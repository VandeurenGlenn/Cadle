import { shapeBounds } from '../../editor/model/model.js'
import type { Shape } from '../../editor/model/types.js'
import { getCachedSymbolSvg } from '../symbol-svg-cache.js'
import { symbolTextLayer } from '../symbol-metadata.js'
import { getBoundedCache, setBoundedCache } from '../../helpers/bounded-cache.js'

export type BindingLabelSide = 'left' | 'right' | 'top' | 'bottom'

type OpticalInsets = { left: number; right: number; top: number; bottom: number }

const opticalInsetsCache = new Map<string, OpticalInsets | null>()
const MAX_OPTICAL_INSET_CACHE_ENTRIES = 256
const measurementHostId = 'cadle-symbol-measurement-host'

export const parseSvgViewBox = (
  viewBox: string
): { minX: number; minY: number; width: number; height: number } | null => {
  const parts = viewBox
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null
  const [minX, minY, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { minX, minY, width, height }
}

const measurementHost = (): SVGSVGElement | null => {
  if (typeof document === 'undefined') return null
  const existing = document.getElementById(measurementHostId)
  if (existing && existing instanceof SVGSVGElement) return existing

  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  host.id = measurementHostId
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'absolute'
  host.style.left = '-10000px'
  host.style.top = '-10000px'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.overflow = 'hidden'
  ;(document.body ?? document.documentElement).appendChild(host)
  return host
}

const symbolOpticalInsets = (path: string): OpticalInsets | null => {
  const cached = getBoundedCache(opticalInsetsCache, path)
  if (cached !== undefined) return cached

  const symbolSvg = getCachedSymbolSvg(path)
  const viewBox = symbolSvg ? parseSvgViewBox(symbolSvg.viewBox) : null
  const host = measurementHost()
  if (!symbolSvg || !viewBox || !host) {
    setBoundedCache(opticalInsetsCache, path, null, MAX_OPTICAL_INSET_CACHE_ENTRIES)
    return null
  }

  const previous = {
    viewBox: host.getAttribute('viewBox'),
    width: host.getAttribute('width'),
    height: host.getAttribute('height'),
    content: host.innerHTML
  }
  host.setAttribute('viewBox', symbolSvg.viewBox)
  host.setAttribute('width', `${viewBox.width}`)
  host.setAttribute('height', `${viewBox.height}`)
  host.innerHTML = `${symbolSvg.inner}${symbolTextLayer(path)}`

  let box: DOMRect | null = null
  try {
    box = host.getBBox()
  } catch {
    box = null
  } finally {
    host.innerHTML = previous.content
    for (const [attribute, value] of [
      ['viewBox', previous.viewBox],
      ['width', previous.width],
      ['height', previous.height]
    ] as const) {
      if (value == null) host.removeAttribute(attribute)
      else host.setAttribute(attribute, value)
    }
  }

  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || box.width <= 0 || box.height <= 0) {
    setBoundedCache(opticalInsetsCache, path, null, MAX_OPTICAL_INSET_CACHE_ENTRIES)
    return null
  }

  const insets = {
    left: Math.max(0, Math.min(0.49, (box.x - viewBox.minX) / viewBox.width)),
    right: Math.max(0, Math.min(0.49, (viewBox.minX + viewBox.width - (box.x + box.width)) / viewBox.width)),
    top: Math.max(0, Math.min(0.49, (box.y - viewBox.minY) / viewBox.height)),
    bottom: Math.max(0, Math.min(0.49, (viewBox.minY + viewBox.height - (box.y + box.height)) / viewBox.height))
  }
  setBoundedCache(opticalInsetsCache, path, insets, MAX_OPTICAL_INSET_CACHE_ENTRIES)
  return insets
}

export const symbolContentBounds = (shape: Extract<Shape, { kind: 'symbol' }>) => {
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

export const bindingLabelOffset = (shape: Shape, side: BindingLabelSide): { x: number; y: number } => {
  const bounds = shape.kind === 'symbol' ? symbolContentBounds(shape) : shapeBounds(shape)
  const bindingId = 'bindingId' in shape && typeof shape.bindingId === 'string' ? shape.bindingId : ''
  const labelWidth = Math.max(14, bindingId.length * 7.2)
  const labelHeight = 12
  const nearMargin = shape.kind === 'symbol' ? 2 : 5
  const horizontalOffset = bounds.width / 2 + nearMargin + labelWidth / 2
  const verticalOffset = bounds.height / 2 + nearMargin + labelHeight / 2

  if (side === 'left') return { x: -horizontalOffset, y: 0 }
  if (side === 'right') return { x: horizontalOffset, y: 0 }
  if (side === 'top') return { x: 0, y: -verticalOffset }
  return { x: 0, y: verticalOffset }
}
