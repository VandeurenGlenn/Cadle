import assert from 'node:assert/strict'
import test from 'node:test'
import { createHeatingPipe, heatingDefaults, heatingMarkup } from '../src/editor/heating-plan.ts'
import { heatingPipeGeometry } from '../src/editor/heating-geometry.ts'
import { heatingCircuitColor, heatingCircuitLabelPosition } from '../src/editor/heating-presentation.ts'

const circuit = (circuitId = 'VV01', role: 'loop' | 'supply' | 'return' = 'loop') => createHeatingPipe(`shape-${circuitId}-${role}`,
  [{ x: 20, y: 20 }, { x: 44, y: 20 }, { x: 44, y: 44 }, { x: 20, y: 44 }, { x: 20, y: 28 }],
  { ...heatingDefaults('pipe', 100), automatic: true, circuitId, pipeRole: role, diameterMm: 16, spacingMm: 100 })

test('automatic circuits keep one alternating colour through their loop and both solid feeds', () => {
  for (const id of ['VV01', 'VV02', 'VV11', 'VV12']) for (const role of ['loop', 'supply', 'return'] as const) {
    const markup = heatingMarkup(circuit(id, role))
    assert.match(markup, new RegExp(`class="heating-circuit"[^>]+stroke="${heatingCircuitColor(id)}"`))
    assert.doesNotMatch(markup, /stroke-dasharray/)
    assert.match(markup, new RegExp(`data-circuit-id="${id}"`))
    assert.match(markup, new RegExp(`<title>${id} ·`))
  }
  assert.notEqual(heatingCircuitColor('VV01'), heatingCircuitColor('VV02'))
  assert.equal(heatingCircuitColor('VV01'), heatingCircuitColor('VV11'))
  assert.equal(heatingCircuitColor('VV02'), heatingCircuitColor('VV12'))
})

test('automatic presentation preserves exact paths, selection and custom stroke widths', () => {
  const shape = circuit(), before = JSON.stringify(shape), path = heatingPipeGeometry(shape).path
  const markup = heatingMarkup(shape, true)
  assert.ok(markup.includes(`d="${path}"`))
  assert.match(markup, /data-selected="true"/)
  assert.match(markup, /stroke-width="1\.5" stroke-linecap/)
  shape.strokeWidth = 3
  assert.match(heatingMarkup(shape), /stroke-width="3" stroke-linecap/)
  shape.strokeWidth = 1.5
  assert.equal(JSON.stringify(shape), before)
  assert.equal(heatingPipeGeometry(shape).path, path)
})

test('a compact circuit ID occupies a safe body centre and is suppressed behind a fixture', () => {
  const shape = circuit('VV12'), before = JSON.stringify(shape)
  const label = heatingCircuitLabelPosition(shape)!
  assert.deepEqual({ x: label.x, y: label.y, text: label.text, fontSize: label.fontSize }, { x: 32, y: 32, text: '12', fontSize: 12 })
  const markup = heatingMarkup(shape)
  assert.match(markup, /class="heating-circuit-label" x="32" y="32"[^>]*>12<\/text>/)
  assert.doesNotMatch(markup, /font-size="20"/)
  assert.equal(heatingCircuitLabelPosition(shape, [{ x: 25, y: 25, width: 14, height: 14 }]), undefined)
  assert.doesNotMatch(heatingMarkup(shape, false, false, [{ x: 25, y: 25, width: 14, height: 14 }]), /heating-circuit-label/)
  assert.equal(JSON.stringify(shape), before)
})

test('monochrome output is explicitly black while manual flow colours remain available', () => {
  const auto = heatingMarkup(circuit('VV02'), false, true)
  assert.match(auto, /class="heating-circuit"[^>]+stroke="#000000"/)
  assert.match(auto, /heating-circuit-label[^>]+fill="#000000"/)
  for (const role of ['supply', 'return'] as const) {
    const manual = circuit('VV01', role)
    manual.heating!.automatic = false
    assert.match(heatingMarkup(manual), new RegExp(`stroke="${role === 'return' ? '#175cd3' : '#b42318'}"`))
    assert.match(heatingMarkup(manual), /font-size="20"/)
  }
})

test('new automatic feed widths stay distinct in a 20 mm bundle and match their rendered property', () => {
  const feed = circuit('VV01', 'supply'), loop = circuit('VV01')
  assert.equal(feed.strokeWidth, 1)
  assert.equal(loop.strokeWidth, 1.5)
  assert.match(heatingMarkup(feed), /stroke-width="1" stroke-linecap/)
  const manual = createHeatingPipe('manual', [{ x: 0, y: 0 }, { x: 0, y: 80 }], heatingDefaults('pipe', 100))
  assert.equal(manual.strokeWidth, 2)
})
