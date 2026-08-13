import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fitPdfPageToPaper,
  importedPlanPageName,
  paperPresetForPdfPage,
  pdfPreviewRenderScale
} from '../src/editor/pdf-plan-import.ts'

test('recognizes common A4 and A3 PDF page sizes', () => {
  assert.equal(paperPresetForPdfPage(595, 842), 'a4-portrait')
  assert.equal(paperPresetForPdfPage(1191, 842), 'a3-landscape')
})

test('fits an imported page inside the printable paper area', () => {
  const fitted = fitPdfPageToPaper(595, 842, 'a4-portrait', 10)
  assert.equal(fitted.worldWidth, 1680)
  assert.equal(fitted.worldHeight, 2376)
  assert.ok(fitted.width <= 1520)
  assert.ok(fitted.height <= 2216)
  assert.deepEqual(fitted.position, { x: 840, y: 1188 })
})

test('uses the PDF filename and adds page numbers only when needed', () => {
  assert.equal(importedPlanPageName('house-old.pdf', 1, 1), 'house-old')
  assert.equal(importedPlanPageName('house-old.pdf', 2, 3), 'house-old – page 2')
})

test('bounds preview memory for oversized PDF pages without shrinking normal A4 pages', () => {
  assert.equal(pdfPreviewRenderScale(595, 842), 1.5)
  const scale = pdfPreviewRenderScale(4000, 6000)
  assert.ok(scale < 0.5)
  assert.ok(4000 * scale * 6000 * scale <= 3_000_001)
  assert.ok(6000 * scale <= 2400)
})
