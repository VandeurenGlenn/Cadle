import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PDF_IMPORT_BYTES,
  MAX_PDF_IMPORT_PAGES,
  pdfImportFileError,
  pdfImportPageCountError,
  releasePdfCanvas
} from '../src/editor/pdf-import-limits.ts'

test('accepts practical PDFs and rejects files that can exhaust browser memory', () => {
  assert.equal(pdfImportFileError(MAX_PDF_IMPORT_BYTES), undefined)
  assert.match(pdfImportFileError(MAX_PDF_IMPORT_BYTES + 1) ?? '', /larger than 75 MB/)
  assert.match(pdfImportFileError(Number.NaN) ?? '', /invalid/)
})

test('bounds the number of pages analyzed in one import', () => {
  assert.equal(pdfImportPageCountError(MAX_PDF_IMPORT_PAGES), undefined)
  assert.match(pdfImportPageCountError(MAX_PDF_IMPORT_PAGES + 1) ?? '', /more than 100 pages/)
  assert.match(pdfImportPageCountError(0) ?? '', /no importable pages/)
})

test('releases retained canvas pixel buffers', () => {
  const canvas = { width: 800, height: 1200 } as HTMLCanvasElement
  releasePdfCanvas(canvas)
  assert.equal(canvas.width, 0)
  assert.equal(canvas.height, 0)
})
