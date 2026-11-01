import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionDefaults, connectionLabel, connectionPoints, connectionSegments, sanitizeConnection } from '../src/editor/model/electrical-connection.ts'
import { cloneShape, sanitizeShapes, scaleShape, shapeBounds } from '../src/editor/model/model.ts'
import { updateSelectionProperties } from '../src/editor/interaction/selection-properties.ts'
import { electricalConnectionMarkup } from '../src/editor/electrical-connection-markup.ts'
import { shapeMarkup } from '../src/editor/export/svg-export.ts'
import { reconcileGeneratedOneWire } from '../src/editor/layout/onewire-regeneration.ts'
import { presentConnectionLabels } from '../src/editor/layout/connection-label-presentation.ts'
import type { LineShape } from '../src/editor/model/types.ts'

const cable = (): LineShape => ({ id: 'cable', kind: 'line', start: { x: 100, y: 200 }, end: { x: 500, y: 200 },
  stroke: '#000000', strokeWidth: 2, connection: connectionDefaults('cable') })

test('connections retain their properties through editing, cloning, resizing and persistence', () => {
  const source = cable()
  const updated = updateSelectionProperties([source], { connection: { sectionMm2: 6, conductors: 5 } },
    { selectedId: source.id, selectedIds: new Set([source.id]), groupedSelection: false })![0] as LineShape
  assert.equal(connectionLabel(updated.connection!), '5G6 mm² XVB')
  assert.equal(source.connection!.sectionMm2, 2.5)
  assert.deepEqual((sanitizeShapes([updated])[0] as LineShape).connection, updated.connection)
  const clone = cloneShape(updated) as LineShape
  clone.connection!.sectionMm2 = 10
  assert.equal(updated.connection!.sectionMm2, 6)
  assert.deepEqual((scaleShape(updated, 2, 2) as LineShape).connection, updated.connection)
  assert.equal(sanitizeConnection({ kind: 'invalid' }), undefined)
  assert.deepEqual(sanitizeConnection({ kind: 'cable', sectionMm2: -4, conductors: 1.5 }), { kind: 'cable' })
})

test('bridge geometry follows its real terminals and its raised route is included in the bounds', () => {
  const bridge = { ...cable(), connection: connectionDefaults('bridge') }
  assert.deepEqual(connectionPoints(bridge), [{ x: 100, y: 200 }, { x: 100, y: 176 }, { x: 500, y: 176 }, { x: 500, y: 200 }])
  assert.equal(connectionSegments(bridge).length, 3)
  assert.equal(shapeBounds(bridge).y, 176)
  assert.equal(shapeBounds(bridge).height, 24)
  const branch = { ...cable(), connection: connectionDefaults('branch') }
  assert.match(electricalConnectionMarkup(branch, false), /class="connection-junction" cx="100" cy="200"/)
})

test('connection exports use the same markup and safely escape editable names', () => {
  const source = cable()
  source.connection!.name = '<Kabel & keuken>'
  const markup = electricalConnectionMarkup(source, false)
  assert.equal(shapeMarkup(source, false), markup)
  assert.match(markup, /&lt;Kabel &amp; keuken&gt;/)
  assert.match(markup, /data-connection-kind="cable"/)
  assert.match(markup, /stroke-width:2px/)
  assert.ok(shapeBounds(source).y < source.start.y - 20)
})

test('regeneration updates circuit sizes and preserves custom connection presentation', () => {
  const previous = { ...cable(), generationKey: 'board:A:trunk' }
  previous.connection = { ...previous.connection!, name: 'Keuken', showLabel: false }
  const fresh = { ...cable(), id: 'fresh', generationKey: previous.generationKey,
    connection: { ...connectionDefaults('cable'), sectionMm2: 6 } }
  const result = reconcileGeneratedOneWire([previous], [fresh]).shapes[0] as LineShape
  assert.equal(result.id, previous.id)
  assert.equal(result.connection!.sectionMm2, 6)
  assert.equal(result.connection!.name, 'Keuken')
  assert.equal(result.connection!.showLabel, false)
})

test('a generated cable owns its existing caption without producing a second label', () => {
  const owner = { ...cable(), sourceLink: { kind: 'board' as const, id: 'A', role: 'trunk' },
    connection: { ...connectionDefaults('cable'), labelOwner: 'circuit' as const, name: 'Voeding keuken', showLabel: false } }
  const caption = { id: 'caption', kind: 'text' as const, position: { x: 0, y: 0 }, text: 'old',
    sourceLink: { kind: 'board' as const, id: 'A', role: 'cable-section' } }
  const result = presentConnectionLabels([owner, caption])
  assert.equal(result[1].kind === 'text' && result[1].text, 'Voeding keuken')
  assert.equal(result[1].hidden, true)
  assert.doesNotMatch(electricalConnectionMarkup(owner, false), /class="connection-label"/)
  assert.doesNotMatch(electricalConnectionMarkup(owner, false), /connection-cable-marker/)
  assert.equal(caption.text, 'old')
})
