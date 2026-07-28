import assert from 'node:assert/strict'
import test from 'node:test'
import { getBoundedCache, setBoundedCache } from '../src/helpers/bounded-cache.ts'

test('bounded cache evicts the least recently used entry', () => {
  const cache = new Map<string, number>()
  setBoundedCache(cache, 'a', 1, 2)
  setBoundedCache(cache, 'b', 2, 2)
  assert.equal(getBoundedCache(cache, 'a'), 1)
  setBoundedCache(cache, 'c', 3, 2)

  assert.deepEqual([...cache.keys()], ['a', 'c'])
  assert.equal(cache.has('b'), false)
})
