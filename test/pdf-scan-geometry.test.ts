import assert from 'node:assert/strict'
import test from 'node:test'
import { detectPdfScanGeometry, mergePdfScanLines } from '../src/editor/pdf-scan-geometry.ts'

const whiteImage = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { data, width, height }
}

const blackRect = (image: ReturnType<typeof whiteImage>, x: number, y: number, width: number, height: number) => {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const offset = (py * image.width + px) * 4
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 0
    }
  }
}

test('detects long raster walls but ignores short text-like strokes', () => {
  const image = whiteImage(200, 120)
  blackRect(image, 20, 20, 160, 4)
  blackRect(image, 20, 20, 4, 80)
  blackRect(image, 70, 60, 10, 2)

  const lines = detectPdfScanGeometry(image, { width: 100, height: 60 }, { minimumLengthRatio: 0.1 })
  assert.equal(lines.length, 2)
  const horizontal = lines.find((line) => line.y1 === line.y2)
  const vertical = lines.find((line) => line.x1 === line.x2)
  assert.ok(horizontal)
  assert.ok(vertical)
  assert.ok((horizontal?.lineWidth ?? 0) >= 2)
  assert.ok((vertical?.lineWidth ?? 0) >= 2)
})

test('keeps a long single-pixel conductor as a thin editable line', () => {
  const image = whiteImage(200, 100)
  blackRect(image, 20, 50, 160, 1)
  const [line] = detectPdfScanGeometry(image, { width: 100, height: 50 })
  assert.ok(line)
  assert.ok(line.lineWidth < 1.5)
})

test('detects long diagonal raster strokes', () => {
  const image = whiteImage(160, 120)
  for (let offset = 0; offset < 80; offset += 1) blackRect(image, 25 + offset, 20 + offset, 1, 1)

  const lines = detectPdfScanGeometry(image, { width: 160, height: 120 }, { minimumLengthRatio: 0.1 })
  assert.ok(lines.some((line) => Math.abs(Math.abs(line.x2 - line.x1) - Math.abs(line.y2 - line.y1)) < 2))
})

test('merges nearby collinear scan fragments but keeps separate parallel lines', () => {
  const merged = mergePdfScanLines([
    { x1: 0, y1: 10, x2: 40, y2: 10, lineWidth: 2 },
    { x1: 43, y1: 10, x2: 80, y2: 10, lineWidth: 3 },
    { x1: 0, y1: 20, x2: 80, y2: 20, lineWidth: 2 }
  ], 5, 2)

  assert.equal(merged.length, 2)
  assert.ok(merged.some((line) => line.x1 === 0 && line.x2 === 80 && line.y1 === 10 && line.lineWidth === 3))
})

test('merges a large raster fragment set into bounded editable geometry', () => {
  const fragments = Array.from({ length: 1000 }, (_, index) => {
    const row = index % 100
    const column = Math.floor(index / 100)
    return { x1: column * 11, y1: row * 10, x2: column * 11 + 10, y2: row * 10, lineWidth: 2 }
  })
  const merged = mergePdfScanLines(fragments, 2, 1)
  assert.equal(merged.length, 100)
  assert.ok(merged.every((line) => line.x2 - line.x1 === 109))
})
