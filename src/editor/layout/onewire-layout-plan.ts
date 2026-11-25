export type OneWireFamilyDemand = {
  family: string
  circuitCount: number
  boardId?: string
  railId?: string
  requiredWidth?: number
}
export const ONE_WIRE_LAYOUT_VERSION = 114
export const ONE_WIRE_FAMILY_GAP = 10
const ONE_WIRE_COMPACT_FAMILY_GAPS = [ONE_WIRE_FAMILY_GAP, 8, 6, 4, 2] as const
export const ONE_WIRE_COLUMN_GAP_X = 60
export const ONE_WIRE_RAIL_END_PADDING = 20
export const ONE_WIRE_MIN_RAIL_LENGTH = 240
export const ONE_WIRE_MAX_CIRCUIT_COLUMNS = 2
export const ONE_WIRE_RAIL_BOTTOM_CLEARANCE_Y = 100
export const ONE_WIRE_FIRST_ROW_OFFSET_Y = 360
// Leave room for the tallest change-over switches at their readable paper size.
export const ONE_WIRE_ROW_SPACING_Y = 96

export const oneWireRailYForRows = (_rows: number, safeArea: { y: number; height: number }): number =>
  safeArea.y + Math.max(0, safeArea.height - ONE_WIRE_RAIL_BOTTOM_CLEARANCE_Y)

export type OneWireFamilyPlacement = {
  family: string
  boardId?: string
  railId?: string
  pageIndex: number
  railIndex: number
  slotIndex: number
  circuitStart: number
  circuitCount: number
  centerOffset: number
  requiredWidth: number
  anchorOffset?: number
  familyGap?: number
}

export type OneWireLayoutPlan = {
  placements: OneWireFamilyPlacement[]
  pageCount: number
  railsPerPage: number
  slotsPerRail: number
}

export const oneWireDestinationSheetLabels = (
  placements: readonly Pick<OneWireFamilyPlacement, 'boardId' | 'railId' | 'pageIndex'>[],
  sheetNumber: (pageIndex: number) => number
): Record<string, string> => {
  const firstPages = new Map<string, number>()
  for (const placement of placements) {
    const key = `${placement.boardId ?? 'main'}::${placement.railId ?? '__unassigned__'}`
    const firstPage = firstPages.get(key)
    if (firstPage === undefined || placement.pageIndex < firstPage) firstPages.set(key, placement.pageIndex)
  }
  return Object.fromEntries(
    [...firstPages].map(([key, pageIndex]) => [key, `E${sheetNumber(pageIndex)}`])
  )
}

export type OneWireFamilyBounds = {
  family: string
  anchorX: number
  minX: number
  maxX: number
  ink?: readonly { x: number; y: number; width: number; height: number }[]
}

export type PackedOneWireRailGeometry = {
  startX: number
  endX: number
  familyXs: Map<string, number>
}

export const normalizeOneWireFamilyKey = (value: string | null): string | null => {
  const cleaned = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (/^BRK\d+$/.test(cleaned)) return cleaned
  const family = cleaned.replace(/[^A-Z]/g, '')
  return family || null
}

export const appendOneWireFamilyOffset = (
  newFamilyMinX: number,
  occupiedMaxX: number,
  gap = ONE_WIRE_FAMILY_GAP
): number => occupiedMaxX + gap - newFamilyMinX

const oneWireFamilyOverlapScore = (
  left: OneWireFamilyBounds,
  right: OneWireFamilyBounds
): number => {
  if (!left.ink?.length || !right.ink?.length) return 0
  const overlapsVertically = (a: { y: number; height: number }, b: { y: number; height: number }) =>
    !(a.y + a.height + 8 < b.y || b.y + b.height + 8 < a.y)
  const sharedInk = left.ink.filter((a) => right.ink!.some((b) => overlapsVertically(a, b))).length +
    right.ink.filter((b) => left.ink!.some((a) => overlapsVertically(a, b))).length
  return Math.log2(sharedInk + 1)
}

