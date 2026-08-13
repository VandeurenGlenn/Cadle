import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPdfImportCorrections,
  confirmPdfReviewSuggestions,
  pdfReviewCounts,
  pdfReviewStatus,
  parsePdfImportCorrections,
  serializePdfImportCorrections,
  setPdfReviewLineKind,
  setPdfReviewTextKind,
  setPdfReviewTextValue
} from '../src/editor/pdf-import-review.ts'

const page = {
  width: 100,
  height: 100,
  lines: [{ x1: 0, y1: 0, x2: 100, y2: 0, lineWidth: 2 }],
  texts: [{ text: 'Differentied 4P 40A', x: 10, y: 20, fontSize: 8, confidence: 72 }]
}

test('reviews text, symbol choice and line type without mutating the source', () => {
  assert.equal(pdfReviewStatus(page.texts[0]), 'check')
  const renamed = setPdfReviewTextValue(page, 0, 'Differentieel 4P 40A')
  const classified = setPdfReviewTextKind(renamed, 0, 'rcd')
  const reviewed = setPdfReviewLineKind(classified, 0, 'line')
  assert.equal(page.texts[0].text, 'Differentied 4P 40A')
  assert.equal(reviewed.texts[0].originalText, 'Differentied 4P 40A')
  assert.equal(reviewed.texts[0].recognizedKind, 'rcd')
  assert.equal(reviewed.lines[0].reviewKind, 'line')
})

test('blocks on uncertain electrical items until explicitly confirmed', () => {
  assert.deepEqual(pdfReviewCounts(page), {
    confirmed: 0,
    check: 1,
    unrecognized: 0,
    plain: 0,
    unresolved: 1
  })
  const confirmed = confirmPdfReviewSuggestions(page)
  assert.equal(pdfReviewCounts(confirmed).unresolved, 0)
})

test('keeps image-recognized switch and socket suggestions unresolved below the safe threshold', () => {
  for (const text of ['schakelaar', 'stopcontact']) {
    assert.equal(pdfReviewStatus({ text, x: 10, y: 10, fontSize: 8, confidence: 82 }), 'check')
  }
  assert.equal(pdfReviewStatus({ text: 'lichtpunt', x: 10, y: 10, fontSize: 8, confidence: 94 }), 'confirmed')
})

test('requires detected door and window suggestions to be confirmed', () => {
  const suggested = {
    ...page,
    lines: [{ ...page.lines[0], reviewKind: 'door' as const, reviewPending: true }]
  }
  assert.equal(pdfReviewCounts(suggested).unresolved, 2)
  const confirmed = confirmPdfReviewSuggestions(suggested)
  assert.equal(confirmed.lines[0].reviewPending, false)
  assert.equal(pdfReviewCounts(confirmed).unresolved, 0)
})

test('reapplies saved local corrections to a later import', () => {
  const corrected = applyPdfImportCorrections(page, [{
    source: 'differentied 4p 40a',
    kind: 'rcd',
    correctedText: 'Differentieel 4P 40A'
  }])
  assert.equal(corrected.texts[0].text, 'Differentieel 4P 40A')
  assert.equal(corrected.texts[0].recognizedKind, 'rcd')
})

test('round-trips a validated portable correction dictionary', () => {
  const serialized = serializePdfImportCorrections([{ source: 'Differentied', kind: 'rcd', correctedText: 'Differentieel' }])
  assert.deepEqual(parsePdfImportCorrections(serialized), [
    { source: 'Differentied', kind: 'rcd', correctedText: 'Differentieel' }
  ])
  assert.throws(() => parsePdfImportCorrections('{"not":"a list"}'), /JSON array/)
  assert.throws(() => parsePdfImportCorrections('[{"source":"x","kind":"unknown"}]'), /No valid/)
})
