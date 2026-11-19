import assert from 'node:assert/strict'
import test from 'node:test'
import { asNativeState } from '../src/editor/model/document-state.ts'

test('accepts a Cadle drawing exported by the RoomPlan scanner', () => {
  const imported = asNativeState({
    format: 'cadle-roomplan',
    formatVersion: 1,
    version: 1,
    drawingScale: 100,
    paperPreset: 'a4-landscape',
    printMargin: 10,
    worldWidth: 2376,
    worldHeight: 1680,
    shapes: [
      { id: 'roomplan-wall-1', kind: 'wall', start: { x: 800, y: 600 }, end: { x: 1120, y: 600 } },
      { id: 'roomplan-door-2', kind: 'door', start: { x: 1120, y: 600 }, end: { x: 1200, y: 600 } },
      { id: 'roomplan-window-3', kind: 'window', start: { x: 800, y: 640 }, end: { x: 1040, y: 640 } }
    ]
  })

  assert.ok(imported)
  assert.equal(imported.paperPreset, 'a4-landscape')
  assert.equal(imported.drawingScale, 100)
  assert.deepEqual(imported.shapes.map((shape) => shape.kind), ['wall', 'door', 'window'])
  assert.deepEqual(imported.shapes[0], {
    id: 'roomplan-wall-1',
    kind: 'wall',
    start: { x: 800, y: 600 },
    end: { x: 1120, y: 600 }
  })
})
