import assert from 'node:assert/strict'
import test from 'node:test'
import serviceWorkerVersion from '../rollup/service-worker-version.js'

const versionedWorker = (entries: [string, string][]) => {
  const worker = { type: 'chunk', code: 'self.addEventListener("fetch", () => {})' }
  const bundle = Object.fromEntries([
    ['sw.js', worker],
    ...entries.map(([name, code]) => [name, { type: 'chunk', code }])
  ])
  serviceWorkerVersion().generateBundle({}, bundle)
  return worker.code
}

test('service worker build signature is deterministic regardless of chunk order', () => {
  const chunks: [string, string][] = [['app-shell.js', 'const app = 1'], ['editor.js', 'const editor = 1']]
  assert.equal(versionedWorker(chunks), versionedWorker([...chunks].reverse()))
})

test('service worker changes when app code changes without editing the worker', () => {
  assert.notEqual(
    versionedWorker([['app-shell.js', 'const app = 1']]),
    versionedWorker([['app-shell.js', 'const app = 2']])
  )
})

test('build fails explicitly when the expected worker output is missing', () => {
  assert.throws(() => serviceWorkerVersion().generateBundle({}, {}), /Missing service worker bundle/)
})
