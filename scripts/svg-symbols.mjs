import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve('www/symbols')
const VISIO_MARKERS = /xmlns:ev=|color-interpolation-filters="sRGB"|Microsoft Visio|v:/
const CADLE_MARKER = /\bdata-cadle-symbol=(?:"1"|'1')/
const FORBIDDEN_NATIVE = [
  [/<(?:style|defs|text|script|foreignObject)\b/i, 'contains unsupported embedded content'],
  [/\b(?:xmlns:xlink|xmlns:ev|xmlns:v)=/i, 'contains a legacy namespace'],
  [/\b(?:width|height)=["'][^"']+["']/i, 'sets a fixed root dimension'],
  [/\btransform=["']/i, 'contains an unflattened transform'],
  [/var\(--symbol-(?:stroke|fill|stroke-width)/i, 'pre-wraps a style already handled by the Cadle loader'],
  [/\b(?:href|xlink:href)=["'](?:https?:|data:)/i, 'contains an external or embedded resource']
]

export const walkSvgFiles = async (directory = ROOT) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkSvgFiles(path))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.svg') files.push(path)
  }
  return files.sort()
}

export const inspectSvg = (source, file = 'symbol.svg') => {
  const native = CADLE_MARKER.test(source)
  const visio = VISIO_MARKERS.test(source)
  const errors = []
  if (native) {
    const root = source.match(/<svg\b([^>]*)>/i)?.[1] ?? ''
    const viewBox = root.match(/\bviewBox=["']([^"']+)["']/i)?.[1]
    const values = viewBox?.trim().split(/[\s,]+/).map(Number) ?? []
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[0] !== 0 || values[1] !== 0) {
      errors.push('requires a numeric viewBox beginning at 0 0')
    }
    for (const [pattern, message] of FORBIDDEN_NATIVE) {
      const target = message === 'sets a fixed root dimension' ? root : source
      if (pattern.test(target)) errors.push(message)
    }
    if (visio) errors.push('still contains Visio export metadata')
  }
  return { file, native, visio, errors }
}

export const auditSymbols = async (directory = ROOT) => {
  const results = []
  for (const file of await walkSvgFiles(directory)) {
    results.push(inspectSvg(await readFile(file, 'utf8'), relative(directory, file)))
  }
  return results
}

const main = async () => {
  const results = await auditSymbols()
  const native = results.filter((result) => result.native)
  const legacy = results.filter((result) => result.visio)
  const invalid = native.filter((result) => result.errors.length)

  if (process.argv.includes('--audit')) {
    console.log(`${results.length} SVG symbols: ${native.length} Cadle-native, ${legacy.length} Visio exports.`)
    for (const result of legacy) console.log(`legacy  ${result.file}`)
  } else {
    for (const result of invalid) {
      for (const error of result.errors) console.error(`${result.file}: ${error}`)
    }
    console.log(`Validated ${native.length} Cadle-native SVG symbols.`)
  }
  if (invalid.length) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
