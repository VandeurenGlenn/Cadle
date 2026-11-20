import assert from 'node:assert/strict'
import test from 'node:test'
import { buildKamrailCircuitBundle } from '../src/editor/layout/onewire-helpers.ts'
import { oneWireLayoutBounds } from '../src/editor/layout/onewire-connections.ts'
import { oneWireSymbolBounds, oneWireSymbolScaleFor } from '../src/editor/layout/onewire-symbol-nodes.ts'
import { pageLayout } from '../src/editor/layout/page-layout.ts'
import {
  appendOneWireFamilyOffset,
  insertOneWireFamilyBounds,
  normalizeOneWireFamilyKey,
  oneWireDestinationSheetLabels,
  oneWireRailYForRows,
  oneWireRailSpanForAnchors,
  packOneWireFamilyBounds,
  planOneWireLayout
} from '../src/editor/layout/onewire-layout-plan.ts'

test('inserts N between M and O without moving earlier circuits or closing saved gaps', () => {
  const family = (name: string, x: number) => ({ family: name, anchorX: x, minX: x - 20, maxX: x + 80 })
  const families = [family('M', 100), family('N', 1000), family('O', 250), family('P', 600)]
  const original = structuredClone(families)
  const positions = insertOneWireFamilyBounds(families, 'N')
  assert.deepEqual([...positions], [['M', 100], ['N', 210], ['O', 320], ['P', 600]])
  assert.deepEqual(families, original)
  assert.deepEqual([...insertOneWireFamilyBounds([family('M', 100), family('N', 1000), family('O', 600)], 'N')],
    [['M', 100], ['N', 210], ['O', 600]])
  assert.deepEqual([...insertOneWireFamilyBounds([family('L', 1000), family('M', 100)], 'L')],
    [['L', 100], ['M', 210]])
  assert.deepEqual([...insertOneWireFamilyBounds([family('M', 100), family('N', 250)], 'N')],
    [['M', 100], ['N', 250]])
})

test('makes room for an inserted circuit using overlapping ink, without reordering or moving the prefix', () => {
  const family = (name: string, x: number, width: number) => ({
    family: name, anchorX: x, minX: x - 20, maxX: x + width,
    ink: [{ x: x - 20, y: 0, width: width + 20, height: 80 }]
  })
  const families = [family('M', 100, 50), family('N', 1000, 180), family('O', 250, 40), family('P', 350, 40)]
  const positions = insertOneWireFamilyBounds(families, 'N')
  assert.equal(positions.get('M'), 100)
  assert.equal(positions.get('N'), 180)
  assert.equal(positions.get('O'), 390)
  assert.ok(positions.get('P')! > positions.get('O')!)
})

test('keeps a single-breaker rail readable and preserves the existing length when requested', () => {
  assert.deepEqual(oneWireRailSpanForAnchors([500]), { startX: 380, endX: 620 })
  assert.deepEqual(oneWireRailSpanForAnchors([500], { startX: 100, endX: 900 }, true), {
    startX: 100,
    endX: 900
  })
  assert.deepEqual(oneWireRailSpanForAnchors([500, 820]), { startX: 480, endX: 840 })
})

test('balances rail ends around the outer breakers without retaining an off-centre tail', () => {
  for (const existingSpan of [{ startX: 100, endX: 900 }, { startX: 900, endX: 100 }]) {
    const span = oneWireRailSpanForAnchors([820, 500], existingSpan, true)!
    assert.equal(span.endX - span.startX, 800)
    assert.equal(500 - span.startX, span.endX - 820)
    assert.deepEqual(span, { startX: 260, endX: 1060 })
  }
  assert.deepEqual(oneWireRailSpanForAnchors([500, 820], { startX: 100, endX: 900 }), {
    startX: 480, endX: 840
  })
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

test('references the first sheet when a destination continues across pages', () => {
  const plan = planOneWireLayout(
    [{ family: 'A', circuitCount: 30, boardId: 'main', railId: 'rail-1' }],
    { usableWidth: 500, usableHeight: 700, maxCircuitsPerPage: 25 }
  )

  assert.deepEqual(
    oneWireDestinationSheetLabels([...plan.placements].reverse(), (pageIndex) => pageIndex + 2),
    { 'main::rail-1': 'E2' }
  )
})

test('limits a vertical family to the rows that fit the usable page height', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 25 }], {
    usableWidth: 600,
    usableHeight: 540
  })
  assert.equal(plan.pageCount, 13)
  assert.equal(plan.placements[0]?.circuitCount, 2)
  assert.equal(plan.placements.at(-1)?.circuitCount, 1)
})

test('fits long circuit families into two balanced vertical columns before adding pages', () => {
  const plan = planOneWireLayout([{ family: 'A', circuitCount: 16, requiredWidth: 240 }], {
    usableWidth: 900,
    usableHeight: 1140
  })

  assert.equal(plan.pageCount, 1)
  assert.equal(plan.placements[0]?.circuitCount, 16)
  assert.equal(plan.placements[0]?.requiredWidth, 540)
})

