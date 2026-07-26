import { symbolTextFieldsFor } from './symbol-metadata.js'

export type CachedSymbolSvg = {
  inner: string
  viewBox: string
}

export type EditableSymbolTextField = {
  key: string
  label: string
  value: string
}

const symbolSvgCache = new Map<string, CachedSymbolSvg>()
const symbolSvgLoading = new Set<string>()

const isDataSvg = (path: string) => /^data:image\/svg\+xml/i.test(path)

const encodePath = (path: string): string =>
  path
    .split('/')
    .map((segment) => (segment ? encodeURIComponent(segment) : segment))
    .join('/')

const symbolPathCandidates = (path: string): string[] => {
  if (/^(data:|https?:|blob:|file:)/i.test(path)) return [path]
  const normalizedPath = path.replace(/^\.\//, '')
  const encoded = encodePath(normalizedPath)
  const candidates = new Set<string>()
  if (typeof location !== 'undefined' && location.origin) {
    candidates.add(new URL(encoded, document.baseURI).toString())
    candidates.add(`${location.origin}/${encoded}`)
    candidates.add(`${location.origin}/www/${encoded}`)
  }
  candidates.add(`/${encoded}`)
  candidates.add(`/www/${encoded}`)
  candidates.add(encoded)
  return [...candidates]
}

const decodeDataSvg = (path: string): string | null => {
  const match = path.match(/^data:image\/svg\+xml(;base64)?,(.*)$/i)
  if (!match) return null
  const isBase64 = Boolean(match[1])
  const payload = match[2] ?? ''
  try {
    if (isBase64) return atob(payload)
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

const PRESENTATION_ATTRS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'fill-rule',
  'fill-opacity',
  'stroke-opacity',
  'opacity'
]

const parseDeclarations = (text: string): Map<string, string> => {
  const declarations = new Map<string, string>()
  for (const part of text.split(';')) {
    const separator = part.indexOf(':')
    if (separator === -1) continue
    const prop = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    if (prop && value) declarations.set(prop, value)
  }
  return declarations
}

const parseStyleSheet = (css: string): Map<string, Map<string, string>> => {
  const rules = new Map<string, Map<string, string>>()
  const ruleMatcher = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = ruleMatcher.exec(css))) {
    const token = match[1]
    const declarations = parseDeclarations(match[2])
    const existing = rules.get(token)
    if (existing) for (const [key, value] of declarations) existing.set(key, value)
    else rules.set(token, declarations)
  }
  return rules
}

// Wrap editable properties in CSS variables so the object pane can recolor/restyle
// symbols while keeping the original values as fallbacks.
const toVarValue = (prop: string, value: string): string => {
  if (prop === 'fill') return value === 'none' ? value : `var(--symbol-fill, ${value})`
  if (prop === 'stroke') return value === 'none' ? value : `var(--symbol-stroke, ${value})`
  if (prop === 'stroke-width') return `var(--symbol-stroke-width, ${value})`
  return value
}

const serializeStyle = (declarations: Map<string, string>): string =>
  [...declarations].map(([key, value]) => `${key}:${toVarValue(key, value)}`).join(';')

const sanitizeSvg = (source: string, path: string): CachedSymbolSvg | null => {
  if (typeof DOMParser === 'undefined') return null
  const parser = new DOMParser()
  const doc = parser.parseFromString(source, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') return null

  root.querySelectorAll('script, foreignObject').forEach((node) => node.remove())

  // Collect and drop <style> blocks: their global class names collide between
  // symbols and their CDATA breaks when injected into an HTML-context <svg>.
  const styleSheet = new Map<string, Map<string, string>>()
  root.querySelectorAll('style').forEach((styleNode) => {
    for (const [token, declarations] of parseStyleSheet(styleNode.textContent ?? '')) {
      const existing = styleSheet.get(token)
      if (existing) for (const [key, value] of declarations) existing.set(key, value)
      else styleSheet.set(token, declarations)
    }
    styleNode.remove()
  })

  const inlineElementStyle = (element: Element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
    }

    const declarations = new Map<string, string>()
    const className = element.getAttribute('class')
    if (className) {
      for (const token of className.split(/\s+/).filter(Boolean)) {
        const rule = styleSheet.get(token)
        if (rule) for (const [key, value] of rule) declarations.set(key, value)
      }
    }
    for (const attr of PRESENTATION_ATTRS) {
      const value = element.getAttribute(attr)
      if (value != null) {
        declarations.set(attr, value)
        element.removeAttribute(attr)
      }
    }
    const existingStyle = element.getAttribute('style')
    if (existingStyle) for (const [key, value] of parseDeclarations(existingStyle)) declarations.set(key, value)

    // Ensure any stroked element honours the editable stroke-width default.
    const strokeValue = declarations.get('stroke')
    if (strokeValue && strokeValue !== 'none' && !declarations.has('stroke-width')) {
      declarations.set('stroke-width', '0.65')
    }

    element.removeAttribute('class')
    if (declarations.size) element.setAttribute('style', serializeStyle(declarations))
  }

  inlineElementStyle(root)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let current = walker.nextNode() as Element | null
  while (current) {
    inlineElementStyle(current)
    current = walker.nextNode() as Element | null
  }

  if (symbolTextFieldsFor(path).length) {
    root.querySelectorAll('text, desc').forEach((node) => node.remove())
  }

  const viewBox = root.getAttribute('viewBox') || '0 0 100 100'
  const rootStyle = root.getAttribute('style') ?? ''
  const innerHtml = root.innerHTML.trim()
  if (!innerHtml) return null
  const inner = rootStyle ? `<g style="${rootStyle}">${innerHtml}</g>` : innerHtml
  return { inner, viewBox }
}

