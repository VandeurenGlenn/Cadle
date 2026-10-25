export type OneWireFamilyDemand = {
  family: string
  circuitCount: number
  boardId?: string
  railId?: string
  requiredWidth?: number
}
export const ONE_WIRE_LAYOUT_VERSION = 64
export const ONE_WIRE_FAMILY_GAP = 10
export const ONE_WIRE_COLUMN_GAP_X = 60
export const ONE_WIRE_RAIL_END_PADDING = 20
export const ONE_WIRE_MIN_RAIL_LENGTH = 240
export const ONE_WIRE_MAX_CIRCUIT_COLUMNS = 2
export const ONE_WIRE_RAIL_BOTTOM_CLEARANCE_Y = 100
export const ONE_WIRE_FIRST_ROW_OFFSET_Y = 220
export const ONE_WIRE_ROW_SPACING_Y = 64

export const oneWireRailYForRows = (rows: number, safeArea: { y: number; height: number }): number => {
  const rowCount = Math.max(1, Math.floor(rows))
  const circuitHeight =
    ONE_WIRE_FIRST_ROW_OFFSET_Y +
    (rowCount - 1) * ONE_WIRE_ROW_SPACING_Y +
    ONE_WIRE_RAIL_BOTTOM_CLEARANCE_Y
  const top = safeArea.y + Math.max(0, (safeArea.height - circuitHeight) / 2)
  return top + ONE_WIRE_FIRST_ROW_OFFSET_Y + (rowCount - 1) * ONE_WIRE_ROW_SPACING_Y
}

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
}

export type OneWireLayoutPlan = {
  placements: OneWireFamilyPlacement[]
  pageCount: number
  railsPerPage: number
  slotsPerRail: number
}

export type OneWireFamilyBounds = {
  family: string
  anchorX: number
  minX: number
  maxX: number
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
    const centerX = (firstAnchor + lastAnchor) / 2
    startX = centerX - ONE_WIRE_MIN_RAIL_LENGTH / 2
    endX = centerX + ONE_WIRE_MIN_RAIL_LENGTH / 2
  }
  if (preserveExisting && existingSpan) {
    startX = Math.min(startX, existingSpan.startX, existingSpan.endX)
    endX = Math.max(endX, existingSpan.startX, existingSpan.endX)
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
  const provisional: Array<{ family: string; x: number; maxX: number }> = []
  let previousMaxX = 0
  for (const [index, family] of families.entries()) {
    const leftReach = Math.max(0, family.anchorX - family.minX)
    const rightReach = Math.max(0, family.maxX - family.anchorX)
    const x = index === 0 ? leftReach : previousMaxX + gap + leftReach
    previousMaxX = x + rightReach
    provisional.push({ family: family.family, x, maxX: previousMaxX })
  }
  const contentMinX = 0
  const contentMaxX = provisional.at(-1)?.maxX ?? 0
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

export const planOneWireLayout = (
  families: readonly OneWireFamilyDemand[],
  options: { usableWidth: number; usableHeight: number; maxCircuitsPerPage?: number }
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
  const railStartPages = new Map<string, number>()
  let nextRailPage = 0

  for (const demand of families) {
    const circuitTotal = Math.max(0, Math.floor(demand.circuitCount))
    const destinationKey = `${demand.boardId?.trim() || 'main'}::${demand.railId?.trim() || '__unassigned__'}`
    let railStartPage = railStartPages.get(destinationKey)
    if (railStartPage === undefined) {
      railStartPage = nextRailPage
      railStartPages.set(destinationKey, railStartPage)
    }
    let previousChunkPage = railStartPage - 1
    for (let circuitStart = 0; circuitStart < circuitTotal; circuitStart += maxCircuitsPerPage) {
      const circuitCount = Math.min(maxCircuitsPerPage, circuitTotal - circuitStart)
      const columnCount = Math.min(
        ONE_WIRE_MAX_CIRCUIT_COLUMNS,
        Math.max(1, Math.ceil(circuitCount / heightCapacity))
      )
      const columnWidth = Math.max(180, demand.requiredWidth ?? 360)
      const requiredWidth = Math.min(
        options.usableWidth,
        columnWidth * columnCount + ONE_WIRE_COLUMN_GAP_X * (columnCount - 1)
      )
      let pageIndex = previousChunkPage + 1
      if (circuitStart === 0) pageIndex = railStartPage
      while (
        (occupiedWidths[pageIndex] ?? 0) > 0 &&
        (occupiedWidths[pageIndex] ?? 0) + ONE_WIRE_FAMILY_GAP + requiredWidth > options.usableWidth
      ) {
        pageIndex += 1
      }
      const slotIndex = occupiedSlots[pageIndex] ?? 0
      placements.push({
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
      })
      occupiedWidths[pageIndex] =
        (occupiedWidths[pageIndex] ?? 0) + (slotIndex ? ONE_WIRE_FAMILY_GAP : 0) + requiredWidth
      occupiedSlots[pageIndex] = slotIndex + 1
      previousChunkPage = pageIndex
      nextRailPage = Math.max(nextRailPage, pageIndex + 1)
    }
  }

  const pageCount = placements.length ? Math.max(...placements.map((placement) => placement.pageIndex)) + 1 : 0
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pagePlacements = placements.filter((placement) => placement.pageIndex === pageIndex)
    const usedWidth = occupiedWidths[pageIndex] ?? 0
    let cursor = Math.max(0, (options.usableWidth - usedWidth) / 2)
    for (const placement of pagePlacements) {
      placement.centerOffset = cursor + placement.requiredWidth / 2
      cursor += placement.requiredWidth + ONE_WIRE_FAMILY_GAP
    }
  }
  const slotsPerRail = Math.max(1, ...occupiedSlots)
  return { placements, pageCount, railsPerPage, slotsPerRail }
}
