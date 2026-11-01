import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  registeredSymbolMetadataPaths,
  symbolMetadataFor,
  symbolTextLayer,
  symbolTextPresentation
} from '../src/editor/symbol-metadata.js'
import { protectionDescriptionLayout, protectionLabelLayout, protectionPhaseLabelLayout } from '../src/editor/layout/protection-label-layout.ts'

test('keeps protection text semantics outside the SVG geometry', () => {
  const metadata = symbolMetadataFor('symbols/Protection devices/Automaat.svg')
  assert.deepEqual(metadata?.textFields.map(({ key, defaultValue }) => ({ key, defaultValue })), [
    { key: 'description', defaultValue: '' },
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

test('renders the complete RCD marker as serif text instead of geometry', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Residual-current circuit breaker.svg', {
    poles: '',
    phase: '',
    'rated-current': '',
    'residual-current': ''
  })
  assert.match(layer, /font-family:Times New Roman/)
  assert.match(layer, />ΔI</)
})

test('renders the selected RCD classification separately from the serif marker', () => {
  const layer = symbolTextLayer('symbols/Protection devices/Residual-current circuit breaker.svg', {
    poles: '',
    phase: '',
    'rated-current': '',
    'residual-current': '',
    'rcd-type': 'Type A'
  })
  assert.match(layer, />Type A</)
  assert.match(layer, /font-family:Times New Roman[^>]*>ΔI</)
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
  assert.doesNotMatch(rendered.inner, /ΔI/)
  assert.match(rendered.annotations, /<tspan data-field="device-type"[^>]*>ΔI<\/tspan><tspan data-field="residual-current" dx="8">30mA<\/tspan>/)
  assert.match(rendered.annotations, /<tspan data-field="rated-current">63A<\/tspan><tspan data-field="rcd-type" dx="8">Type A<\/tspan>/)
  for (const value of ['63A', '30mA', '2P', 'N-L1']) assert.ok(rendered.annotations.includes(`>${value}</`))
  assert.match(rendered.annotations, /font-size="20"/)
  const edited = symbolTextPresentation({ ...shape, symbolTextOverrides: { ...shape.symbolTextOverrides, 'rated-current': '<40&A>' } })
  assert.match(edited.annotations, /&lt;40&amp;A&gt;/)
  const labels = protectionLabelLayout(shape)!
  const phase = protectionPhaseLabelLayout(shape)!
  assert.equal(phase.x, labels.rightX)
  assert.equal(phase.y, labels.centerY + 40)
  assert.ok(rendered.annotations.includes(`x="${phase.x}" y="${phase.y}" text-anchor="start"`))
  const named = { ...shape, symbolTextOverrides: { ...shape.symbolTextOverrides, description: 'Hoofddiff.' } }
  assert.ok(protectionPhaseLabelLayout(named)!.y >= protectionDescriptionLayout(named)!.y + 28)
  const standalone = symbolTextPresentation({ ...named, generationKey: undefined })
  assert.deepEqual(standalone, symbolTextPresentation(named))
  assert.doesNotMatch(standalone.inner, /N-L1/)
  assert.match(standalone.annotations, /text-anchor="start"[^>]*>N-L1<\/text>/)
})

test('uses the same protection layout and type size for manual, topology and circuit devices', () => {
  for (const name of ['Automaat', 'Residual-current circuit breaker']) {
    const shape = { id: 'device', kind: 'symbol' as const, name,
      path: `symbols/Protection devices/${name}.svg`, position: { x: 300, y: 500 }, scale: 4,
      symbolTextOverrides: { poles: '2P', phase: 'N-L1', 'rated-current': '40A', description: 'Algemene beveiliging' } }
    const manual = symbolTextPresentation(shape)
    for (const generationKey of ['board:main:topology:v30:main-switch', 'board:A:breaker']) {
      assert.deepEqual(symbolTextPresentation({ ...shape, generationKey }), manual)
    }
    assert.doesNotMatch(manual.inner, /N-L1|40A|2P/)
    for (const value of ['2P', 'N-L1', '40A']) {
      const annotation = manual.annotations.split('</text>').find((label) => label.includes(`>${value}</`) || label.endsWith(`>${value}`))!
      assert.match(annotation, /font-size="20" font-weight="400"/)
      assert.match(annotation, /font-family="'IBM Plex Sans','Segoe UI',sans-serif"/)
    }
  }
})
