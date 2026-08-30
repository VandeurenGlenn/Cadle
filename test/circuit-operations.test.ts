import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCircuitOperation } from '../src/editor/circuit-operations.ts'
import type { Shape } from '../src/editor/model/types.ts'

const symbol = (id: string, bindingId: string): Shape => ({
  id,
  kind: 'symbol',
  position: { x: 0, y: 0 },
  name: 'Electrical symbol',
  path: 'symbol.svg',
  scale: 1,
  bindingId
})

test('replaces an entire circuit and preserves shared electrical points', () => {
  const shapes = [symbol('light', 'A1'), symbol('switch', 'A1'), symbol('socket', 'A2')]

  const result = applyCircuitOperation(shapes, new Set(['light']), 'replace', 'C')

  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.shapes.map((shape) => shape.bindingId),
    ['C1', 'C1', 'C2']
  )
  assert.deepEqual(
    [...result.bindingChanges],
    [
      ['A1', 'C1'],
      ['A2', 'C2']
    ]
  )
  assert.equal(result.changedShapeCount, 3)
})

test('combines every selected circuit into one sequential circuit', () => {
  const shapes = [symbol('a1', 'A1'), symbol('a2', 'A2'), symbol('b1', 'B1')]

  const result = applyCircuitOperation(shapes, new Set(['a1', 'b1']), 'combine', 'A')

  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.shapes.map((shape) => shape.bindingId),
    ['A1', 'A2', 'A3']
  )
  assert.deepEqual(result.sourceFamilies, ['A', 'B'])
})

test('splits a selected point together with every object sharing its binding', () => {
  const shapes = [symbol('light', 'A1'), symbol('switch', 'A1'), symbol('remaining', 'A2')]

  const result = applyCircuitOperation(shapes, new Set(['light']), 'split', 'D')

  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.shapes.map((shape) => shape.bindingId),
    ['D1', 'D1', 'A2']
  )
  assert.equal(result.changedShapeCount, 2)
})

test('rejects replacement into an existing circuit', () => {
  const shapes = [symbol('a', 'A1'), symbol('b', 'B1')]

  const result = applyCircuitOperation(shapes, new Set(['a']), 'replace', 'B')

  assert.match(result.error ?? '', /already exists/i)
  assert.deepEqual(
    result.shapes.map((shape) => shape.bindingId),
    ['A1', 'B1']
  )
})

test('requires a split to leave at least one point in the source circuit', () => {
  const shapes = [symbol('light', 'A1'), symbol('switch', 'A1')]

  const result = applyCircuitOperation(shapes, new Set(['light']), 'split', 'D')

  assert.match(result.error ?? '', /leave at least one point/i)
})
