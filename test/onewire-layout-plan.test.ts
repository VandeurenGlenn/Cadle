import assert from 'node:assert/strict'
import test from 'node:test'
import { planOneWireLayout } from '../src/editor/layout/onewire-layout-plan.ts'

test('moves wide circuit families to another rail before they collide', () => {
  const plan = planOneWireLayout(
    [{ family: 'A', circuitCount: 8 }, { family: 'B', circuitCount: 8 }, { family: 'C', circuitCount: 4 }],
    { usableWidth: 500, usableHeight: 700, minBranchWidth: 200, railHeight: 300 }
  )
  assert.deepEqual(plan.placements.map(({ family, railIndex }) => ({ family, railIndex })), [
    { family: 'A', railIndex: 0 }, { family: 'B', railIndex: 1 }, { family: 'C', railIndex: 0 }
  ])
  assert.equal(plan.pageCount, 2)
})

test('keeps compact families on one rail when slots are available', () => {
  const plan = planOneWireLayout(
    [{ family: 'A', circuitCount: 2 }, { family: 'B', circuitCount: 3 }],
    { usableWidth: 600, usableHeight: 400, minBranchWidth: 200 }
  )
  assert.equal(plan.pageCount, 1)
  assert.deepEqual(plan.placements.map((item) => item.slotIndex), [0, 1])
})
