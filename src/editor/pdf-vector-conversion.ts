import type { ImageShape, LineShape, Shape, SymbolShape, TextShape } from './model/types.js'

export type PdfVectorText = {
  text: string
  x: number
  y: number
  fontSize: number
  confidence?: number
  originalText?: string
  recognizedKind?: PdfRecognizedSymbolKind
}

export type PdfRecognizedSymbolKind = 'auto' | 'text' | 'ignore' | 'socket' | 'switch' | 'lighting' | 'spot' | 'breaker' | 'rcd'

export type PdfReviewLineKind = 'auto' | 'wall' | 'line' | 'door' | 'window' | 'gate' | 'ignore'

export type PdfVectorLine = {
  x1: number
  y1: number
  x2: number
  y2: number
  lineWidth: number
  reviewKind?: PdfReviewLineKind
  boundWallIndex?: number
  reviewPending?: boolean
}

export type PdfVectorPage = {
  width: number
  height: number
  texts: PdfVectorText[]
  lines: PdfVectorLine[]
}

export type PdfConversionSummary = {
  vectorLines: number
  walls: number
  texts: number
  symbols: number
  uncertainLabels: string[]
}

type Matrix = [number, number, number, number, number, number]

const multiply = (left: Matrix, right: Matrix): Matrix => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5]
]

const point = (matrix: Matrix, x: number, y: number) => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5]
})

export type PdfExtractionPage = {
  getTextContent(): Promise<{ items: Array<unknown> }>
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>
}

export type PdfOperatorCodes = {
  save: number
  restore: number
  transform: number
  setLineWidth: number
  constructPath: number
  moveTo: number
  lineTo: number
  rectangle: number
}

export const extractPdfVectorPage = async (
  page: PdfExtractionPage,
  viewportTransform: number[],
  width: number,
  height: number,
  ops: PdfOperatorCodes
): Promise<PdfVectorPage> => {
  const viewport = viewportTransform.slice(0, 6) as Matrix
  const textContent = await page.getTextContent()
  const texts: PdfVectorText[] = []
  for (const raw of textContent.items) {
    const item = raw as { str?: unknown; transform?: unknown; height?: unknown }
    if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform)) continue
    const matrix = multiply(viewport, item.transform.slice(0, 6) as Matrix)
    texts.push({
      text: item.str.trim(),
      x: matrix[4],
      y: matrix[5],
      fontSize: Math.max(1, Number(item.height) || Math.hypot(matrix[2], matrix[3]) || 8)
    })
  }

  const operatorList = await page.getOperatorList()
  const lines: PdfVectorLine[] = []
  let current: Matrix = [1, 0, 0, 1, 0, 0]
  let lineWidth = 1
  const stack: Array<{ matrix: Matrix; lineWidth: number }> = []
  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index]
    const args = operatorList.argsArray[index] ?? []
    if (fn === ops.save) {
      stack.push({ matrix: [...current], lineWidth })
      continue
    }
    if (fn === ops.restore) {
      const restored = stack.pop()
      if (restored) ({ matrix: current, lineWidth } = restored)
      continue
    }
    if (fn === ops.transform && args.length >= 6) {
      current = multiply(current, args.slice(0, 6).map(Number) as Matrix)
      continue
    }
    if (fn === ops.setLineWidth) {
      lineWidth = Math.max(0.1, Number(args[0]) || 1)
      continue
    }
    if (fn !== ops.constructPath) continue
    const matrix = multiply(viewport, current)
    const renderedWidth = lineWidth * Math.max(0.1, Math.hypot(matrix[0], matrix[1]))
    let cursor: { x: number; y: number } | null = null
    let subpathStart: { x: number; y: number } | null = null
    const append = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      if (Math.hypot(to.x - from.x, to.y - from.y) >= 4) {
        lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, lineWidth: renderedWidth })
      }
    }

    // Current PDF.js versions emit compact DrawOPS data as args[1][0]:
    // [moveTo, x, y, lineTo, x, y, ...]. Older versions exposed separate
    // operator and coordinate arrays, which are handled below.
    const compact = Array.isArray(args[1]) && args[1].length === 1 && args[1][0] != null
      ? Array.from(args[1][0] as ArrayLike<number>)
      : null
    if (compact) {
      let compactIndex = 0
      while (compactIndex < compact.length) {
        const pathOp = compact[compactIndex++]
        if (pathOp === 0 || pathOp === 1) {
          const next = point(matrix, Number(compact[compactIndex]), Number(compact[compactIndex + 1]))
          compactIndex += 2
          if (pathOp === 1 && cursor) append(cursor, next)
          if (pathOp === 0) subpathStart = next
          cursor = next
        } else if (pathOp === 2) {
          compactIndex += 6
          cursor = null
        } else if (pathOp === 3) {
          compactIndex += 4
          cursor = null
        } else if (pathOp === 4) {
          if (cursor && subpathStart) append(cursor, subpathStart)
          cursor = subpathStart
        } else {
          break
        }
      }
      continue
    }

    const pathOps = Array.from(args[0] as ArrayLike<number> ?? [])
    const coordinates = Array.from(args[1] as ArrayLike<number> ?? [])
    let coordinateIndex = 0
    for (const pathOp of pathOps) {
      if (pathOp === ops.moveTo || pathOp === ops.lineTo) {
        const next = point(matrix, Number(coordinates[coordinateIndex]), Number(coordinates[coordinateIndex + 1]))
        coordinateIndex += 2
        if (pathOp === ops.lineTo && cursor) append(cursor, next)
        if (pathOp === ops.moveTo) subpathStart = next
        cursor = next
      } else if (pathOp === ops.rectangle) {
        const x = Number(coordinates[coordinateIndex])
        const y = Number(coordinates[coordinateIndex + 1])
        const rectWidth = Number(coordinates[coordinateIndex + 2])
        const rectHeight = Number(coordinates[coordinateIndex + 3])
        coordinateIndex += 4
        const corners = [point(matrix, x, y), point(matrix, x + rectWidth, y), point(matrix, x + rectWidth, y + rectHeight), point(matrix, x, y + rectHeight)]
        for (let side = 0; side < 4; side += 1) append(corners[side], corners[(side + 1) % 4])
        cursor = corners[0]
      } else {
        // PDF curve operators consume six coordinates; curves remain on the
        // original underlay until Cadle gains editable Bézier shapes.
        coordinateIndex += 6
        cursor = null
      }
    }
  }
  return { width, height, texts, lines }
}

