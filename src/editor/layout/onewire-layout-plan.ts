export type OneWireFamilyDemand = { family: string; circuitCount: number }
export type OneWireFamilyPlacement = {
  family: string
  pageIndex: number
  railIndex: number
  slotIndex: number
  circuitStart: number
  circuitCount: number
}

export type OneWireLayoutPlan = {
  placements: OneWireFamilyPlacement[]
  pageCount: number
  railsPerPage: number
  slotsPerRail: number
}

export const planOneWireLayout = (
  families: readonly OneWireFamilyDemand[],
  options: { usableWidth: number; usableHeight: number; maxCircuitsPerPage?: number }
): OneWireLayoutPlan => {
  // Keep a vertical family intact through circuit 25. Only oversized families
  // continue on another page; splitting A1…A20 makes a normal board harder to
  // read and wastes most of both sheets.
  const maxCircuitsPerPage = Math.max(4, options.maxCircuitsPerPage ?? 25)
  // A family is a vertical circuit tree. Reserve enough horizontal room for its
  // longest rows, while still allowing several small boards on a landscape page.
  const MIN_FAMILY_SLOT_WIDTH = 360
  const slotsPerRail = Math.max(1, Math.floor(options.usableWidth / MIN_FAMILY_SLOT_WIDTH))
  const railsPerPage = 1
  const placements: OneWireFamilyPlacement[] = []
  const occupiedSlots: number[] = []

  for (const demand of families) {
    const circuitTotal = Math.max(0, Math.floor(demand.circuitCount))
    let previousChunkPage = -1
    for (let circuitStart = 0; circuitStart < circuitTotal; circuitStart += maxCircuitsPerPage) {
      // Continuations of the same oversized family always move to a fresh page.
      // Other families may use the remaining slots on either of those pages.
      let pageIndex = previousChunkPage + 1
      while ((occupiedSlots[pageIndex] ?? 0) >= slotsPerRail) pageIndex += 1
      const slotIndex = occupiedSlots[pageIndex] ?? 0
      placements.push({
        family: demand.family,
        pageIndex,
        railIndex: 0,
        slotIndex,
        circuitStart,
        circuitCount: Math.min(maxCircuitsPerPage, circuitTotal - circuitStart)
      })
      occupiedSlots[pageIndex] = slotIndex + 1
      previousChunkPage = pageIndex
    }
  }

  const pageCount = placements.length
    ? Math.max(...placements.map((placement) => placement.pageIndex)) + 1
    : 0
  return { placements, pageCount, railsPerPage, slotsPerRail }
}