test('places short and long circuit rails at the same lowest baseline', () => {
  for (const rows of [1, 3, 11]) {
    const railY = oneWireRailYForRows(rows, { y: 40, height: 1600 })
    assert.equal(railY + 100, 1640)
    assert.ok(railY - 360 - (rows - 1) * 96 >= 40)
  }
})

test('fills a sheet from measured overlapping ink instead of estimated column widths', () => {
  const families = ['A', 'B', 'C', 'D'].map((family) => ({ family, circuitCount: 1, requiredWidth: 360 }))
  const measureFamily = (family: string) => ({ family, anchorX: 0, minX: -20, maxX: 240,
    ink: [{ x: -20, y: 300, width: 100, height: 100 },
      { x: 0, y: family === 'A' ? 0 : -200, width: 240, height: 30 }] })
  const plan = planOneWireLayout(families, { usableWidth: 900, usableHeight: 1200, measureFamily })
  assert.equal(plan.pageCount, 1)
  assert.equal(plan.placements.length, 4)
  assert.ok(plan.placements.every((placement) => typeof placement.anchorOffset === 'number'))
  const points = plan.placements.flatMap((placement) => {
    const bounds = measureFamily(placement.family)
    return [bounds.minX + placement.anchorOffset!, bounds.maxX + placement.anchorOffset!]
  })
  assert.ok(Math.min(...points) >= 0)
  assert.ok(Math.max(...points) <= 900)
  assert.equal(planOneWireLayout([...families, { family: 'E', circuitCount: 1 }],
    { usableWidth: 900, usableHeight: 1200, measureFamily }).pageCount, 2)
})

test('fits A–N and a fourteen-point Q by using free vertical space inside Q without shrinking symbols', () => {
  const area = pageLayout(2376, 1680, 10, 8).content
  const families = [...'ADEFGHIJKLMNQ']
  const counts = [1, 8, 8, 3, 1, 6, 1, 2, 1, 1, 1, 1, 14]
  const measureFamily = (family: string, start: number, count: number) => {
    let id = 0
    const components = Array.from({ length: count }, (_, index) => {
      const bindingId = `${family}${start + index + 1}`
      const switches = family === 'Q' ? [2, 0, 2, 2, 2, 0, 4, 0, 0, 0, 0, 0, 1, 1][index] : 0
      return [
        ...Array.from({ length: switches }, (_, switchIndex) => ({
          bindingId, kind: 'switch' as const, sourceShapeId: `${bindingId}-switch-${switchIndex}`,
          sourcePath: `symbols/Switches/${index === 6 && switchIndex > 0 && switchIndex < 3
            ? 'Intermediate switch' : 'Single pole change over switch'}.svg`
        })),
        { bindingId, kind: 'load' as const, sourceShapeId: `${bindingId}-load`,
          sourcePath: family === 'Q' ? 'symbols/Consumption appliances/Lighting.svg'
            : 'symbols/Socket outlets/Wall outlet with grounding for floorplan.svg' }
      ]
    }).flat()
    const preview = buildKamrailCircuitBundle({
      rail: { id: 'rail', kind: 'line', start: { x: -area.width, y: oneWireRailYForRows(1, area) },
        end: { x: area.width, y: oneWireRailYForRows(1, area) } },
      anchorX: 0, minimumRowY: area.y,
      options: { family, amps: family === 'Q' ? 16 : 20, poles: 4, cableConductors: 5,
        cableSectionMm2: family === 'Q' ? 1.5 : 2.5, cableType: 'VOB', autoIncludeFamily: true },
      familyComponents: components, nextShapeId: () => `measure-${++id}`,
      oneWireComponentSymbol: () => ({ name: 'Automaat', path: 'symbols/Protection devices/Automaat.svg' }),
      oneWireSymbolScale: (path) => oneWireSymbolScaleFor(path)!,
      symbolContentBounds: (shape) => oneWireSymbolBounds(shape)!, branchStroke: '#000000'
    })!
    const ink = preview.shapes.filter((shape) => !shape.hidden && shape.sourceLink?.role !== 'description')
      .map(oneWireLayoutBounds)
    return { family, anchorX: 0, minX: Math.min(...ink.map((box) => box.x)),
      maxX: Math.max(...ink.map((box) => box.x + box.width)), ink }
  }
  const usableWidth = area.width
  const plan = planOneWireLayout(families.map((family, index) => ({ family, circuitCount: counts[index] })),
    { usableWidth, usableHeight: area.height, measureFamily })
  assert.equal(plan.pageCount, 1)
  assert.equal(plan.placements.find((placement) => placement.family === 'Q')?.circuitCount, 14)
  for (const placement of plan.placements) {
    const bounds = measureFamily(placement.family, placement.circuitStart, placement.circuitCount)
    assert.ok(bounds.minX + placement.anchorOffset! >= 0)
    assert.ok(bounds.maxX + placement.anchorOffset! <= usableWidth)
    assert.ok(bounds.ink.every((box) => box.y >= area.y && box.y + box.height <= area.y + area.height),
      `${placement.family}: all ink stays inside the printable height`)
  }
})

