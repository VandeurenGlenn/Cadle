import { symbolTextLayer } from '../../editor/symbol-metadata.js'

const SVG_GRAPHICS_SELECTOR = 'path, rect, circle, ellipse, line, polyline, polygon, text, use, image'
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const PREVIEW_PADDING_RATIO = 0.1

let measurementHost: SVGSVGElement | undefined

const getMeasurementHost = (): SVGSVGElement => {
  if (measurementHost?.isConnected) return measurementHost
  measurementHost = document.createElementNS(SVG_NAMESPACE, 'svg')
  measurementHost.setAttribute('aria-hidden', 'true')
  measurementHost.style.position = 'fixed'
  measurementHost.style.left = '-10000px'
  measurementHost.style.top = '-10000px'
  measurementHost.style.width = '256px'
  measurementHost.style.height = '256px'
  measurementHost.style.overflow = 'visible'
  measurementHost.style.pointerEvents = 'none'
  measurementHost.style.visibility = 'hidden'
  document.body.append(measurementHost)
  return measurementHost
}

const isPainted = (element: SVGGraphicsElement): boolean => {
  const style = getComputedStyle(element)
  const opacity = Number.parseFloat(style.opacity)
  if (Number.isFinite(opacity) && opacity === 0) return false

  const strokeOpacity = Number.parseFloat(style.strokeOpacity)
  const hasStroke = style.stroke !== 'none' && (!Number.isFinite(strokeOpacity) || strokeOpacity > 0)
  if (element instanceof SVGLineElement || element instanceof SVGPolylineElement) return hasStroke

  const fillOpacity = Number.parseFloat(style.fillOpacity)
  const hasFill = style.fill !== 'none' && (!Number.isFinite(fillOpacity) || fillOpacity > 0)
  return hasStroke || hasFill
}

const fitSvgPreviewToContent = (source: SVGSVGElement): void => {
  const host = getMeasurementHost()
  const measured = document.importNode(source, true)
  measured.setAttribute('width', '256')
  measured.setAttribute('height', '256')
  host.append(measured)

  try {
    for (const element of [...measured.querySelectorAll<SVGGraphicsElement>(SVG_GRAPHICS_SELECTOR)]) {
      if (!isPainted(element)) element.remove()
    }

    const bounds = measured.getBBox()
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return
    if (bounds.width <= 0 || bounds.height <= 0) return

    const padding = Math.max(bounds.width, bounds.height) * PREVIEW_PADDING_RATIO
    measured.removeAttribute('width')
    measured.removeAttribute('height')
    source.setAttribute(
      'viewBox',
      `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`
    )
  } finally {
    measured.remove()
  }
}

const replaceBlackColorTokens = (markup: string): string =>
  markup
    .replace(/(#000000|#000|black|#111111|#111|#222222|#222)(?![\w-])/gi, 'currentColor')
    .replace(/rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)/gi, 'currentColor')
    .replace(/rgb\(\s*17\s*,\s*17\s*,\s*17\s*\)/gi, 'currentColor')
    .replace(/rgb\(\s*34\s*,\s*34\s*,\s*34\s*\)/gi, 'currentColor')

const applyThemeColor = (element: Element, attribute: 'fill' | 'stroke'): void => {
  const value = element.getAttribute(attribute)
  if (!value) return
  const normalized = value.trim().toLowerCase()
  if (normalized === 'none' || normalized === 'transparent') return
  if (/^(#000|#000000|black|#111|#111111|#222|#222222)$/.test(normalized)) {
    element.setAttribute(attribute, 'currentColor')
  }
}

const replaceInlineStyleColor = (element: Element): void => {
  const style = element.getAttribute('style')
  if (!style) return
  element.setAttribute(
    'style',
    style
      .replace(/fill\s*:\s*(#000000|#000|black|#111111|#111|#222222|#222)/gi, 'fill: currentColor')
      .replace(/stroke\s*:\s*(#000000|#000|black|#111111|#111|#222222|#222)/gi, 'stroke: currentColor')
  )
}

const normalizePreviewStroke = (element: Element): void => {
  const minimumStrokeWidth = 0.45
  const strokeWidth = Number.parseFloat(element.getAttribute('stroke-width') ?? '')
  if (Number.isFinite(strokeWidth) && strokeWidth < minimumStrokeWidth) {
    element.setAttribute('stroke-width', `${minimumStrokeWidth}`)
  }

  if (element.nodeName.toLowerCase() === 'style') {
    element.textContent = (element.textContent ?? '').replace(
      /stroke-width\s*:\s*([0-9]*\.?[0-9]+)/gi,
      (declaration, value: string) =>
        Number.parseFloat(value) < minimumStrokeWidth ? `stroke-width:${minimumStrokeWidth}` : declaration
    )
  }

  const style = element.getAttribute('style')
  if (!style) return
  element.setAttribute(
    'style',
    style.replace(/stroke-width\s*:\s*([0-9]*\.?[0-9]+)/gi, (declaration, value: string) =>
      Number.parseFloat(value) < minimumStrokeWidth ? `stroke-width: ${minimumStrokeWidth}` : declaration
    )
  )
}

export const createCatalogSvgPreview = (markup: string, sourcePath: string, compact: boolean): string => {
  const doc = new DOMParser().parseFromString(replaceBlackColorTokens(markup), 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return ''

  const metadataText = compact ? '' : symbolTextLayer(sourcePath)
  if (metadataText) {
    const layer = new DOMParser().parseFromString(
      `<svg xmlns="${SVG_NAMESPACE}">${metadataText}</svg>`,
      'image/svg+xml'
    ).documentElement
    for (const node of [...layer.childNodes]) {
      if (node instanceof Element) {
        const style = node.getAttribute('style') ?? ''
        const baseStyle = style.replace(/fill\s*:[^;]+;?/i, '').replace(/;?\s*$/, ';')
        node.setAttribute('style', `${baseStyle}fill:currentColor;font-weight:600;`)
      }
      svg.append(doc.importNode(node, true))
    }
  }

  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  for (const element of svg.querySelectorAll('*')) {
    applyThemeColor(element, 'fill')
    applyThemeColor(element, 'stroke')
    replaceInlineStyleColor(element)
    normalizePreviewStroke(element)
  }
  if (compact) fitSvgPreviewToContent(svg as unknown as SVGSVGElement)
  return new XMLSerializer().serializeToString(svg)
}
