import type { PdfVectorText } from './pdf-vector-conversion.js'

type OcrBox = { x0: number; y0: number; x1: number; y1: number }
type OcrLine = { text?: string; confidence?: number; bbox?: OcrBox }
type OcrPageData = {
  confidence?: number
  blocks?: Array<{ paragraphs?: Array<{ lines?: OcrLine[] }> }> | null
}

export type PdfScanOcrResult = {
  texts: PdfVectorText[]
  confidence: number
}

export const mapOcrPageToPdfText = (
  data: OcrPageData,
  source: { width: number; height: number },
  target: { width: number; height: number },
  minimumConfidence = 60
): PdfScanOcrResult => {
  const scaleX = target.width / Math.max(1, source.width)
  const scaleY = target.height / Math.max(1, source.height)
  const texts: PdfVectorText[] = []
  const seen = new Set<string>()
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = line.text?.replace(/\s+/g, ' ').trim()
        const box = line.bbox
        const confidence = Number(line.confidence ?? 0)
        if (!text || !box || confidence < minimumConfidence) continue
        const key = `${text.toLocaleLowerCase()}@${Math.round(box.x0)}:${Math.round(box.y0)}`
        if (seen.has(key)) continue
        seen.add(key)
        texts.push({
          text,
          x: box.x0 * scaleX,
          y: box.y0 * scaleY,
          fontSize: Math.max(1, (box.y1 - box.y0) * scaleY),
          confidence
        })
      }
    }
  }
  return { texts, confidence: Math.max(0, Math.min(100, Number(data.confidence ?? 0))) }
}

export type PdfScanOcrSession = {
  recognize(canvas: HTMLCanvasElement, target: { width: number; height: number }): Promise<PdfScanOcrResult>
  terminate(): Promise<void>
}

export const createPdfScanOcrSession = async (
  onProgress?: (status: string, progress: number) => void
): Promise<PdfScanOcrSession> => {
  const { createWorker, OEM, PSM } = await import('tesseract.js')
  const root = new URL('.', document.baseURI)
  const worker = await createWorker(['nld', 'eng'], OEM.LSTM_ONLY, {
    workerPath: new URL('ocr/worker.min.js', root).href,
    corePath: new URL('ocr/core', root).href,
    langPath: new URL('ocr/lang', root).href,
    logger: (message) => onProgress?.(message.status, message.progress)
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    user_defined_dpi: '200'
  })
  return {
    async recognize(canvas, target) {
      const result = await worker.recognize(canvas, {}, { text: true, blocks: true })
      return mapOcrPageToPdfText(result.data, canvas, target)
    },
    async terminate() {
      await worker.terminate()
    }
  }
}
