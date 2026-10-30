import assert from 'node:assert/strict'
import test from 'node:test'
import { isSymbolSvgLoading, preloadSymbolSvg } from '../src/editor/symbol-svg-cache.js'

test('export joins an in-progress symbol load instead of continuing with missing markup', async (t) => {
  const path = 'symbols/test-concurrent-load.svg'
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    await gate
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>')
  })
  let secondFinished = false
  const first = preloadSymbolSvg(path)
  const second = preloadSymbolSvg(path).then(() => { secondFinished = true })
  try {
    await Promise.resolve()
    assert.equal(fetch.mock.calls.length, 1)
    assert.equal(isSymbolSvgLoading(path), true)
    assert.equal(secondFinished, false)
  } finally {
    release()
    await Promise.all([first, second])
  }
  assert.equal(secondFinished, true)
  assert.equal(isSymbolSvgLoading(path), false)
})
