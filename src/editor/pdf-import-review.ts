import type { PdfRecognizedSymbolKind, PdfReviewLineKind, PdfVectorPage, PdfVectorText } from './pdf-vector-conversion.js'
import { classifyPdfVectorText } from './pdf-vector-conversion.js'

export type PdfReviewStatus = 'confirmed' | 'check' | 'unrecognized' | 'plain'

export const pdfReviewStatus = (text: PdfVectorText): PdfReviewStatus => {
  const kind = classifyPdfVectorText(text)
  if (text.recognizedKind && text.recognizedKind !== 'auto') return 'confirmed'
  if (kind === 'text') {
    return /\b(?:\d+\s*(?:a|ma)|[bcdg]\d+|diff|automaat|rcd)\b/i.test(text.text) ? 'unrecognized' : 'plain'
  }
  return text.confidence == null || text.confidence >= 85 ? 'confirmed' : 'check'
}

export type PdfReviewCounts = { confirmed: number; check: number; unrecognized: number; plain: number; unresolved: number }

export const pdfReviewCounts = (page: PdfVectorPage): PdfReviewCounts => {
  const counts: PdfReviewCounts = { confirmed: 0, check: 0, unrecognized: 0, plain: 0, unresolved: 0 }
  for (const text of page.texts) counts[pdfReviewStatus(text)] += 1
  for (const line of page.lines) {
    if (line.reviewPending) counts.check += 1
  }
  counts.unresolved = counts.check + counts.unrecognized
  return counts
}

export const confirmPdfReviewSuggestions = (page: PdfVectorPage): PdfVectorPage => ({
  ...page,
  lines: page.lines.map((line) => line.reviewPending ? { ...line, reviewPending: false } : line),
  texts: page.texts.map((text) => pdfReviewStatus(text) === 'check'
    ? { ...text, recognizedKind: classifyPdfVectorText(text) }
    : text)
})

export const setPdfReviewTextKind = (
  page: PdfVectorPage,
  index: number,
  kind: PdfRecognizedSymbolKind
): PdfVectorPage => ({
  ...page,
  texts: page.texts.map((text, textIndex) => textIndex === index ? { ...text, recognizedKind: kind } : text)
})

export const setPdfReviewTextValue = (page: PdfVectorPage, index: number, value: string): PdfVectorPage => ({
  ...page,
  texts: page.texts.map((text, textIndex) => textIndex === index
    ? { ...text, originalText: text.originalText ?? text.text, text: value }
    : text)
})

export const setPdfReviewLineKind = (
  page: PdfVectorPage,
  index: number,
  reviewKind: PdfReviewLineKind
): PdfVectorPage => ({
  ...page,
  lines: page.lines.map((line, lineIndex) => lineIndex === index ? { ...line, reviewKind, reviewPending: false } : line)
})

const normalized = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()

export type PdfImportCorrection = { source: string; kind: PdfRecognizedSymbolKind; correctedText?: string }

const PDF_RECOGNIZED_KINDS = new Set<PdfRecognizedSymbolKind>([
  'auto', 'text', 'ignore', 'socket', 'switch', 'lighting', 'spot', 'breaker', 'rcd'
])

export const parsePdfImportCorrections = (source: string): PdfImportCorrection[] => {
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value)) throw new Error('Correction file must contain a JSON array.')
  const corrections = value.filter((item): item is PdfImportCorrection => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Partial<PdfImportCorrection>
    return typeof candidate.source === 'string' && candidate.source.trim().length > 0 &&
      typeof candidate.kind === 'string' && PDF_RECOGNIZED_KINDS.has(candidate.kind as PdfRecognizedSymbolKind) &&
      (candidate.correctedText == null || typeof candidate.correctedText === 'string')
  })
  if (value.length > 0 && corrections.length === 0) throw new Error('No valid Cadle PDF corrections were found.')
  return corrections.slice(-500)
}

export const serializePdfImportCorrections = (corrections: readonly PdfImportCorrection[]): string =>
  JSON.stringify(corrections.slice(-500), null, 2)

export const applyPdfImportCorrections = (
  page: PdfVectorPage,
  corrections: readonly PdfImportCorrection[]
): PdfVectorPage => {
  const bySource = new Map(corrections.map((correction) => [normalized(correction.source), correction]))
  return {
    ...page,
    texts: page.texts.map((text) => {
      const correction = bySource.get(normalized(text.originalText ?? text.text))
      return correction
        ? { ...text, text: correction.correctedText || text.text, recognizedKind: correction.kind }
        : text
    })
  }
}
