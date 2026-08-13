import assert from 'node:assert/strict'
import test from 'node:test'
import { detectPdfScanSymbols } from '../src/editor/pdf-scan-symbols.ts'

const image = (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4).fill(255), width, height })
const dark = (source: ReturnType<typeof image>, x: number, y: number) => {
  const offset = (y * source.width + x) * 4
  source.data[offset] = source.data[offset + 1] = source.data[offset + 2] = 0
}

const line = (source: ReturnType<typeof image>, x1: number, y1: number, x2: number, y2: number) => {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / Math.max(1, steps)
    dark(source, Math.round(x1 + (x2 - x1) * fraction), Math.round(y1 + (y2 - y1) * fraction))
  }
}

const arc = (source: ReturnType<typeof image>, cx: number, cy: number, rx: number, ry: number, from: number, to: number) => {
  for (let angle = from; angle <= to; angle += 0.02) {
    dark(source, Math.round(cx + Math.cos(angle) * rx), Math.round(cy + Math.sin(angle) * ry))
  }
}

test('recognizes an isolated circle-with-cross as a light point', () => {
  const source = image(400, 400)
  const center = 200
  const radius = 14
  for (let angle = 0; angle < Math.PI * 2; angle += 0.03) {
    dark(source, Math.round(center + Math.cos(angle) * radius), Math.round(center + Math.sin(angle) * radius))
  }
  for (let offset = -10; offset <= 10; offset += 1) {
    dark(source, center + offset, center + offset)
    dark(source, center + offset, center - offset)
  }
  const symbols = detectPdfScanSymbols(source, { width: 200, height: 200 })
  assert.equal(symbols.length, 1)
  assert.equal(symbols[0].text, 'lichtpunt')
  assert.ok((symbols[0].confidence ?? 0) >= 90)
  assert.deepEqual({ x: symbols[0].x, y: symbols[0].y }, { x: 100, y: 100 })
})

test('does not guess the meaning of an ambiguous empty circle', () => {
  const source = image(400, 400)
  for (let angle = 0; angle < Math.PI * 2; angle += 0.03) {
    dark(source, Math.round(200 + Math.cos(angle) * 14), Math.round(200 + Math.sin(angle) * 14))
  }
  assert.equal(detectPdfScanSymbols(source, { width: 100, height: 100 }).length, 0)
})

test('suggests an unlabelled legacy switch for explicit review', () => {
  const source = image(400, 400)
  arc(source, 190, 210, 8, 8, 0, Math.PI * 2)
  line(source, 194, 203, 207, 185)

  const [symbol] = detectPdfScanSymbols(source, { width: 200, height: 200 })
  assert.equal(symbol?.text, 'schakelaar')
  assert.ok((symbol?.confidence ?? 0) >= 70)
  assert.ok((symbol?.confidence ?? 100) < 85)
})

test('suggests an unlabelled legacy grounded wall outlet for explicit review', () => {
  const source = image(400, 400)
  line(source, 190, 186, 190, 214)
  line(source, 180, 200, 190, 200)
  arc(source, 190, 200, 14, 12, -Math.PI / 2, Math.PI / 2)

  const [symbol] = detectPdfScanSymbols(source, { width: 200, height: 200 })
  assert.equal(symbol?.text, 'stopcontact')
  assert.ok((symbol?.confidence ?? 0) >= 70)
  assert.ok((symbol?.confidence ?? 100) < 85)
})

test('does not classify a plain rectangle as an electrical device', () => {
  const source = image(400, 400)
  line(source, 170, 170, 220, 170)
  line(source, 220, 170, 220, 220)
  line(source, 220, 220, 170, 220)
  line(source, 170, 220, 170, 170)
  assert.equal(detectPdfScanSymbols(source, { width: 200, height: 200 }).length, 0)
})
