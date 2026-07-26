import assert from 'node:assert/strict'
import test from 'node:test'
import { planOneWireLayout } from '../src/editor/layout/onewire-layout-plan.ts'

test('splits large circuit families into readable page chunks', () => {
  const plan = planOneWireLayout(
    [{ family: 'A', circuitCount: 30 }],
    { usableWidth: 500, usableHeight: 700 }
  )
  assert.deepEqual(plan.placements.map(({ family, pageIndex, circuitStart, circuitCount }) => ({
    family, pageIndex, circuitStart, circuitCount
  })), [
    { family: 'A', pageIndex: 0, circuitStart: 0, circuitCount: 25 },
    { family: 'A', pageIndex: 1, circuitStart: 25, circuitCount: 5 }
  ])
  assert.equal(plan.pageCount, 2)
})

test('keeps a vertical family of 25 circuits on one page', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 25 }], {
    usableWidth: 600,
    usableHeight: 400
  })
  assert.equal(plan.pageCount, 1)
  assert.equal(plan.placements[0]?.circuitCount, 25)
})

test('packs separate families together while the page still has room', () => {
  const plan = planOneWireLayout(
    [{ family: 'A', circuitCount: 2 }, { family: 'B', circuitCount: 3 }],
    { usableWidth: 900, usableHeight: 400 }
  )
  assert.equal(plan.pageCount, 1)
  assert.equal(plan.slotsPerRail, 2)
  assert.deepEqual(plan.placements.map(({ pageIndex, slotIndex }) => ({ pageIndex, slotIndex })), [
    { pageIndex: 0, slotIndex: 0 },
    { pageIndex: 0, slotIndex: 1 }
  ])
})

test('continues on a new page only after all family slots are occupied', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2 },
      { family: 'B', circuitCount: 3 },
      { family: 'C', circuitCount: 1 }
    ],
    { usableWidth: 900, usableHeight: 400 }
  )
  assert.equal(plan.pageCount, 2)
  assert.deepEqual(plan.placements.map(({ pageIndex, slotIndex }) => ({ pageIndex, slotIndex })), [
    { pageIndex: 0, slotIndex: 0 },
    { pageIndex: 0, slotIndex: 1 },
    { pageIndex: 1, slotIndex: 0 }
  ])
})
