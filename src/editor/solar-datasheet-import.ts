import { createPdfScanOcrSession, type PdfScanOcrSession } from './pdf-scan-ocr.js'
import { pdfImportFileError, pdfImportPageCountError, releasePdfCanvas } from './pdf-import-limits.js'
import { normalizeSolarDatasheetHeaderContrast, parseInverterDatasheet, parseSolarDatasheet, solarDatasheetRows,
  solarPanelFields } from './solar-installation.js'

const maximumBlindOcrPages = 10

export const shouldOcrSolarDatasheetPage = (text: string, pageCount: number): boolean =>
  solarPanelFields.some(({ pattern }) => pattern.test(text)) ||
  /\b(?:rated\s*(?:AC\s*)?output\s*power|nominal\s*(?:AC\s*)?(?:output\s*)?power|number\s*of\s*MPP(?:T)?\s*trackers|max(?:imum)?\.?\s*input\s*voltage)\b/i.test(text) ||
  (pageCount <= maximumBlindOcrPages && text.trim().length < 40)

const hasReliableDatasheetValues = (text: string): boolean => {
  const { panels } = parseSolarDatasheet(text)
  if (panels.length && panels.every((panel) => !!panel.model?.trim() &&
    typeof panel.powerWp === 'number' && Number.isFinite(panel.powerWp) && panel.powerWp > 0)) {
    return true
  }
  const { inverters } = parseInverterDatasheet(text)
  return inverters.length > 0 && inverters.every((inverter) =>
    !!inverter.inverterModel?.trim() && typeof inverter.inverterPowerW === 'number' &&
    Number.isFinite(inverter.inverterPowerW) && inverter.inverterPowerW > 0)
}

export const readSolarDatasheet = async (
  file: File,
  onStatus: (status: string) => void,
  isCurrent: () => boolean
): Promise<string> => {
  let ocr: PdfScanOcrSession | undefined
  const checkCancelled = () => {
    if (!isCurrent()) throw new DOMException('Lezen geannuleerd.', 'AbortError')
  }
  const recognize = async (canvas: HTMLCanvasElement, label: string): Promise<string> => {
    checkCancelled()
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Afbeelding kan niet worden voorbereid.')
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    normalizeSolarDatasheetHeaderContrast(pixels)
    context.putImageData(pixels, 0, 0)
    ocr ??= await createPdfScanOcrSession((_status, progress) => {
      if (isCurrent()) onStatus(`${label} ${Math.round(progress * 20) * 5}%`)
    })
    checkCancelled()
    return solarDatasheetRows((await ocr.recognize(canvas, canvas, 0)).texts)
  }
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const fileError = pdfImportFileError(file.size)
      if (fileError) throw new Error(fileError)
      const pdfjs = await import('pdfjs-dist')
      checkCancelled()
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', import.meta.url).href
      }
      const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
      try {
        const pdf = await task.promise
        const pageError = pdfImportPageCountError(pdf.numPages)
        if (pageError) throw new Error(pageError)
        const pages: string[] = []
        for (let index = 1; index <= pdf.numPages; index++) {
          checkCancelled()
          onStatus(`PDF lokaal lezen… pagina ${index}/${pdf.numPages}`)
          const page = await pdf.getPage(index)
          try {
            const viewport = page.getViewport({ scale: 1 })
            const content = await page.getTextContent()
            const texts = content.items.flatMap((item) => {
              if (!('str' in item) || !item.str.trim()) return []
              const transform = pdfjs.Util.transform(viewport.transform, item.transform)
              return [{ text: item.str, x: transform[4], y: transform[5],
                fontSize: Math.max(1, Math.hypot(transform[2], transform[3])) }]
            })
            const extracted = solarDatasheetRows(texts)
            if (hasReliableDatasheetValues(extracted) || !shouldOcrSolarDatasheetPage(extracted, pdf.numPages)) {
              pages.push(extracted)
            }
            else {
              const canvas = document.createElement('canvas')
              try {
                const scale = Math.min(3, 2600 / viewport.width, 3400 / viewport.height)
                const scanViewport = page.getViewport({ scale })
                canvas.width = Math.ceil(scanViewport.width)
                canvas.height = Math.ceil(scanViewport.height)
                const context = canvas.getContext('2d')
                if (!context) throw new Error('PDF-pagina kan niet worden voorbereid.')
                await page.render({ canvasContext: context, canvas, viewport: scanViewport, background: '#ffffff' }).promise
                pages.push(await recognize(canvas, `PDF-scan lokaal lezen… pagina ${index}/${pdf.numPages}`))
              } finally { releasePdfCanvas(canvas) }
            }
          } finally { page.cleanup() }
        }
        checkCancelled()
        return pages.join('\n')
      } finally { await task.destroy() }
    }

    checkCancelled()
    onStatus('Afbeelding lokaal lezen…')
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    try {
      const factor = Math.min(3, 2600 / bitmap.width, 3400 / bitmap.height)
      canvas.width = Math.max(1, Math.round(bitmap.width * factor))
      canvas.height = Math.max(1, Math.round(bitmap.height * factor))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Afbeelding kan niet worden voorbereid.')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return await recognize(canvas, 'Afbeelding lokaal lezen…')
    } finally {
      bitmap.close()
      releasePdfCanvas(canvas)
    }
  } finally { await ocr?.terminate() }
}
