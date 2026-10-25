import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  registeredSymbolMetadataPaths,
  symbolMetadataFor,
  symbolTextLayer,
  symbolTextPresentation
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

test('prints editable topology protection values at 2.5 mm outside the symbol viewBox', () => {
  const shape = {
    id: 'protection', kind: 'symbol' as const,
    path: 'symbols/Protection devices/Residual-current circuit breaker.svg',
    name: 'Differential', position: { x: 300, y: 500 }, scale: 2.2,
    generationKey: 'board:main:topology:v19:main-differential',
    symbolTextOverrides: { poles: '2P', phase: 'N-L1', 'rated-current': '63A', 'residual-current': '30mA' }
  }
  const rendered = symbolTextPresentation(shape)
  assert.doesNotMatch(rendered.inner, /63A|30mA|2P|N-L1/)
  assert.match(rendered.inner, />I</)
  for (const value of ['63A', '30mA', '2P', 'N-L1']) assert.ok(rendered.annotations.includes(`>${value}</text>`))
  assert.match(rendered.annotations, /font-size="20"/)
  const edited = symbolTextPresentation({ ...shape, symbolTextOverrides: { ...shape.symbolTextOverrides, 'rated-current': '<40&A>' } })
  assert.match(edited.annotations, /&lt;40&amp;A&gt;/)
})
