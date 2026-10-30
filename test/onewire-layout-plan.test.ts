import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendOneWireFamilyOffset,
  normalizeOneWireFamilyKey,
  oneWireRailYForRows,
  oneWireRailSpanForAnchors,
  packOneWireFamilyBounds,
  planOneWireLayout
} from '../src/editor/layout/onewire-layout-plan.ts'

test('keeps a single-breaker rail readable and never shrinks an existing rail while adding', () => {
  assert.deepEqual(oneWireRailSpanForAnchors([500]), { startX: 380, endX: 620 })
  assert.deepEqual(oneWireRailSpanForAnchors([500], { startX: 100, endX: 900 }, true), {
    startX: 100,
    endX: 900
  })
  assert.deepEqual(oneWireRailSpanForAnchors([500, 820]), { startX: 480, endX: 840 })
})

test('keeps hidden breaker identities unique while normalizing circuit bindings', () => {
  assert.equal(normalizeOneWireFamilyKey('A12'), 'A')
  assert.equal(normalizeOneWireFamilyKey('BRK1'), 'BRK1')
  assert.equal(normalizeOneWireFamilyKey('BRK2'), 'BRK2')
})

test('places a manually added family directly after existing content regardless of requested x', () => {
  const requestedFamily = { minX: 700, maxX: 780 }
  const occupiedMaxX = 260
  const dx = appendOneWireFamilyOffset(requestedFamily.minX, occupiedMaxX)

  assert.equal(requestedFamily.minX + dx, 270)
  assert.equal(requestedFamily.maxX + dx, 350)
})

test('packs families from their longest branch bounds with a fixed visual gap', () => {
  const packed = packOneWireFamilyBounds(
    [
      { family: 'AA', anchorX: 100, minX: 60, maxX: 220 },
      { family: 'AB', anchorX: 400, minX: 370, maxX: 450 },
      { family: 'AC', anchorX: 600, minX: 580, maxX: 640 }
    ],
    1000
  )

  assert.deepEqual(
    [...packed.familyXs],
    [
      ['AA', 880],
      ['AB', 1040],
      ['AC', 1120]
    ]
  )
  assert.equal(packed.startX, 860)
  assert.equal(packed.endX, 1140)

  const aaRight = (packed.familyXs.get('AA') ?? 0) + 120
  const abLeft = (packed.familyXs.get('AB') ?? 0) - 30
  const abRight = (packed.familyXs.get('AB') ?? 0) + 50
  const acLeft = (packed.familyXs.get('AC') ?? 0) - 20
  const contentLeft = (packed.familyXs.get('AA') ?? 0) - 40
  const contentRight = (packed.familyXs.get('AC') ?? 0) + 40
  assert.equal(abLeft - aaRight, 10)
  assert.equal(acLeft - abRight, 10)
  assert.equal((contentLeft + contentRight) / 2, 1000)
})

test('shrinks the rail when the widest family is removed', () => {
  const before = packOneWireFamilyBounds(
    [
      { family: 'AA', anchorX: 100, minX: 60, maxX: 220 },
      { family: 'AB', anchorX: 400, minX: 370, maxX: 450 }
    ],
    1000
  )
  const after = packOneWireFamilyBounds([{ family: 'AB', anchorX: 400, minX: 370, maxX: 450 }], 1000)

  assert.ok(after.endX - after.startX < before.endX - before.startX)
})

test('splits large circuit families into readable page chunks', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 30 }], {
    usableWidth: 500,
    usableHeight: 700,
    maxCircuitsPerPage: 25
  })
  assert.deepEqual(
    plan.placements.map(({ family, pageIndex, circuitStart, circuitCount }) => ({
      family,
      pageIndex,
      circuitStart,
      circuitCount
    })),
    [
      { family: 'A', pageIndex: 0, circuitStart: 0, circuitCount: 25 },
      { family: 'A', pageIndex: 1, circuitStart: 25, circuitCount: 5 }
    ]
  )
  assert.equal(plan.pageCount, 2)
})

