import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileGeneratedOneWire } from '../src/editor/layout/onewire-regeneration.ts'
import type { Shape } from '../src/editor/model/types.ts'

const generatedSymbol = (id: string, key: string, x: number): Shape => ({
  id,
  kind: 'symbol',
  position: { x, y: 100 },
  name: 'Load',
  path: 'load.svg',
  scale: 1,
  generationKey: key,
  sourceLink: { kind: 'device', id: 'floor-device-1', role: 'load' }
})

test('preserves manually positioned generated objects by stable generation key', () => {
  const previous = generatedSymbol('old-id', 'device:floor-device-1', 440)
  const fresh = generatedSymbol('new-id', 'device:floor-device-1', 120)
  const result = reconcileGeneratedOneWire([previous], [fresh])
  assert.equal(result.preserved, 1)
  assert.deepEqual(result.shapes[0].kind === 'symbol' ? result.shapes[0].position : null, { x: 440, y: 100 })
  assert.equal(result.shapes[0].id, 'old-id')
})

test('reports added and removed generated source objects', () => {
  const result = reconcileGeneratedOneWire(
    [generatedSymbol('old', 'device:removed', 10)],
    [generatedSymbol('new', 'device:added', 20)]
  )
  assert.deepEqual({ added: result.added, removed: result.removed, preserved: result.preserved }, { added: 1, removed: 1, preserved: 0 })
})
