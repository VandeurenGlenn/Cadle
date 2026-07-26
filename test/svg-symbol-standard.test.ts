import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('all Cadle-native SVG symbols satisfy the repository standard', () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['scripts/svg-symbols.mjs'], {
      cwd: process.cwd(),
      stdio: 'pipe'
    })
  })
})
