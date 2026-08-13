import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzePdfScanQuality } from '../src/editor/pdf-scan-preprocess.ts'

const image = (width: number, height: number, value = 245) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = value
    data[index + 3] = 255
  }
  return { data, width, height }
}

const pixel = (source: ReturnType<typeof image>, x: number, y: number, value: number) => {
  if (x < 0 || y < 0 || x >= source.width || y >= source.height) return
  const index = (y * source.width + x) * 4
  source.data[index] = source.data[index + 1] = source.data[index + 2] = value
}

test('reports low contrast and estimates a small scan skew', () => {
  const source = image(320, 220, 210)
  for (const baseY of [50, 100, 150]) {
    for (let x = 25; x < 295; x += 1) {
      const y = Math.round(baseY + Math.tan(2 * Math.PI / 180) * x)
      pixel(source, x, y, 105)
      pixel(source, x, y + 1, 105)
    }
  }
  const quality = analyzePdfScanQuality(source)
  assert.ok(quality.contrast < 0.5)
  assert.ok(Math.abs(quality.skewDegrees) >= 1.5)
  assert.ok(quality.warnings.some((warning) => warning.includes('contrast')))
  assert.ok(quality.warnings.some((warning) => warning.includes('straightened')))
})
