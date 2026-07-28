import assert from 'node:assert/strict'
import test from 'node:test'
import {
  includeSignaturePoint,
  pointOnSignatureCanvas,
  signatureCropRect
} from '../src/helpers/signature-canvas.ts'

test('maps mouse and touch coordinates into the fixed signature canvas', () => {
  const point = pointOnSignatureCanvas(
    { left: 20, top: 40, width: 600, height: 200 },
    1200,
    400,
    320,
    140
  )

  assert.deepEqual(point, { x: 600, y: 200 })
})

test('tracks drawn ink and crops it with bounded padding', () => {
  let bounds = includeSignaturePoint(null, { x: 14, y: 18 })
  bounds = includeSignaturePoint(bounds, { x: 1180, y: 390 })

  assert.deepEqual(signatureCropRect(bounds, 1200, 400, 24), {
    x: 0,
    y: 0,
    width: 1200,
    height: 400
  })
})

test('keeps a compact signature transparent image compact', () => {
  let bounds = includeSignaturePoint(null, { x: 300, y: 100 })
  bounds = includeSignaturePoint(bounds, { x: 700, y: 250 })

  assert.deepEqual(signatureCropRect(bounds, 1200, 400, 20), {
    x: 280,
    y: 80,
    width: 440,
    height: 190
  })
})
