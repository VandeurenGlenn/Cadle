import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWallMask } from '../src/editor/export/svg-export.js'
import { hasWallOpeningMask } from '../src/editor/svg-templates.js'
import type { Shape } from '../src/editor/model/types.js'

const wall: Shape = {
  id: 'wall-1',
  kind: 'wall',
  start: { x: 100, y: 100 },
  end: { x: 2200, y: 100 }
}

test('only enables the wall mask for an opening that is still bound to its wall', () => {
  const unboundDoor: Shape = {
    id: 'door-unbound',
    kind: 'door',
    start: { x: 400, y: 100 },
    end: { x: 500, y: 100 }
  }
  const boundDoor: Shape = { ...unboundDoor, id: 'door-bound', wallId: wall.id }

  assert.equal(hasWallOpeningMask([wall, unboundDoor]), false)
  assert.equal(hasWallOpeningMask([wall, boundDoor]), true)
})

test('gives the wall-opening mask an explicit user-space region', () => {
  const door: Shape = {
    id: 'door-1',
    kind: 'door',
    wallId: wall.id,
    start: { x: 400, y: 100 },
    end: { x: 500, y: 100 }
  }

  const mask = buildWallMask([wall, door], 2376, 1680)

  assert.match(mask, /<mask id="wall-opening-mask" x="-28" y="-28" width="2376" height="1680"/)
  assert.match(mask, /maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"/)
})