export const oneWireRailSpanForAnchors = (
  anchorXs: readonly number[],
  existingSpan?: { startX: number; endX: number },
  preserveExisting = false
): { startX: number; endX: number } | null => {
  if (!anchorXs.length) return null
  const firstAnchor = Math.min(...anchorXs)
  const lastAnchor = Math.max(...anchorXs)
  let startX = firstAnchor - ONE_WIRE_RAIL_END_PADDING
  let endX = lastAnchor + ONE_WIRE_RAIL_END_PADDING
  if (endX - startX < ONE_WIRE_MIN_RAIL_LENGTH) {
    endX = startX + ONE_WIRE_MIN_RAIL_LENGTH
  }
  if (preserveExisting && existingSpan) {
    const length = Math.max(endX - startX, Math.abs(existingSpan.endX - existingSpan.startX))
    const centerX = (firstAnchor + lastAnchor) / 2
    startX = centerX - length / 2
    endX = centerX + length / 2
  }
  return { startX, endX }
}

export const packOneWireFamilyBounds = (
  families: readonly OneWireFamilyBounds[],
  centerX: number,
  gap = ONE_WIRE_FAMILY_GAP,
  endPadding = ONE_WIRE_RAIL_END_PADDING
): PackedOneWireRailGeometry => {
  if (!families.length) return { startX: centerX, endX: centerX, familyXs: new Map() }
  const pairScores = families.slice(0, -1).map((family, index) =>
    oneWireFamilyOverlapScore(family, families[index + 1]))
  const averageScore = pairScores.length
    ? pairScores.reduce((total, score) => total + score, 0) / pairScores.length
    : 0
  const scoreRange = pairScores.length ? Math.max(...pairScores) - Math.min(...pairScores) : 0
  const minimumGap = Math.min(2, gap)
  const gapScale = gap > minimumGap
    ? (gap - minimumGap) / (ONE_WIRE_FAMILY_GAP - minimumGap)
    : 0
  const pairGaps = pairScores.map((score) => scoreRange
    ? gap + ((score - averageScore) / scoreRange) * 4 * gapScale
    : gap)
  const provisional: Array<{ family: string; x: number; minX: number; maxX: number }> = []
  let previousMaxX = 0
  for (const [index, family] of families.entries()) {
    const leftReach = Math.max(0, family.anchorX - family.minX)
    const rightReach = Math.max(0, family.maxX - family.anchorX)
    let x = index === 0 ? leftReach : previousMaxX + gap + leftReach
    if (index && family.ink?.length && families.slice(0, index).every((previous) => previous.ink?.length)) {
      // Only reserve horizontal space where ink overlaps vertically. A wide
      // upper lighting row need not reserve room for the next breaker's poles.
      const rowGap = pairGaps[index - 1] ?? gap
      x = provisional[index - 1].x + rowGap
      for (let prior = 0; prior < index; prior++) {
        const previous = families[prior]
        const pairGap = prior === index - 1 ? rowGap : gap
        for (const a of previous.ink!) for (const b of family.ink) {
          if (a.y + a.height + 8 < b.y || b.y + b.height + 8 < a.y) continue
          x = Math.max(x, provisional[prior].x + a.x + a.width - previous.anchorX + pairGap - (b.x - family.anchorX))
        }
      }
    }
    previousMaxX = Math.max(previousMaxX, x + rightReach)
    provisional.push({ family: family.family, x, minX: x - leftReach, maxX: x + rightReach })
  }
  const contentMinX = Math.min(...provisional.map((placement) => placement.minX))
  const contentMaxX = Math.max(...provisional.map((placement) => placement.maxX))
  const offsetX = centerX - (contentMinX + contentMaxX) / 2
  const familyXs = new Map(provisional.map((placement) => [placement.family, placement.x + offsetX]))
  const firstX = provisional[0].x + offsetX
  const lastX = provisional[provisional.length - 1].x + offsetX
  return {
    startX: firstX - endPadding,
    endX: lastX + endPadding,
    familyXs
  }
}