test('packs separate families together while the page still has room', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2 },
      { family: 'B', circuitCount: 3 }
    ],
    { usableWidth: 900, usableHeight: 700, maxCircuitsPerPage: 25 }
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

test('rebalances family gaps without widening the overall layout', () => {
  const family = (name: string, ink: Array<{ y: number; height: number }>) => ({
    family: name,
    anchorX: 0,
    minX: 0,
    maxX: 100,
    ink: ink.map(({ y, height }) => ({ x: 0, y, width: 100, height }))
  })
  const packed = packOneWireFamilyBounds(
    [
      family('J', Array.from({ length: 5 }, () => ({ y: 0, height: 10 }))),
      family('K', Array.from({ length: 5 }, () => ({ y: 0, height: 10 }))),
      family('L', [{ y: 100, height: 10 }])
    ],
    0
  )
  const j = packed.familyXs.get('J')!
  const k = packed.familyXs.get('K')!
  const l = packed.familyXs.get('L')!

  assert.equal(k - j - 100, 12)
  assert.equal(l - k, 8)
  assert.equal(l - j, 120)
})

test('does not backfill an earlier sheet with circuits after a wider family', () => {
  const plan = planOneWireLayout(
    [
      { family: 'U', circuitCount: 1, requiredWidth: 400 },
      { family: 'V', circuitCount: 1, requiredWidth: 600 },
      { family: 'W', circuitCount: 1, requiredWidth: 200 }
    ],
    { usableWidth: 900, usableHeight: 700 }
  )

  assert.deepEqual(plan.placements.map(({ family, pageIndex }) => ({ family, pageIndex })), [
    { family: 'U', pageIndex: 0 },
    { family: 'V', pageIndex: 1 },
    { family: 'W', pageIndex: 1 }
  ])
})

test('tightens family gaps only as needed to fit measured circuits on one sheet', () => {
  const measureFamily = (family: string) => ({
    family,
    anchorX: 0,
    minX: 0,
    maxX: 100,
    ink: [{ x: 0, y: 0, width: 100, height: 100 }]
  })
  const plan = planOneWireLayout(
    ['A', 'D', 'Q'].map((family) => ({ family, circuitCount: 1 })),
    { usableWidth: 338, usableHeight: 700, measureFamily }
  )

  assert.equal(plan.pageCount, 1)
  assert.deepEqual(plan.placements.map(({ family, pageIndex }) => ({ family, pageIndex })), [
    { family: 'A', pageIndex: 0 },
    { family: 'D', pageIndex: 0 },
    { family: 'Q', pageIndex: 0 }
  ])
  assert.equal(
    (plan.placements[1].anchorOffset ?? 0) - (plan.placements[0].anchorOffset ?? 0),
    108
  )
})

test('keeps cabinet rows on separate continuation pages', () => {
  const plan = planOneWireLayout(
    [
      { family: 'A', circuitCount: 2, railId: 'row-1' },
      { family: 'B', circuitCount: 3, railId: 'row-1' },
      { family: 'C', circuitCount: 2, railId: 'row-2' }
    ],
    { usableWidth: 900, usableHeight: 700, maxCircuitsPerPage: 25 }
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
    { usableWidth: 900, usableHeight: 700, maxCircuitsPerPage: 25 }
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
    { usableWidth: 900, usableHeight: 700, maxCircuitsPerPage: 25 }
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

test('packs circuits by actual rows without reserving empty space above breaker labels', () => {
  const families = [
    { family: 'A', anchorX: 0, minX: -40, maxX: 190, ink: [
      { x: 0, y: 0, width: 130, height: 30 }, { x: -40, y: 300, width: 90, height: 100 }
    ] },
    { family: 'B', anchorX: 400, minX: 360, maxX: 470, ink: [
      { x: 390, y: 0, width: 80, height: 30 }, { x: 360, y: 300, width: 90, height: 100 }
    ] }
  ]
  const compact = packOneWireFamilyBounds(families, 1000)
  const roomy = packOneWireFamilyBounds(families, 1000, 24)
  const rectangular = packOneWireFamilyBounds(families.map(({ ink, ...bounds }) => bounds), 1000)
  assert.ok(compact.endX - compact.startX < rectangular.endX - rectangular.startX)
  const a = compact.familyXs.get('A')!, b = compact.familyXs.get('B')!
  const clearances: number[] = []
  for (const left of families[0].ink) for (const right of families[1].ink) {
    if (left.y + left.height + 8 < right.y || right.y + right.height + 8 < left.y) continue
    clearances.push(b + right.x - 400 - (a + left.x + left.width))
  }
  assert.ok(clearances.every((clearance) => clearance >= 10 - 1e-8))
  assert.equal(Math.min(...clearances), 10)
  assert.equal((roomy.endX - roomy.startX) - (compact.endX - compact.startX), 14)
})
