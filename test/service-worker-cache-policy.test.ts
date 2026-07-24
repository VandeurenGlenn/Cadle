import assert from 'node:assert/strict'
import test from 'node:test'
import { isCacheableSvgRequest } from '../src/service-worker/cache-policy.js'

const origin = 'https://cadle.example'

test('service worker caches only same-origin GET requests for SVG files', () => {
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/socket.svg`), origin), true)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/assets/LOGO.SVG?version=2`), origin), true)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/manifest.js`), origin), false)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/app.js`), origin), false)
  assert.equal(isCacheableSvgRequest(new Request('https://cdn.example/socket.svg'), origin), false)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/socket.svg`, { method: 'POST' }), origin), false)
})
