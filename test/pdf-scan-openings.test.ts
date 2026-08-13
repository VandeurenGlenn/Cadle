import assert from 'node:assert/strict'
import test from 'node:test'
import { detectPdfScanOpenings } from '../src/editor/pdf-scan-openings.ts'

test('suggests a door leaf at a wall and binds the opening to that wall', () => {
  const walls = [{ x1: 20, y1: 100, x2: 280, y2: 100, lineWidth: 4 }]
  const details = [
    ...walls,
    { x1: 120, y1: 101, x2: 150, y2: 132, lineWidth: 1 }
  ]
  const [door] = detectPdfScanOpenings(details, walls, { width: 300, height: 400 })
  assert.equal(door?.reviewKind, 'door')
  assert.equal(door?.boundWallIndex, 0)
  assert.equal(door?.reviewPending, true)
  assert.equal(door?.y1, 100)
  assert.equal(door?.y2, 100)
})

test('suggests paired parallel window strokes but ignores an isolated wall-parallel line', () => {
  const walls = [{ x1: 20, y1: 100, x2: 280, y2: 100, lineWidth: 4 }]
  const paired = [
    { x1: 120, y1: 94, x2: 160, y2: 94, lineWidth: 1 },
    { x1: 120, y1: 106, x2: 160, y2: 106, lineWidth: 1 }
  ]
  const windows = detectPdfScanOpenings(paired, walls, { width: 300, height: 400 })
  assert.equal(windows[0]?.reviewKind, 'window')
  assert.equal(windows[0]?.boundWallIndex, 0)
  assert.equal(detectPdfScanOpenings(paired.slice(0, 1), walls, { width: 300, height: 400 }).length, 0)
})
