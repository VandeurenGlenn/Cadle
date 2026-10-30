import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fitPdfPageToPaper,
  importedPlanPageName,
  paperPresetForPdfPage,
  pdfPreviewRenderScale
} from '../src/editor/pdf-plan-import.ts'
import { pageLayout } from '../src/editor/layout/page-layout.ts'

test('recognizes common A4 and A3 PDF page sizes', () => {
  assert.equal(paperPresetForPdfPage(595, 842), 'a4-portrait')
  assert.equal(paperPresetForPdfPage(1191, 842), 'a3-landscape')
})

test('fits an imported page inside the printable paper area', () => {
  const fitted = fitPdfPageToPaper(595, 842, 'a4-portrait', 10)
  assert.equal(fitted.worldWidth, 1680)
  assert.equal(fitted.worldHeight, 2376)
  const area = pageLayout(1680, 2376).content
  assert.ok(fitted.width <= area.width)
  assert.ok(fitted.height <= area.height)
  assert.deepEqual(fitted.position, { x: area.x + area.width / 2, y: area.y + area.height / 2 })
  assert.ok(fitted.position.y + fitted.height / 2 <= area.y + area.height)
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
