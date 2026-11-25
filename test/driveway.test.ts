import assert from 'node:assert/strict'
import test from 'node:test'
import { createDriveway, createDrivewayArea, drivewayAreaError, drivewayGeometry, drivewayRouteError } from '../src/editor/model/driveway.ts'
import { cloneShape, sanitizeShapes, scaleShape } from '../src/editor/model/model.ts'
import { translateShape } from '../src/editor/interaction/shape-transforms.ts'
import { createNativeSelectionChangedPayload } from '../src/editor/interaction/selection-payload.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { buildSvgDocument } from '../src/editor/export/svg-export.ts'
import { PAPER_PRESETS } from '../src/editor/constants.ts'
import { bindingLabelsMarkup } from '../src/editor/svg-templates.ts'
import type { RectShape, SymbolShape } from '../src/editor/model/types.ts'

const points = [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 600 }]

test('driveway routes retain width and rounded bends through save, clone, move and scale', () => {
  const shape = createDriveway('driveway', points, 120, 'gravel', true)
  const geometry = drivewayGeometry(shape)
  assert.equal(geometry.width, 120)
  assert.match(geometry.path, /Q 500 200/)
  assert.deepEqual(sanitizeShapes(JSON.parse(JSON.stringify([shape]))), [shape])
  const clone = cloneShape(shape) as RectShape
  clone.drivewayRoute!.points[0].x = 0
  assert.notDeepEqual(clone.drivewayRoute, shape.drivewayRoute)
  assert.equal(drivewayGeometry(scaleShape(shape, 2, 2) as RectShape).width, 240)
  assert.match(drivewayGeometry(translateShape(shape, 50, 20) as RectShape).path, /Q 550 220/)
  assert.match(drivewayRouteError([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 0 }], 80)!, /Keer niet/)
  assert.deepEqual(sanitizeShapes([{ ...shape, drivewayRoute: { points: [{ x: NaN, y: 0 }], width: 0 } }]), [])
})

test('driveway material and bends remain editable and export beneath walls and symbols', () => {
  const shape = createDriveway('driveway', points, 120, 'cobbles', true)
  const changed = updateSelectionProperties([shape], {
    drivewayMaterial: 'pavers', drivewayCurved: false
  }, { selectedIds: new Set([shape.id]), selectedId: shape.id, groupedSelection: false })![0] as RectShape
  assert.equal(createNativeSelectionChangedPayload(changed, 1).shape?.drivewayMaterial, 'pavers')
  assert.doesNotMatch(drivewayGeometry(changed).path, / Q /)
  const svg = buildSvgDocument({
    shapes: [{ id: 'wall', kind: 'wall', start: { x: 100, y: 200 }, end: { x: 500, y: 200 } }, changed],
    selectedShape: null, paper: PAPER_PRESETS['a4-landscape'], worldWidth: 1000, worldHeight: 1000
  })
  assert.ok(svg.indexOf('data-shape-id="driveway"') < svg.indexOf('data-shape-id="wall"'))
  assert.match(svg, /stroke="url\(#driveway-pavers\)"/)
  assert.match(svg, /<pattern id="driveway-pavers"/)
  const mono = buildSvgDocument({
    shapes: [changed], selectedShape: null, paper: PAPER_PRESETS['a4-landscape'],
    worldWidth: 1000, worldHeight: 1000, monochrome: true
  })
  assert.match(mono, /stroke="#333333"/)
  assert.doesNotMatch(mono, /#c8b9ac|#625d56/)
})

test('driveway paving does not suppress or displace automatic circuit labels', () => {
  const lamp: SymbolShape = {
    id: 'lamp', kind: 'symbol', name: 'Lighting', path: 'symbols/Consumption appliances/Lighting.svg',
    position: { x: 300, y: 200 }, scale: 1.5, bindingId: 'A1'
  }
  const labels = bindingLabelsMarkup([lamp])
  assert.match(labels, />A1<\/text>/)
  for (const material of ['cobbles', 'gravel', 'pavers'] as const) {
    const driveway = createDriveway('driveway', points, 240, material, true)
    const shapes = [lamp, driveway]
    assert.equal(bindingLabelsMarkup(shapes), labels)
    const svg = buildSvgDocument({
      shapes, selectedShape: null, paper: PAPER_PRESETS['a4-landscape'], worldWidth: 1000, worldHeight: 1000
    })
    assert.ok(svg.includes(labels))
    assert.ok(svg.indexOf('data-shape-id="driveway"') < svg.indexOf('class="binding-label"'))
  }
})

test('filled paving follows the complete polygon boundary and survives editing and persistence', () => {
  const corners = [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 600 }, { x: 100, y: 600 }]
  const area = createDrivewayArea('area', [...corners, corners[0]], 'pavers')
  assert.deepEqual(area.start, { x: 100, y: 200 })
  assert.deepEqual(area.end, { x: 500, y: 600 })
  assert.equal(drivewayGeometry(area).path, 'M 100 200 L 500 200 L 500 600 L 100 600 Z')
  assert.deepEqual(sanitizeShapes(JSON.parse(JSON.stringify([area]))), [area])
  const clone = cloneShape(area) as RectShape
  clone.drivewayRoute!.points[0].x = 0.5
  assert.notDeepEqual(clone.drivewayRoute, area.drivewayRoute)
  assert.equal(drivewayGeometry(translateShape(area, 20, 40) as RectShape).path, 'M 120 240 L 520 240 L 520 640 L 120 640 Z')
  assert.equal(drivewayGeometry(scaleShape(area, 2, 2) as RectShape).path, 'M 200 400 L 1000 400 L 1000 1200 L 200 1200 Z')
  const changed = updateSelectionProperties([area], { drivewayMaterial: 'gravel' },
    { selectedIds: new Set([area.id]), selectedId: area.id, groupedSelection: false })![0] as RectShape
  assert.equal(createNativeSelectionChangedPayload(changed, 1).shape?.drivewayClosed, true)
  for (const monochrome of [false, true]) {
    const svg = buildSvgDocument({
      shapes: [changed], selectedShape: null, paper: PAPER_PRESETS['a4-landscape'], worldWidth: 1000, worldHeight: 1000, monochrome
    })
    assert.match(svg, /class="driveway-surface" d="M 100 200 L 500 200 L 500 600 L 100 600 Z" fill="url\(#driveway-gravel\)"/)
  }
})

test('filled paving accepts concave polygons but rejects incomplete, crossed and degenerate boundaries', () => {
  assert.equal(drivewayAreaError([
    { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 },
    { x: 100, y: 100 }, { x: 100, y: 400 }, { x: 0, y: 400 }
  ]), null)
  const invalid = [
    [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
    [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: Infinity, y: 100 }, { x: 0, y: 100 }]
  ]
  for (const points of invalid) {
    assert.ok(drivewayAreaError(points))
    assert.throws(() => createDrivewayArea('invalid', points, 'pavers'))
  }
  const area = createDrivewayArea('area', [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 'pavers')
  assert.deepEqual(sanitizeShapes([{ ...area, drivewayRoute: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], width: 1 } }]), [])
})