export const insertOneWireFamilyBounds = (
  families: readonly OneWireFamilyBounds[],
  insertedFamily: string
): Map<string, number> => {
  const positions = new Map(families.map((family) => [family.family, family.anchorX]))
  const insertedIndex = families.findIndex((family) => family.family === insertedFamily)
  if (insertedIndex < 0) return positions
  for (let index = insertedIndex; index < families.length; index++) {
    const family = families[index]
    let x = family.anchorX
    if (index === insertedIndex && families[index + 1]) {
      x = index > 0 ? positions.get(families[index - 1].family)! : families[index + 1].anchorX
    }
    for (let previous = 0; previous < index; previous++) {
      const before = families[previous]
      const pair = packOneWireFamilyBounds([before, family], 0).familyXs
      x = Math.max(x, positions.get(before.family)! + pair.get(family.family)! - pair.get(before.family)!)
    }
    positions.set(family.family, x)
  }
  return positions
}

export type OneWireLayoutOptions = {
  usableWidth: number
  usableHeight: number
  maxCircuitsPerPage?: number
  measureFamily?: (family: string, circuitStart: number, circuitCount: number) => OneWireFamilyBounds
}

export const planOneWireLayout = (
  families: readonly OneWireFamilyDemand[],
  options: OneWireLayoutOptions
): OneWireLayoutPlan => {
  const heightCapacity = Math.max(
    1,
    Math.floor(
      (options.usableHeight - ONE_WIRE_FIRST_ROW_OFFSET_Y - ONE_WIRE_RAIL_BOTTOM_CLEARANCE_Y) /
        ONE_WIRE_ROW_SPACING_Y
    ) + 1
  )
  const maxCircuitsPerPage = Math.max(
    1,
    Math.min(25, options.maxCircuitsPerPage ?? heightCapacity * ONE_WIRE_MAX_CIRCUIT_COLUMNS)
  )
  const railsPerPage = 1
  const placements: OneWireFamilyPlacement[] = []
  const occupiedWidths: number[] = []
  const occupiedSlots: number[] = []
  const pageGaps: number[] = []
  const measured = new Map<OneWireFamilyPlacement, OneWireFamilyBounds>()
  const packedBounds = (bounds: OneWireFamilyBounds[], gap = ONE_WIRE_FAMILY_GAP) => {
    const geometry = packOneWireFamilyBounds(bounds, 0, gap)
    const xs = bounds.flatMap((item) => {
      const dx = geometry.familyXs.get(item.family)! - item.anchorX
      return [item.minX + dx, item.maxX + dx]
    })
    const left = Math.min(geometry.startX, ...xs), right = Math.max(geometry.endX, ...xs)
    return { geometry, left, width: right - left }
  }
  const railPages = new Map<string, number>()
  let nextRailPage = 0

  for (const demand of families) {
    const circuitTotal = Math.max(0, Math.floor(demand.circuitCount))
    const destinationKey = `${demand.boardId?.trim() || 'main'}::${demand.railId?.trim() || '__unassigned__'}`
    let railStartPage = railPages.get(destinationKey)
    if (railStartPage === undefined) {
      railStartPage = nextRailPage
      railPages.set(destinationKey, railStartPage)
    }
    let previousChunkPage = railStartPage - 1
    for (let circuitStart = 0; circuitStart < circuitTotal; circuitStart += maxCircuitsPerPage) {
      const circuitCount = Math.min(maxCircuitsPerPage, circuitTotal - circuitStart)
      const columnCount = Math.min(
        ONE_WIRE_MAX_CIRCUIT_COLUMNS,
        Math.max(1, Math.ceil(circuitCount / heightCapacity))
      )
      const bounds = options.measureFamily?.(demand.family, circuitStart, circuitCount)
      const columnWidth = Math.max(180, demand.requiredWidth ?? 360)
      const requiredWidth = bounds ? bounds.maxX - bounds.minX : Math.min(
        options.usableWidth,
        columnWidth * columnCount + ONE_WIRE_COLUMN_GAP_X * (columnCount - 1)
      )
      let pageIndex = previousChunkPage + 1
      if (circuitStart === 0) pageIndex = railStartPage
      const pagePlacements = (page: number) => placements
        .filter((item) => item.pageIndex === page)
      const widthOnPage = (page: number, gap: number) => bounds
        ? packedBounds([...pagePlacements(page).map((item) => measured.get(item)!), bounds], gap).width
        : (occupiedWidths[page] ?? 0) + ((occupiedWidths[page] ?? 0) > 0 ? gap : 0) + requiredWidth
      const fittingGap = (page: number): number | undefined => {
        const existing = pagePlacements(page)
        if (!existing.length) return ONE_WIRE_FAMILY_GAP
        const candidates = bounds
          ? ONE_WIRE_COMPACT_FAMILY_GAPS.filter((gap) => gap <= (pageGaps[page] ?? ONE_WIRE_FAMILY_GAP))
          : [ONE_WIRE_FAMILY_GAP]
        return candidates.find((gap) => widthOnPage(page, gap) <= options.usableWidth)
      }
      while (
        (occupiedWidths[pageIndex] ?? 0) > 0 &&
        fittingGap(pageIndex) === undefined
      ) {
        pageIndex += 1
      }
      const pageGap = fittingGap(pageIndex) ?? ONE_WIRE_FAMILY_GAP
      const slotIndex = occupiedSlots[pageIndex] ?? 0
      const placement: OneWireFamilyPlacement = {
        family: demand.family,
        ...(demand.boardId ? { boardId: demand.boardId } : {}),
        ...(demand.railId ? { railId: demand.railId } : {}),
        pageIndex,
        railIndex: 0,
        slotIndex,
        circuitStart,
        circuitCount,
        centerOffset: 0,
        requiredWidth
      }
      const occupiedWidth = widthOnPage(pageIndex, pageGap)
      placements.push(placement)
      if (bounds) measured.set(placement, bounds)
      occupiedWidths[pageIndex] = occupiedWidth
      pageGaps[pageIndex] = Math.min(pageGaps[pageIndex] ?? pageGap, pageGap)
      occupiedSlots[pageIndex] = slotIndex + 1
      railPages.set(destinationKey, pageIndex)
      previousChunkPage = pageIndex
      nextRailPage = Math.max(nextRailPage, pageIndex + 1)
    }
  }

  const pageCount = placements.length ? Math.max(...placements.map((placement) => placement.pageIndex)) + 1 : 0
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pagePlacements = placements.filter((placement) => placement.pageIndex === pageIndex)
    const usedWidth = occupiedWidths[pageIndex] ?? 0
    if (options.measureFamily) {
      const packed = packedBounds(pagePlacements.map((placement) => measured.get(placement)!),
        pageGaps[pageIndex] ?? ONE_WIRE_FAMILY_GAP)
      const offsetX = Math.max(0, (options.usableWidth - packed.width) / 2) - packed.left
      for (const placement of pagePlacements) {
        placement.anchorOffset = packed.geometry.familyXs.get(placement.family)! + offsetX
        placement.centerOffset = placement.anchorOffset
        placement.familyGap = pageGaps[pageIndex]
      }
      continue
    }
    let cursor = Math.max(0, (options.usableWidth - usedWidth) / 2)
    for (const placement of pagePlacements) {
      placement.centerOffset = cursor + placement.requiredWidth / 2
      cursor += placement.requiredWidth + ONE_WIRE_FAMILY_GAP
    }
  }
  const slotsPerRail = Math.max(1, ...occupiedSlots)
  return { placements, pageCount, railsPerPage, slotsPerRail }
}