const SYMBOL_RULES: Array<{ key: Exclude<PdfRecognizedSymbolKind, 'auto' | 'text' | 'ignore'>; pattern: RegExp; name: string; path: string; kind?: 'breaker' | 'rcd' }> = [
  { key: 'socket', pattern: /\b(?:stopcontact|wandcontactdoos|wcd|socket)\b/i, name: 'Wall outlet with grounding', path: 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg' },
  { key: 'switch', pattern: /\b(?:schakelaar|switch)\b/i, name: 'Single pole switch', path: 'symbols/Switches/Switch general symbol.svg' },
  { key: 'lighting', pattern: /\b(?:lichtpunt|verlichting|lamp|lighting)\b/i, name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg' },
  { key: 'spot', pattern: /\bspot(?:light)?\b/i, name: 'Spot', path: 'symbols/Consumption appliances/Spot.svg' },
  { key: 'breaker', pattern: /\b(?:automaat|breaker)\b/i, name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg', kind: 'breaker' },
  { key: 'rcd', pattern: /\b(?:differentieel|diff|rcd)\b/i, name: 'Residual-current circuit breaker', path: 'symbols/Protection devices/Residual-current circuit breaker.svg', kind: 'rcd' }
]

const OCR_SYMBOL_ALIASES: Array<{ aliases: string[]; ruleIndex: number; distance: number }> = [
  { aliases: ['stopcontact', 'wandcontactdoos'], ruleIndex: 0, distance: 2 },
  { aliases: ['schakelaar'], ruleIndex: 1, distance: 2 },
  { aliases: ['lichtpunt', 'verlichting'], ruleIndex: 2, distance: 2 },
  { aliases: ['spot'], ruleIndex: 3, distance: 1 },
  { aliases: ['automaat'], ruleIndex: 4, distance: 2 },
  { aliases: ['differentieel'], ruleIndex: 5, distance: 3 }
]

const editDistance = (left: string, right: string): number => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]
    row[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex]
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
      diagonal = previous
    }
  }
  return row[right.length]
}

const findSymbolRule = (source: PdfVectorText) => {
  if (source.recognizedKind === 'text' || source.recognizedKind === 'ignore') return undefined
  if (source.recognizedKind && source.recognizedKind !== 'auto') {
    return SYMBOL_RULES.find((candidate) => candidate.key === source.recognizedKind)
  }
  const exact = SYMBOL_RULES.find((candidate) => candidate.pattern.test(source.text))
  if (exact || source.confidence == null || source.confidence < 60) return exact
  const tokens = source.text.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? []
  for (const candidate of OCR_SYMBOL_ALIASES) {
    if (tokens.some((token) => candidate.aliases.some(
      (alias) => Math.abs(token.length - alias.length) <= candidate.distance && editDistance(token, alias) <= candidate.distance
    ))) return SYMBOL_RULES[candidate.ruleIndex]
  }
  return undefined
}