export const getCachedSymbolSvg = (path: string): CachedSymbolSvg | null => symbolSvgCache.get(path) ?? null

export const isSymbolSvgLoading = (path: string): boolean => symbolSvgLoading.has(path)

export const resolveSymbolHref = (path: string): string => {
  if (/^(data:|https?:|blob:|file:)/i.test(path)) return path
  const candidates = symbolPathCandidates(path)
  return candidates[0] ?? path
}

const symbolDocFromInner = (inner: string): Document | null => {
  if (typeof DOMParser === 'undefined') return null
  const parser = new DOMParser()
  return parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`, 'image/svg+xml')
}

const resolveTextFieldBase = (element: SVGTextElement, index: number): { keyBase: string; label: string } => {
  const parent = element.parentElement
  const desc = parent?.querySelector(':scope > desc')
  const descText = desc?.textContent?.trim() ?? ''
  if (descText) {
    return {
      keyBase: `desc:${descText}`,
      label: descText
    }
  }
  return {
    keyBase: `text:${index + 1}`,
    label: `Text ${index + 1}`
  }
}

type TextFieldCandidate = {
  key: string
  label: string
  value: string
  element: SVGTextElement
}

const normalizeLabel = (value: string): string => value.trim().toLowerCase()

const prettifySymbolFieldLabel = (path: string, rawLabel: string, rawValue: string): string => {
  const normalizedPath = path.toLowerCase()
  const normalizedLabel = normalizeLabel(rawLabel)
  const normalizedValue = rawValue.trim().toLowerCase()

  const isProtectionBreaker =
    normalizedPath.includes('residual-current circuit breaker') ||
    normalizedPath.includes('aardlek') ||
    normalizedPath.includes('automaat') ||
    normalizedPath.includes('circuit breaker')

  if (isProtectionBreaker) {
    if (normalizedLabel === 'np') return 'Poles'
    if (normalizedLabel === 'n') return 'Phase'
    if (/^\d+\s*a$/i.test(rawValue.trim())) return 'Rated current'
    if (/^\d+\s*ma$/i.test(rawValue.trim())) return 'Residual current'
    if (normalizedLabel === 'i' || normalizedValue === 'i') return 'Device type'
  }

  if (normalizedLabel === 'np') return 'Poles'
  if (/^\d+\s*a$/i.test(rawValue.trim())) return 'Current'
  if (/^\d+\s*ma$/i.test(rawValue.trim())) return 'Sensitivity'

  return rawLabel
}

const collectTextFieldCandidates = (doc: Document): TextFieldCandidate[] => {
  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return []
  const textElements = [...svg.querySelectorAll('text')].filter(
    (element): element is SVGTextElement => element instanceof SVGTextElement
  )
  const keyCounts = new Map<string, number>()
  const candidates: TextFieldCandidate[] = []

  textElements.forEach((element, index) => {
    const rawValue = element.textContent ?? ''
    if (!rawValue.trim()) return
    const { keyBase, label } = resolveTextFieldBase(element, index)
    const count = (keyCounts.get(keyBase) ?? 0) + 1
    keyCounts.set(keyBase, count)
    const key = count > 1 ? `${keyBase}#${count}` : keyBase
    candidates.push({ key, label: count > 1 ? `${label} ${count}` : label, value: rawValue, element })
  })

  return candidates
}

export const listEditableSymbolTextFields = (path: string): EditableSymbolTextField[] => {
  const registered = symbolTextFieldsFor(path)
  if (registered.length) {
    return registered.map((field) => ({
      key: field.key,
      label: field.label,
      value: field.defaultValue
    }))
  }
  const cached = getCachedSymbolSvg(path)
  if (!cached) return []
  const doc = symbolDocFromInner(cached.inner)
  if (!doc) return []
  const candidates = collectTextFieldCandidates(doc)
  return candidates.map(({ key, label, value }) => ({
    key,
    label: prettifySymbolFieldLabel(path, label, value),
    value
  }))
}

export const applySymbolTextOverrides = (path: string, inner: string, overrides?: Record<string, string>): string => {
  void path
  if (!overrides) return inner
  const effectiveEntries = Object.entries(overrides).filter(
    (entry): entry is [string, string] =>
      typeof entry[0] === 'string' && Boolean(entry[0].trim()) && typeof entry[1] === 'string'
  )
  if (!effectiveEntries.length) return inner

  const doc = symbolDocFromInner(inner)
  if (!doc) return inner
  const candidates = collectTextFieldCandidates(doc)
  if (!candidates.length) return inner

  const map = new Map(effectiveEntries.map(([key, value]) => [key.trim(), value]))
  let changed = false
  for (const candidate of candidates) {
    const nextValue = map.get(candidate.key)
    if (typeof nextValue !== 'string') continue
    if (candidate.element.textContent === nextValue) continue
    candidate.element.textContent = nextValue
    changed = true
  }
  if (!changed) return inner
  return doc.documentElement.innerHTML
}

export const preloadSymbolSvg = async (path: string): Promise<void> => {
  if (!path || symbolSvgCache.has(path) || symbolSvgLoading.has(path)) return
  symbolSvgLoading.add(path)

  try {
    let source: string | null = null
    if (isDataSvg(path)) {
      source = decodeDataSvg(path)
    } else {
      for (const candidate of symbolPathCandidates(path)) {
        try {
          const response = await fetch(candidate)
          if (response.ok) {
            source = await response.text()
            break
          }
        } catch {
          // Try next candidate path.
        }
      }
    }

    if (!source) return
    const cached = sanitizeSvg(source, path)
    if (cached) symbolSvgCache.set(path, cached)
  } catch {
    // Ignore symbol fetch/parse failures; caller can fall back to image rendering.
  } finally {
    symbolSvgLoading.delete(path)
  }
}
