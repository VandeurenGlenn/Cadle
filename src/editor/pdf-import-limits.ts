export const MAX_PDF_IMPORT_BYTES = 75 * 1024 * 1024
export const MAX_PDF_IMPORT_PAGES = 100
export const PDF_THUMBNAIL_PIXELS = 240_000
export const PDF_THUMBNAIL_DIMENSION = 900

export class PdfImportCancelledError extends Error {
  constructor() {
    super('PDF import cancelled.')
    this.name = 'PdfImportCancelledError'
  }
}

export const pdfImportFileError = (byteLength: number): string | undefined => {
  if (!Number.isFinite(byteLength) || byteLength < 0) return 'The PDF file size is invalid.'
  if (byteLength > MAX_PDF_IMPORT_BYTES) {
    return `This PDF is larger than ${Math.round(MAX_PDF_IMPORT_BYTES / 1024 / 1024)} MB. Split or compress it before importing.`
  }
}

export const pdfImportPageCountError = (pageCount: number): string | undefined => {
  if (!Number.isInteger(pageCount) || pageCount < 1) return 'The PDF contains no importable pages.'
  if (pageCount > MAX_PDF_IMPORT_PAGES) {
    return `This PDF contains more than ${MAX_PDF_IMPORT_PAGES} pages. Split it into smaller files before importing.`
  }
}

export const releasePdfCanvas = (canvas?: HTMLCanvasElement): void => {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}
