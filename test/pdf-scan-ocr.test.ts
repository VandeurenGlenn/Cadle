import assert from 'node:assert/strict'
import test from 'node:test'
import { mapOcrPageToPdfText } from '../src/editor/pdf-scan-ocr.ts'

test('maps confident OCR lines onto PDF coordinates', () => {
  const result = mapOcrPageToPdfText({
    confidence: 87,
    blocks: [{
      paragraphs: [{
        lines: [
          { text: '  Automaat 4P C20A  ', confidence: 92, bbox: { x0: 100, y0: 80, x1: 300, y1: 110 } },
          { text: 'unreadable', confidence: 32, bbox: { x0: 10, y0: 10, x1: 90, y1: 30 } }
        ]
      }]
    }]
  }, { width: 1000, height: 500 }, { width: 500, height: 250 })

  assert.equal(result.confidence, 87)
  assert.deepEqual(result.texts, [{
    text: 'Automaat 4P C20A',
    x: 50,
    y: 40,
    fontSize: 15,
    confidence: 92
  }])
})
