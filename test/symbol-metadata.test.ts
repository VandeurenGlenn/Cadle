import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  registeredSymbolMetadataPaths,
  symbolMetadataFor,
  symbolTextLayer
} from '../src/editor/symbol-metadata.js'

test('keeps protection text semantics outside the SVG geometry', () => {
  const metadata = symbolMetadataFor('symbols/Protection devices/Automaat.svg')
  assert.deepEqual(metadata?.textFields.map(({ key, defaultValue }) => ({ key, defaultValue })), [
    { key: 'poles', defaultValue: 'nP' },
    { key: 'phase', defaultValue: 'n' },
    { key: 'rated-current', defaultValue: '20A' }
  ])
})

test('renders registered symbol labels and accepts legacy override keys', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Automaat.svg', {
    'desc:nP': '2P',
    'desc:n': '1N',
    'desc:20A': 'C16A'
  })
  assert.match(layer, />2P</)
  assert.match(layer, />1N</)
  assert.match(layer, />C16A</)
  assert.doesNotMatch(layer, />20A</)
})

test('escapes metadata-backed symbol labels', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Fuse.svg', {
    'rated-current': '<20&A>'
  })
  assert.match(layer, /&lt;20&amp;A&gt;/)
})

test('renders the RCD device type as a serif letter instead of geometry', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Residual-current circuit breaker.svg', {
    poles: '',
    phase: '',
    'rated-current': '',
    'residual-current': ''
  })
  assert.match(layer, /font-family:Times New Roman/)
  assert.match(layer, />I</)
})

test('renders the selected RCD classification separately from the serif I marker', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Residual-current circuit breaker.svg', {
    poles: '',
    phase: '',
    'rated-current': '',
    'residual-current': '',
    'rcd-type': 'Type A'
  })
  assert.match(layer, />Type A</)
  assert.match(layer, /font-family:Times New Roman[^>]*>I</)
})

test('registers every SVG with metadata-backed visible text', () => {
  assert.equal(registeredSymbolMetadataPaths().length, 16)
})
