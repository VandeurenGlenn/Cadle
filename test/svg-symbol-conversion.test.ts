import assert from 'node:assert/strict'
import test from 'node:test'
import { convertVisioSvg } from '../scripts/convert-visio-symbols.mjs'
import { auditSymbols } from '../scripts/svg-symbols.mjs'

test('converts Visio styles and metadata to self-contained native SVG', () => {
  const source = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ev="urn:visio"
  width="1in" height="1in" viewBox="0 0 24 24" class="st2">
  <title>Example symbol</title>
  <style><![CDATA[.st1 { fill:none; stroke:#000; stroke-width:0.24; } .st2 { fill:none; }]]></style>
  <defs><marker id="arrow"><path d="M0 0 2 1" class="st1"/></marker></defs>
  <g transform="translate(2 3)"><path class="st1" d="M0 0 4 4"/></g>
  <text>Rendered through symbol metadata</text><desc>Label description</desc>
  <use xlink:href="#arrow"/>
</svg>`

  const converted = convertVisioSvg(source, 'example.svg')
  assert.match(converted, /data-cadle-symbol="1"/)
  assert.match(converted, /viewBox="0 0 24 24"/)
  assert.match(converted, /transform="translate\(2 3\)"/)
  assert.match(converted, /stroke-width="0\.24"/)
  assert.match(converted, /<use href="#arrow"\/>/)
  assert.doesNotMatch(converted, /xmlns:ev|xmlns:xlink|width="1in"|height="1in"/)
  assert.doesNotMatch(converted, /<style|<text|<desc|class="st/)
  assert.doesNotMatch(converted, /[ \t]+$/m)
  assert.doesNotMatch(converted, /\n[ \t]*\n/)
})

test('rejects legacy SVGs with unsupported rendered elements', () => {
  assert.throws(
    () => convertVisioSvg('<svg xmlns:ev="urn:visio" viewBox="0 0 24 24"><image href="asset.png"/></svg>'),
    /unsupported SVG elements/
  )
})

test('keeps the full symbol catalog free of Visio exports and invalid native SVGs', async () => {
  const results = await auditSymbols()
  const legacy = results.filter((result) => result.visio)
  const invalid = results.filter((result) => result.native && result.errors.length)

  assert.deepEqual(legacy, [])
  assert.deepEqual(invalid, [])
})
