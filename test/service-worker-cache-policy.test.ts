import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isCacheableCadleAssetRequest,
  isCacheableSvgRequest
} from '../src/service-worker/cache-policy.js'

const origin = 'https://cadle.example'

test('service worker caches only same-origin GET requests for SVG files', () => {
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/socket.svg`), origin), true)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/assets/LOGO.SVG?version=2`), origin), true)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/manifest.js`), origin), false)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/app.js`), origin), false)
  assert.equal(isCacheableSvgRequest(new Request('https://cdn.example/socket.svg'), origin), false)
  assert.equal(isCacheableSvgRequest(new Request(`${origin}/symbols/socket.svg`, { method: 'POST' }), origin), false)
})

test('caches only same-origin OCR runtime assets', () => {
  const origin = 'https://cadle.test'
  assert.equal(isCacheableCadleAssetRequest(new Request(`${origin}/ocr/worker.min.js`), origin), true)
  assert.equal(isCacheableCadleAssetRequest(new Request(`${origin}/ocr/core/tesseract-core.wasm`), origin), true)
  assert.equal(isCacheableCadleAssetRequest(new Request(`${origin}/ocr/lang/nld.traineddata.gz`), origin), true)
  assert.equal(isCacheableCadleAssetRequest(new Request(`${origin}/ocr/readme.txt`), origin), false)
  assert.equal(isCacheableCadleAssetRequest(new Request('https://cdn.test/ocr/worker.min.js'), origin), false)
})
