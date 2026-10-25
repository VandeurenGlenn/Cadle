import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { walkSvgFiles } from './svg-symbols.mjs'

const ROOT = resolve('www/symbols')
const VISIO_MARKERS = /xmlns:ev=|color-interpolation-filters=["']sRGB["']|Microsoft Visio|xmlns:v=/
const UNSUPPORTED_ELEMENTS = /<(?:filter|foreignObject|image|mask|pattern|script)\b/i

const parseDeclarations = (source) => {
  const declarations = new Map()
  for (const item of source.split(';')) {
    const separator = item.indexOf(':')
    if (separator < 0) continue
    const property = item.slice(0, separator).trim().toLowerCase()
    const value = item.slice(separator + 1).trim()
    if (property && value) declarations.set(property, value)
  }
  return declarations
}

const parseStyleSheet = (source, file) => {
  const classes = new Map()
  const rules = /\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g
  let match
  let remainder = source
  while ((match = rules.exec(source))) {
    classes.set(match[1], parseDeclarations(match[2]))
    remainder = remainder.replace(match[0], '')
  }
  if (remainder.replace(/\/\*[\s\S]*?\*\//g, '').trim()) {
    throw new Error(`${file}: unsupported CSS in Visio symbol`)
  }
  return classes
}

const readAttributes = (source) => {
  const attributes = new Map()
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g
  let match
  while ((match = pattern.exec(source))) {
    attributes.set(match[1], match[3] ?? match[4] ?? '')
  }
  return attributes
}

const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const normalizeLineFormatting = (source) =>
  source.replace(/[ \t]+(?=\r?$)/gm, '').replace(/\n(?:[ \t]*\n)+/g, '\n')

export const convertVisioSvg = (source, file = 'symbol.svg') => {
  if (!VISIO_MARKERS.test(source)) {
    if (!source.includes('data-cadle-symbol="1"')) return source
    const normalized = normalizeLineFormatting(source).trimEnd()
    return normalized === source.trimEnd() ? source : `${normalized}\n`
  }
  if (UNSUPPORTED_ELEMENTS.test(source)) throw new Error(`${file}: contains unsupported SVG elements`)

  const viewBoxMatch = source.match(/<svg\b[^>]*\bviewBox\s*=\s*(["'])([^"']+)\1/i)
  const viewBox = viewBoxMatch?.[2].trim().split(/[\s,]+/).map(Number)
  if (
    !viewBox ||
    viewBox.length !== 4 ||
    viewBox.some((value) => !Number.isFinite(value)) ||
    viewBox[0] !== 0 ||
    viewBox[1] !== 0 ||
    viewBox[2] <= 0 ||
    viewBox[3] <= 0
  ) {
    throw new Error(`${file}: requires a numeric viewBox beginning at 0 0`)
  }

  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.trim()
  const styleSheets = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => (match[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, ''))
    .join('\n')
  const classes = parseStyleSheet(styleSheets, file)
  let converted = source
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, '')
    .replace(/<!DOCTYPE[\s\S]*?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<(?:text|desc)\b[^>]*>[\s\S]*?<\/(?:text|desc)\s*>/gi, '')
    .replace(/<\/?(?:text|desc)\b[^>]*\/?>/gi, '')
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '')

  converted = converted.replace(/<([A-Za-z][\w:.-]*)(\s[^<>]*?)?(\/?)>/g, (tag, name, rawAttributes = '', selfClosing = '') => {
    const attributes = readAttributes(rawAttributes)
    const declarations = new Map()
    const classNames = (attributes.get('class') ?? '').split(/\s+/).filter(Boolean)
    for (const className of classNames) {
      const classDeclarations = classes.get(className)
      if (!classDeclarations) throw new Error(`${file}: missing style definition for .${className}`)
      for (const [property, value] of classDeclarations) declarations.set(property, value)
    }
    for (const [attribute, value] of attributes) {
      if (attribute === 'class' || attribute === 'style') continue
      if (attribute === 'xlink:href') {
        attributes.delete(attribute)
        declarations.set('href', value)
      } else if (
        !attribute.startsWith('xmlns:') &&
        !attribute.startsWith('xml:') &&
        !(name.toLowerCase() === 'svg' && ['width', 'height', 'color-interpolation-filters'].includes(attribute))
      ) {
        declarations.set(attribute, value)
      }
    }
    for (const [property, value] of parseDeclarations(attributes.get('style') ?? '')) {
      declarations.set(property, value)
    }

    if (name.toLowerCase() === 'svg') {
      declarations.set('xmlns', 'http://www.w3.org/2000/svg')
      declarations.set('viewBox', viewBox.join(' '))
      declarations.set('data-cadle-symbol', '1')
    }

    const renderedAttributes = [...declarations]
      .map(([attribute, value]) => ` ${attribute}="${escapeAttribute(value)}"`)
      .join('')
    const rootTitle = name.toLowerCase() === 'svg' && title && !selfClosing
      ? `<title>${title}</title>`
      : ''
    return `<${name}${renderedAttributes}${selfClosing ? '/' : ''}>${rootTitle}`
  })

  if (/<(?:style|text|desc|script|foreignObject)\b/i.test(converted)) {
    throw new Error(`${file}: unsupported legacy content remains after conversion`)
  }
  return `${normalizeLineFormatting(converted).trim()}\n`
}

const main = async () => {
  const files = await walkSvgFiles(ROOT)
  const converted = []
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    const output = convertVisioSvg(source, relative(ROOT, path))
    if (output === source) continue
    converted.push({ path, relativePath: relative(ROOT, path), output })
  }
  for (const item of converted) await writeFile(item.path, item.output)
  console.log(`Converted ${converted.length} Visio SVG symbols to Cadle-native SVG.`)
  for (const item of converted) console.log(`converted  ${item.relativePath}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
