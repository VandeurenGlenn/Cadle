import assert from 'node:assert/strict'
import test from 'node:test'
import { safeExportName } from '../src/helpers/export-name.ts'

test('creates filesystem-safe export names', () => {
  assert.equal(safeExportName('Home / Brussels 2026'), 'Home-Brussels-2026')
  assert.equal(safeExportName(''), 'cadle-project')
})
