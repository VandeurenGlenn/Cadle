import assert from 'node:assert/strict'
import test from 'node:test'
import {
  convertPdfVectorPageToCadle,
  extractPdfVectorPage
} from '../src/editor/pdf-vector-conversion.ts'

test('extracts compact DrawOPS paths emitted by current PDF.js', async () => {
  const page = {
    async getTextContent() {
      return { items: [] }
    },
    async getOperatorList() {
      return {
        fnArray: [2, 3],
        argsArray: [
          [3],
          [20, [new Float32Array([0, 10, 10, 1, 90, 10, 1, 90, 70, 1, 10, 70, 4])], [10, 10, 90, 70]]
        ]
      }
    }
  }
  const vector = await extractPdfVectorPage(page, [1, 0, 0, 1, 0, 0], 100, 80, {
    save: 8,
    restore: 9,
    transform: 10,
    setLineWidth: 2,
    constructPath: 3,
    moveTo: 13,
    lineTo: 14,
    rectangle: 19
  })

  assert.equal(vector.lines.length, 4)
  assert.ok(vector.lines.every((line) => line.lineWidth === 3))
})

test('converts PDF vector lines and text into editable Cadle shapes', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [
      { x1: 10, y1: 10, x2: 90, y2: 10, lineWidth: 2 },
      { x1: 20, y1: 30, x2: 80, y2: 30, lineWidth: 0.5 }
    ],
    texts: [{ text: 'Kitchen', x: 40, y: 50, fontSize: 10 }]
  }, { x: 100, y: 200, width: 1000, height: 800 })

  assert.equal(converted.shapes[0].kind, 'wall')
  assert.equal(converted.shapes[1].kind, 'line')
  assert.equal(converted.shapes[2].kind, 'text')
  assert.equal(converted.summary.walls, 1)
})

test('replaces confidently labelled legacy devices with current Cadle symbols', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [],
    texts: [
      { text: 'stopcontact', x: 20, y: 30, fontSize: 8 },
      { text: 'automaat 2P C16A', x: 50, y: 70, fontSize: 8 },
      { text: 'diff 4P 40A 300mA', x: 70, y: 80, fontSize: 8 }
    ]
  }, { x: 0, y: 0, width: 1000, height: 1000 })

  const symbols = converted.shapes.filter((shape) => shape.kind === 'symbol')
  assert.equal(symbols.length, 3)
  const breaker = symbols.find((shape) => shape.kind === 'symbol' && /Automaat/.test(shape.name))
  assert.equal(breaker?.kind === 'symbol' ? breaker.electrical?.breakerCurrentA : null, 16)
  assert.equal(breaker?.kind === 'symbol' ? breaker.symbolTextOverrides?.poles : null, '2P')
  const rcd = symbols.find((shape) => shape.kind === 'symbol' && /Residual/.test(shape.name))
  assert.equal(rcd?.kind === 'symbol' ? rcd.electrical?.rcdSensitivityMa : null, 300)
})

test('corrects high-confidence OCR noise using the electrical vocabulary', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [],
    texts: [
      { text: 'Automaat 4P G20A', x: 20, y: 30, fontSize: 8, confidence: 86 },
      { text: 'Differentied! 4P 40A 30mA', x: 50, y: 70, fontSize: 8, confidence: 85 }
    ]
  }, { x: 0, y: 0, width: 1000, height: 1000 })

  const symbols = converted.shapes.filter((shape) => shape.kind === 'symbol')
  assert.equal(symbols.length, 2)
  const breaker = symbols.find((shape) => shape.kind === 'symbol' && /Automaat/.test(shape.name))
  assert.equal(breaker?.kind === 'symbol' ? breaker.symbolTextOverrides?.['rated-current'] : null, 'C20A')
  const rcd = symbols.find((shape) => shape.kind === 'symbol' && /Residual/.test(shape.name))
  assert.equal(rcd?.kind === 'symbol' ? rcd.symbolTextOverrides?.['residual-current'] : null, '30mA')
})

test('honors reviewed symbol and line overrides during final conversion', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [
      { x1: 0, y1: 10, x2: 100, y2: 10, lineWidth: 3, reviewKind: 'line' },
      { x1: 0, y1: 20, x2: 100, y2: 20, lineWidth: 3, reviewKind: 'ignore' }
    ],
    texts: [
      { text: 'mystery', x: 20, y: 30, fontSize: 8, recognizedKind: 'socket' },
      { text: 'remove me', x: 20, y: 40, fontSize: 8, recognizedKind: 'ignore' }
    ]
  }, { x: 0, y: 0, width: 100, height: 100 })

  assert.deepEqual(converted.shapes.map((shape) => shape.kind), ['line', 'symbol'])
  assert.equal(converted.shapes[1].kind === 'symbol' ? converted.shapes[1].name : '', 'Wall outlet with grounding')
})

test('creates native Cadle door, window, and gate line shapes from reviewed PDF strokes', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [
      { x1: 0, y1: 10, x2: 20, y2: 10, lineWidth: 2, reviewKind: 'door' },
      { x1: 30, y1: 10, x2: 50, y2: 10, lineWidth: 2, reviewKind: 'window' },
      { x1: 60, y1: 10, x2: 80, y2: 10, lineWidth: 2, reviewKind: 'gate' }
    ],
    texts: []
  }, { x: 0, y: 0, width: 100, height: 100 })

  assert.deepEqual(converted.shapes.map((shape) => shape.kind), ['door', 'window', 'gate'])
  assert.equal(converted.summary.walls, 0)
})

test('preserves the detected wall binding of a reviewed opening', () => {
  const converted = convertPdfVectorPageToCadle({
    width: 100,
    height: 100,
    lines: [
      { x1: 0, y1: 20, x2: 100, y2: 20, lineWidth: 3 },
      { x1: 30, y1: 20, x2: 50, y2: 20, lineWidth: 1, reviewKind: 'door', boundWallIndex: 0 }
    ],
    texts: []
  }, { x: 0, y: 0, width: 100, height: 100 })
  const [wall, door] = converted.shapes
  assert.equal(wall.kind, 'wall')
  assert.equal(door.kind, 'door')
  assert.equal(door.kind === 'door' ? door.wallId : '', wall.id)
})
