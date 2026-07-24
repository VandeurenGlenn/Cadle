import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateOneWirePreflight } from '../src/shell/onewire-preflight.ts'

test('requires bound ground-plan circuits before one-wire generation', () => {
  assert.deepEqual(evaluateOneWirePreflight({ totalGroups: 0, errorCount: 0, valid: false }), {
    ready: false,
    reason: 'empty',
    message: 'Add electrical devices to the ground plan and assign circuit IDs such as A1 before generating.'
  })
})

test('keeps the user on the ground plan while validation errors remain', () => {
  const result = evaluateOneWirePreflight({ totalGroups: 2, errorCount: 1, valid: false })
  assert.equal(result.ready, false)
  if (!result.ready) assert.equal(result.reason, 'invalid')
})

test('allows a valid ground plan to proceed to one-wire generation', () => {
  assert.deepEqual(evaluateOneWirePreflight({ totalGroups: 2, errorCount: 0, valid: true }), { ready: true })
})