export const classifyPdfVectorText = (source: PdfVectorText): PdfRecognizedSymbolKind =>
  findSymbolRule(source)?.key ?? 'text'

export const convertPdfVectorPageToCadle = (
  vector: PdfVectorPage,
  target: { x: number; y: number; width: number; height: number },
  background?: ImageShape
): { shapes: Shape[]; summary: PdfConversionSummary } => {
  const mapPoint = (x: number, y: number) => ({
    x: target.x + (x / Math.max(1, vector.width)) * target.width,
    y: target.y + (y / Math.max(1, vector.height)) * target.height
  })
  const scale = Math.min(target.width / Math.max(1, vector.width), target.height / Math.max(1, vector.height))
  const shapes: Shape[] = background ? [background] : []
  let wallCount = 0
  let lineCount = 0
  const sourceLines = vector.lines.slice(0, 4000)
  const lineIds = sourceLines.map(() => crypto.randomUUID())
  for (const [sourceIndex, source] of sourceLines.entries()) {
    if (source.reviewKind === 'ignore') continue
    lineCount += 1
    const start = mapPoint(source.x1, source.y1)
    const end = mapPoint(source.x2, source.y2)
    const explicitOpening = source.reviewKind === 'door' || source.reviewKind === 'window' || source.reviewKind === 'gate'
    const wall = source.reviewKind === 'wall' || (!explicitOpening && source.reviewKind !== 'line' && source.lineWidth >= 1.5)
    if (wall) wallCount += 1
    shapes.push({
      id: lineIds[sourceIndex],
      kind: explicitOpening ? source.reviewKind : wall ? 'wall' : 'line',
      start,
      end,
      stroke: '#000000',
      strokeWidth: Math.max(0.5, Math.min(4, source.lineWidth * scale)),
      ...(explicitOpening && source.boundWallIndex != null && sourceLines[source.boundWallIndex]?.reviewKind !== 'ignore'
        ? { wallId: lineIds[source.boundWallIndex] }
        : {})
    } as LineShape)
  }

  let symbols = 0
  let textCount = 0
  const uncertainLabels: string[] = []
  for (const source of vector.texts.slice(0, 1500)) {
    if (source.recognizedKind === 'ignore') continue
    textCount += 1
    const position = mapPoint(source.x, source.y)
    const rule = findSymbolRule(source)
    if (rule) {
      const symbol: SymbolShape = {
        id: crypto.randomUUID(),
        kind: 'symbol',
        position,
        name: rule.name,
        path: rule.path,
        scale: 2.2
      }
      if (rule.kind) {
        const ratedCurrentA = Number(/(\d{1,3})\s*a\b/i.exec(source.text)?.[1] ?? 0)
        const poles = Number(/\b([1-4])\s*p\b/i.exec(source.text)?.[1] ?? 0)
        const rawBreakerCurve = /\b([bcdg])\s*\d{1,3}\s*a?\b/i.exec(source.text)?.[1]?.toUpperCase()
        const breakerCurve = rawBreakerCurve === 'G' && source.confidence != null ? 'C' : rawBreakerCurve
        const sensitivityMa = Number(/\b(\d{1,4})\s*ma\b/i.exec(source.text)?.[1] ?? 0)
        symbol.electrical = {
          role: 'protection',
          oneWireEligible: true,
          ...(ratedCurrentA ? { breakerCurrentA: ratedCurrentA } : {}),
          ...(poles ? { poles } : {}),
          ...(breakerCurve === 'B' || breakerCurve === 'C' || breakerCurve === 'D'
            ? { breakerCurve }
            : {}),
          ...(rule.kind === 'rcd' && sensitivityMa ? { rcdSensitivityMa: sensitivityMa } : {})
        }
        symbol.symbolTextOverrides = {
          ...(poles ? { poles: `${poles}P` } : {}),
          ...(ratedCurrentA ? { 'rated-current': `${breakerCurve ?? ''}${ratedCurrentA}A` } : {}),
          ...(rule.kind === 'rcd' && sensitivityMa ? { 'residual-current': `${sensitivityMa}mA` } : {})
        }
      }
      shapes.push(symbol)
      symbols += 1
      continue
    }
    const text: TextShape = {
      id: crypto.randomUUID(),
      kind: 'text',
      position,
      text: source.text,
      scale: Math.max(0.45, Math.min(3, source.fontSize * scale / 8)),
      fill: '#000000'
    }
    shapes.push(text)
    if (/\b(?:\d+\s*(?:a|ma)|[a-z]\d+)\b/i.test(source.text)) uncertainLabels.push(source.text)
  }

  return {
    shapes,
    summary: {
      vectorLines: lineCount,
      walls: wallCount,
      texts: textCount,
      symbols,
      uncertainLabels: [...new Set(uncertainLabels)].slice(0, 30)
    }
  }
}
