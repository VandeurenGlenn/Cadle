import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from '../src/shims/crypto.ts'

test('matches the standard SHA-256 digest required by browser peer identities', () => {
  assert.equal(
    createHash('sha256').update('abc').digest('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('rejects algorithms outside the deliberately small browser bridge', () => {
  assert.throws(() => createHash('md5'), /Unsupported browser hash algorithm/)
})