test('limits a vertical family to the rows that fit the usable page height', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 25 }], {
    usableWidth: 600,
    usableHeight: 540
  })
  assert.equal(plan.pageCount, 7)
  assert.equal(plan.placements[0]?.circuitCount, 4)
  assert.equal(plan.placements.at(-1)?.circuitCount, 1)
})

test('fits long circuit families into two balanced vertical columns before adding pages', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 22, requiredWidth: 240 }], {
    usableWidth: 900,
    usableHeight: 1140
  })

  assert.equal(plan.pageCount, 1)
  assert.equal(plan.placements[0]?.circuitCount, 22)
  assert.equal(plan.placements[0]?.requiredWidth, 540)
})

test('centers the rail around circuit rows while preserving a clear top and bottom margin', () => {
  const railY = oneWireRailYForRows(11, { y: 40, height: 1600 })
  const top = railY - 360 - 10 * 64
  const bottom = railY + 100

  assert.equal(top, 290)
  assert.equal(bottom, 1390)
  assert.equal((top + bottom) / 2, 840)
})

test('packs separate families together while the page still has room', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2 },
      { family: 'B', circuitCount: 3 }
    ],
    { usableWidth: 900, usableHeight: 620, maxCircuitsPerPage: 25 }
  )
  assert.equal(plan.pageCount, 1)
  assert.equal(plan.slotsPerRail, 2)
  assert.deepEqual(
    plan.placements.map(({ pageIndex, slotIndex }) => ({ pageIndex, slotIndex })),
    [
      { pageIndex: 0, slotIndex: 0 },
      { pageIndex: 0, slotIndex: 1 }
    ]
  )
})

test('keeps cabinet rows on separate continuation pages', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2, railId: 'row-1' },
      { family: 'B', circuitCount: 3, railId: 'row-1' },
      { family: 'C', circuitCount: 2, railId: 'row-2' }
    ],
    { usableWidth: 900, usableHeight: 620, maxCircuitsPerPage: 25 }
  )

  assert.deepEqual(
    plan.placements.map(({ family, railId, pageIndex, slotIndex }) => ({ family, railId, pageIndex, slotIndex })),
    [
      { family: 'A', railId: 'row-1', pageIndex: 0, slotIndex: 0 },
      { family: 'B', railId: 'row-1', pageIndex: 0, slotIndex: 1 },
      { family: 'C', railId: 'row-2', pageIndex: 1, slotIndex: 0 }
    ]
  )
})

test('does not merge equal rail IDs from different cabinets', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2, boardId: 'main', railId: 'rail-1' },
      { family: 'K', circuitCount: 2, boardId: 'kitchen', railId: 'rail-1' }
    ],
    { usableWidth: 900, usableHeight: 620, maxCircuitsPerPage: 25 }
  )

  assert.deepEqual(
    plan.placements.map(({ family, boardId, railId, pageIndex }) => ({ family, boardId, railId, pageIndex })),
    [
      { family: 'A', boardId: 'main', railId: 'rail-1', pageIndex: 0 },
      { family: 'K', boardId: 'kitchen', railId: 'rail-1', pageIndex: 1 }
    ]
  )
})

test('continues on a new page only after all family slots are occupied', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2 },
      { family: 'B', circuitCount: 3 },
      { family: 'C', circuitCount: 1 }
    ],
    { usableWidth: 900, usableHeight: 620, maxCircuitsPerPage: 25 }
  )
  assert.equal(plan.pageCount, 2)
  assert.deepEqual(
    plan.placements.map(({ pageIndex, slotIndex }) => ({ pageIndex, slotIndex })),
    [
      { pageIndex: 0, slotIndex: 0 },
      { pageIndex: 0, slotIndex: 1 },
      { pageIndex: 1, slotIndex: 0 }
    ]
  )
})
