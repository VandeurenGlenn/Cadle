import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SYMBOL_STROKE_WIDTH,
  normalizeSymbolStrokeWidth,
  readSymbolStrokeWidth,
  writeSymbolStrokeWidth
} from '../src/preferences/symbol-stroke-width.ts'

test('normalizes symbol stroke widths to the supported range', () => {
  assert.equal(normalizeSymbolStrokeWidth('0.8'), 0.8)
  assert.equal(normalizeSymbolStrokeWidth(0), 0.1)
  assert.equal(normalizeSymbolStrokeWidth(8), 3)
  assert.equal(normalizeSymbolStrokeWidth('invalid'), DEFAULT_SYMBOL_STROKE_WIDTH)
})

test('reads and writes symbol stroke width through an injected storage adapter', () => {
  let stored: string | null = '1.2'
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value
    }
  }

  assert.equal(readSymbolStrokeWidth(storage), 1.2)
  assert.equal(writeSymbolStrokeWidth(4, storage), 3)
  assert.equal(stored, '3')
})

test('falls back when symbol stroke width storage is unavailable', () => {
  const storage = {
    getItem: () => {
      throw new Error('unavailable')
    }
  }

  assert.equal(readSymbolStrokeWidth(storage), DEFAULT_SYMBOL_STROKE_WIDTH)
})
